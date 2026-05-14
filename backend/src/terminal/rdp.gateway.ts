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
import { parseCookies } from '../common/utils/security';
import { getCorsConfig } from '../common/config/cors.config';
import { encodeInstruction } from './guac-protocol';
import { StartRdpSessionDto, ResizeRdpDto } from './dto/rdp.dto';

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
      startTime: Date;
      timeoutId: NodeJS.Timeout;
      inactivityTimer: NodeJS.Timeout;
      // F-02: poll RBAC every 30s independently of incoming traffic so a
      // user whose access is revoked stops receiving frames even when no
      // input event arrives (RDP streams are mostly server→client).
      accessPoll: NodeJS.Timeout;
      accessCache?: { allowed: boolean; lastChecked: number };
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
  ) {}

  async handleConnection(client: Socket) {
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

      await this.auditService.logAction(
        user?.sub || null,
        'RDP: SESSION_CLOSED',
        { machineId: session.machineId, duration: `${duration}s` },
        user?.authMethod || null,
        this.getClientIp(client),
        AuditCategory.TERMINAL,
      );

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
      });

      const timeoutId = setTimeout(
        () => {
          this.logger.warn(`RDP session ${client.id} exceeded max duration`);
          client.emit('error', 'Session expired');
          client.disconnect();
        },
        4 * 60 * 60 * 1000,
      ); // 4h

      // SECURITY (F-02): periodic RBAC re-check, same rationale as the
      // SSH gateway. RDP is even more affected because the client mostly
      // observes (mouse + keyboard input is sparse); without this poll a
      // revoked viewer keeps watching the desktop indefinitely.
      const accessPoll = setInterval(async () => {
        const session = this.sessions.get(client.id);
        if (!session) return;
        try {
          const stillAllowed = await this.rbacService.hasAccess(
            user.sub,
            session.machineId,
            AccessLevel.OPERATOR,
          );
          session.accessCache = { allowed: stillAllowed, lastChecked: Date.now() };
          if (!stillAllowed) {
            this.logger.warn(
              `RBAC revocation detected for RDP user=${user.sub} machine=${session.machineId} — closing session`,
            );
            client.emit('error', 'Access revoked');
            session.socket.destroy();
            this.sessions.delete(client.id);
            client.disconnect();
          }
        } catch (e) {
          this.logger.warn(
            `RDP RBAC poll failed (transient): ${(e as Error).message}`,
          );
        }
      }, this.RBAC_POLL_INTERVAL_MS);

      this.sessions.set(client.id, {
        socket,
        machineId: data.machineId,
        userId: user.sub,
        startTime: new Date(),
        timeoutId,
        inactivityTimer: this.createInactivityTimer(client),
        accessPoll,
      });

      await this.auditService.logAction(
        user.sub,
        'RDP: SESSION_STARTED',
        {
          machineId: data.machineId,
          machineName: machine.name,
          ip: machine.ip,
          security: machine.rdpSecurity,
        },
        user.authMethod,
        this.getClientIp(client),
        AuditCategory.TERMINAL,
      );

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
