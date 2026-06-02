import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as net from 'node:net';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessLevel, Protocol } from '@prisma/client';

import { RdpService } from './rdp.service';
import { MachinesService } from '../machines/machines.service';
import { RbacService } from '../rbac/rbac.service';
import { ConfigService } from '../config/config.service';
import { AuditService, AuditCategory } from '../audit/audit.service';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { SessionRecorderService } from './recording/session-recorder.service';
import { parseCookies } from '../common/utils/security';
import { getCorsConfig } from '../common/config/cors.config';
import { encodeInstruction } from './guac-protocol';
import { StartRdpSessionDto, ResizeRdpDto } from './dto/rdp.dto';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * WebSocket gateway that proxies browser <-> guacd for RDP sessions.
 *
 * Wire format client-side:
 *   - Client sends `start-session` once to authenticate + open the tunnel.
 *   - After that, `data` events carry raw Guacamole protocol strings in both
 *     directions (forwarded verbatim to/from guacd).
 *   - `resize` events adjust the remote display via a Guacamole `size` instr.
 *
 * Credentials and the full handshake happen server-side in RdpService, so
 * the browser never sees the target password or domain.
 */
@WebSocketGateway({
  namespace: 'rdp',
  cors: getCorsConfig(),
})
export class RdpGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RdpGateway.name);
  private readonly MAX_SESSIONS_PER_USER = 5;
  private readonly MAX_CONN_ATTEMPTS_PER_MIN = 15;
  private readonly MAX_MESSAGE_SIZE = 2 * 1024 * 1024; // 2 MB, large enough for images

  private sessions = new Map<
    string,
    {
      socket: net.Socket;
      machineId: string;
      userId: string;
      sessionId: string;
      startTime: Date;
      timeoutId: NodeJS.Timeout;
      inactivityTimer: NodeJS.Timeout;
      // F-02: poll RBAC every 30s independently of incoming traffic so a
      // user whose access is revoked stops receiving frames even when no
      // input event arrives (RDP streams are mostly server→client).
      accessPoll: NodeJS.Timeout;
      accessCache?: { allowed: boolean; lastChecked: number };
      recording?: { filePath: string; startedAt: number };
    }
  >();
  // SECURITY (F-02)
  private readonly RBAC_POLL_INTERVAL_MS = 30_000;
  private userSessions = new Map<string, number>();
  private connectionAttempts = new Map<
    string,
    { count: number; lastAttempt: number }
  >();

  constructor(
    private readonly rdpService: RdpService,
    private readonly machinesService: MachinesService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
    private readonly recorderService: SessionRecorderService,
  ) {}

  handleConnection(client: Socket) {
    // Socket.IO does NOT await this hook before accepting the namespace
    // connection and delivering buffered events to it. Guacamole.Client
    // calls tunnel.connect() ~1 ms after the namespace ack, so a `start-
    // session` event was racing the async JWT verify + DB lookup below and
    // landing while `client.data.user` was still unset. We now publish a
    // promise on `client.data.authReady` that every other handler awaits
    // before reading `client.data.user`.
    client.data.authReady = this.authenticateSocket(client);
    // Swallow rejection here — `authenticateSocket` already disconnects on
    // failure, but an unhandled rejection on the promise object itself
    // would still trigger Node's unhandledRejection handler.
    client.data.authReady.catch(() => undefined);
  }

  private async authenticateSocket(client: Socket): Promise<void> {
    const clientIp = this.getClientIp(client);
    const now = Date.now();
    const attempts = this.connectionAttempts.get(clientIp) || {
      count: 0,
      lastAttempt: now,
    };
    if (now - attempts.lastAttempt > 60_000) {
      attempts.count = 0;
      attempts.lastAttempt = now;
    }
    if (attempts.count >= this.MAX_CONN_ATTEMPTS_PER_MIN) {
      this.logger.warn(`RDP connection attempt throttled for IP: ${clientIp}`);
      client.disconnect();
      return;
    }
    attempts.count++;
    this.connectionAttempts.set(clientIp, attempts);

    try {
      const cookies = parseCookies(client.handshake.headers['cookie']);
      const jwt = cookies['jwt'];
      if (!jwt) {
        client.disconnect();
        return;
      }
      if (await this.tokenBlacklistService.isBlacklisted(jwt)) {
        this.logger.warn(`Blacklisted token rejected for RDP: ${client.id}`);
        client.disconnect();
        return;
      }
      const payload = this.jwtService.verify(jwt, {
        secret: this.configService.getOrThrow('JWT_SECRET'),
      });

      // SECURITY: same DB-backed re-check as the SSH gateway. Without this
      // the WS path was bypassing JwtAuthGuard's tokenVersion and
      // requiresPasswordChange enforcement.
      const dbUser = await this.usersService.findOneById(payload.sub);
      if (!dbUser) {
        client.disconnect();
        return;
      }
      const payloadVersion = payload.version ?? -1;
      if (dbUser.tokenVersion !== payloadVersion) {
        this.logger.warn(`RDP WS rejected: stale tokenVersion for user ${dbUser.id}`);
        client.disconnect();
        return;
      }
      if (dbUser.requiresPasswordChange) {
        this.logger.warn(`RDP WS rejected: user ${dbUser.id} must rotate bootstrap password`);
        client.emit('error', 'Password change required');
        client.disconnect();
        return;
      }

      client.data.user = {
        sub: dbUser.id,
        email: dbUser.email,
        username: dbUser.username,
        role: dbUser.role,
        authMethod: dbUser.authMethod,
        isAdminMode: !!payload.isAdminMode,
        // SECURITY (audit-2026-06): see ssh.gateway.ts for rationale.
        tokenVersion: dbUser.tokenVersion,
      };

      const currentSessions = this.userSessions.get(dbUser.id) || 0;
      if (currentSessions >= this.MAX_SESSIONS_PER_USER) {
        this.logger.warn(
          `User ${dbUser.id} exceeded max RDP sessions (${this.MAX_SESSIONS_PER_USER})`,
        );
        client.disconnect();
        return;
      }
      this.userSessions.set(dbUser.id, currentSessions + 1);
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const session = this.sessions.get(client.id);
    const user = client.data.user;

    if (session) {
      clearTimeout(session.timeoutId);
      clearTimeout(session.inactivityTimer);
      clearInterval(session.accessPoll); // F-02
      const duration = Math.round(
        (Date.now() - session.startTime.getTime()) / 1000,
      );

      await this.auditService.log({
        actorId: user?.sub ?? null,
        action: 'RDP: SESSION_CLOSED',
        category: AuditCategory.TERMINAL,
        authMethod: user?.authMethod ?? null,
        ipAddress: this.getClientIp(client),
        details: { machineId: session.machineId, durationSeconds: duration },
        entities: {
          ...(user?.sub ? { users: [user.sub] } : {}),
          machines: [session.machineId],
        },
      });

      // Finalize RDP recording if active (video only — guacd writes the .guac file)
      if (session.recording) {
        await this.recorderService.finalizeRdp(session.sessionId);
      }

      try {
        session.socket.destroy();
      } catch {
        /* noop */
      }
      this.sessions.delete(client.id);
    }

    if (user) {
      const current = this.userSessions.get(user.sub) || 1;
      if (current <= 1) this.userSessions.delete(user.sub);
      else this.userSessions.set(user.sub, current - 1);
    }
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage('start-session')
  async handleStartSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: StartRdpSessionDto,
  ) {
    // Wait for handleConnection's async auth (JWT verify + DB lookup) to
    // finish — see the comment in handleConnection for why this is needed.
    if (client.data.authReady) await client.data.authReady;
    const user = client.data.user;
    if (!user) {
      client.emit('error', 'Authentication required');
      return;
    }
    if (this.sessions.has(client.id)) {
      client.emit('error', 'Session already active on this connection');
      return;
    }

    try {
      const hasAccess = await this.rbacService.hasAccess(
        user.sub,
        data.machineId,
        AccessLevel.OPERATOR,
      );
      if (!hasAccess) {
        client.emit('error', 'Permission denied');
        return;
      }

      const machine = await this.machinesService.findOne(data.machineId);
      if (machine.protocol !== Protocol.RDP) {
        client.emit(
          'error',
          `Machine protocol is ${machine.protocol}, not RDP. Use /terminal instead.`,
        );
        return;
      }
      const secret = await this.machinesService.getDecryptedSecret(
        data.machineId,
      );

      // Determine recording path if RDP recording is enabled
      const rdpRecordingEnabled = this.settingsService.isRecordingEnabled('rdp');
      const recordingsBasePath = process.env['RECORDINGS_PATH'];
      const sessionId = client.id;
      let recordingPath: string | undefined;
      let recordingName: string | undefined;
      if (rdpRecordingEnabled && recordingsBasePath) {
        const rdpDir = path.join(recordingsBasePath, 'rdp');
        try {
          fs.mkdirSync(rdpDir, { recursive: true, mode: 0o777 });
          // Ensure guacd (uid 1000) can write into this directory
          fs.chmodSync(rdpDir, 0o777);
        } catch { /* ignore */ }
        recordingPath = rdpDir;
        recordingName = sessionId;
      }

      const { socket, leftover } = await this.rdpService.createStream({
        host: machine.ip,
        port: machine.port,
        username: secret.username,
        password: secret.password,
        domain: machine.rdpDomain ?? undefined,
        security: machine.rdpSecurity.toLowerCase() as
          | 'any'
          | 'rdp'
          | 'tls'
          | 'nla',
        ignoreCert: machine.rdpIgnoreCert,
        width: data.width,
        height: data.height,
        allowCopyPaste: machine.allowCopyPaste,
        recordingPath,
        recordingName,
      });

      const timeoutId = setTimeout(
        () => {
          this.logger.warn(`RDP session ${client.id} exceeded max duration`);
          client.emit('error', 'Session expired');
          client.disconnect();
        },
        4 * 60 * 60 * 1000,
      ); // 4h

      // SECURITY (F-02 + audit-2026-06): periodic re-check of BOTH the
      // user's session validity (`tokenVersion`) and their RBAC access
      // on the target. RDP is even more affected than SSH because the
      // client mostly observes — without this poll a revoked viewer
      // keeps watching the desktop indefinitely. See ssh.gateway.ts for
      // the full rationale on the tokenVersion arm.
      const accessPoll = setInterval(async () => {
        const session = this.sessions.get(client.id);
        if (!session) return;
        try {
          const dbUser = await this.usersService.findOneById(user.sub);
          const tokenRevoked =
            !dbUser || dbUser.tokenVersion !== client.data.user.tokenVersion;

          const stillAllowed = tokenRevoked
            ? false
            : await this.rbacService.hasAccess(
                user.sub,
                session.machineId,
                AccessLevel.OPERATOR,
              );
          session.accessCache = { allowed: stillAllowed, lastChecked: Date.now() };

          if (tokenRevoked || !stillAllowed) {
            const reason = tokenRevoked ? 'token_revoke' : 'rbac_revoke';
            this.logger.warn(
              `RDP session terminated (${reason}) for user=${user.sub} machine=${session.machineId}`,
            );
            client.emit('error', tokenRevoked ? 'Session revoked' : 'Access revoked');
            session.socket.destroy();
            this.sessions.delete(client.id);
            void this.auditService
              .log({
                actorId: session.userId,
                action: tokenRevoked
                  ? 'RDP: SESSION_KILLED_TOKEN_REVOKE'
                  : 'RDP: SESSION_KILLED_RBAC_REVOKE',
                category: AuditCategory.TERMINAL,
                authMethod: user.authMethod,
                ipAddress: this.getClientIp(client),
                details: { reason },
                entities: {
                  users: [session.userId],
                  machines: [session.machineId],
                },
              })
              .catch((e) => this.logger.error('Failed to audit RDP session kill', e));
            client.disconnect();
          }
        } catch (e) {
          this.logger.warn(
            `RDP access poll failed (transient): ${(e as Error).message}`,
          );
        }
      }, this.RBAC_POLL_INTERVAL_MS);

      // Register RDP recording in DB if enabled (video only — guacd writes the .guac file)
      let recordingEntry: { filePath: string; startedAt: number } | undefined;
      if (rdpRecordingEnabled && recordingsBasePath && recordingPath && recordingName) {
        // guacd writes the recording file as exactly <recording-path>/<recording-name> with no extension
        const filePath = path.join(recordingPath, recordingName);
        await this.recorderService.registerRdp({
          sessionId,
          userId: user.sub,
          machineId: data.machineId,
          filePath,
        });
        recordingEntry = { filePath, startedAt: Date.now() };
      }

      const sessionEntry: Parameters<typeof this.sessions.set>[1] = {
        socket,
        machineId: data.machineId,
        userId: user.sub,
        sessionId,
        startTime: new Date(),
        timeoutId,
        inactivityTimer: this.createInactivityTimer(client),
        accessPoll,
      };
      if (recordingEntry) sessionEntry.recording = recordingEntry;
      this.sessions.set(client.id, sessionEntry);

      await this.auditService.log({
        actorId: user.sub,
        action: 'RDP: SESSION_STARTED',
        category: AuditCategory.TERMINAL,
        authMethod: user.authMethod,
        ipAddress: this.getClientIp(client),
        details: {
          machineId: data.machineId,
          machineName: machine.name,
          ip: machine.ip,
          security: machine.rdpSecurity,
        },
        entities: {
          users: [user.sub],
          machines: [data.machineId],
        },
      });

      client.emit('security-settings', {
        allowCopyPaste: machine.allowCopyPaste,
      });

      // Flush any bytes already buffered from the handshake to the client.
      if (leftover) {
        client.emit('data', leftover);
      }

      // Pipe mode: forward raw frames in both directions. The socket was
      // switched to utf8 encoding during handshake, so chunks are already
      // strings at runtime (Guacamole wire protocol is UTF-8 safe).
      socket.on('data', (chunk: Buffer | string) => {
        const session = this.sessions.get(client.id);
        if (!session) return;
        clearTimeout(session.inactivityTimer);
        session.inactivityTimer = this.createInactivityTimer(client);
        client.emit(
          'data',
          typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
        );
      });
      socket.on('close', () => {
        client.emit('closed');
        client.disconnect();
      });
      socket.on('error', (err) => {
        this.logger.error(`guacd socket error: ${err.message}`);
        client.emit('error', 'RDP tunnel error');
        client.disconnect();
      });

      client.emit('ready');
    } catch (err: any) {
      this.logger.error(`Failed to start RDP session: ${err.message}`);
      client.emit(
        'error',
        'Connection failed. Please contact your administrator.',
      );
    }
  }

  @SubscribeMessage('data')
  async handleData(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: string,
  ) {
    if (typeof payload !== 'string' || payload.length > this.MAX_MESSAGE_SIZE) {
      client.emit('error', 'Message too large');
      return;
    }
    if (client.data.authReady) await client.data.authReady;
    const session = this.sessions.get(client.id);
    const user = client.data.user;
    if (!session || !user) return;

    // RBAC re-check every 30 seconds (same policy as SSH gateway)
    const now = Date.now();
    let isAllowed = session.accessCache?.allowed;
    if (
      !session.accessCache ||
      now - session.accessCache.lastChecked > 5_000
    ) {
      isAllowed = await this.rbacService.hasAccess(
        user.sub,
        session.machineId,
        AccessLevel.OPERATOR,
      );
      session.accessCache = { allowed: isAllowed, lastChecked: now };
    }
    if (!isAllowed) {
      client.emit('error', 'Access revoked');
      clearInterval(session.accessPoll); // F-02
      session.socket.destroy();
      this.sessions.delete(client.id);
      client.disconnect();
      return;
    }

    clearTimeout(session.inactivityTimer);
    session.inactivityTimer = this.createInactivityTimer(client);

    if (session.socket.writable) {
      session.socket.write(payload);
    }
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage('resize')
  async handleResize(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ResizeRdpDto,
  ) {
    if (client.data.authReady) await client.data.authReady;
    const session = this.sessions.get(client.id);
    if (!session) return;
    if (session.socket.writable) {
      session.socket.write(
        encodeInstruction('size', [
          String(data.width),
          String(data.height),
          '96',
        ]),
      );
    }
  }

  private getClientIp(client: Socket): string {
    const xff = client.handshake.headers['x-forwarded-for'];
    if (xff) {
      if (Array.isArray(xff)) return xff[0] || client.handshake.address;
      return xff.split(',')[0]?.trim() || client.handshake.address;
    }
    return client.handshake.address;
  }

  private createInactivityTimer(client: Socket): NodeJS.Timeout {
    const ms = Number.parseInt(
      process.env['SESSION_INACTIVITY_MS'] ?? '1800000',
      10,
    );
    return setTimeout(() => {
      this.logger.warn(`RDP session ${client.id} closed due to inactivity`);
      client.emit('error', 'Session closed due to inactivity');
      client.disconnect();
    }, ms);
  }
}
