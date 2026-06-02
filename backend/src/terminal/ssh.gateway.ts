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
import { SshService } from './ssh.service';
import { MachinesService } from '../machines/machines.service';
import { RbacService } from '../rbac/rbac.service';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../config/config.service';
import { AccessLevel } from '@prisma/client';
import { parseCookies } from '../common/utils/security';
import { StartSessionDto, ResizeSessionDto } from './dto/terminal.dto';
import { AuditService, AuditCategory } from '../audit/audit.service';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { UsersService } from '../users/users.service';
import { SessionRecorderService } from './recording/session-recorder.service';
import { SettingsService } from '../settings/settings.service';
import { getCorsConfig } from '../common/config/cors.config';
import * as crypto from 'node:crypto';

@WebSocketGateway({
  namespace: 'terminal',
  cors: getCorsConfig(),
})
export class SshGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(SshGateway.name);
  private sshSessions = new Map<
    string,
    {
      client: any;
      stream: any;
      machineId: string;
      sessionId: string;
      userId: string;
      startTime: Date;
      timeoutId: NodeJS.Timeout;
      inactivityTimer: NodeJS.Timeout;
      // F-02: poll RBAC every 30s independently of incoming traffic, so a
      // viewer who never types still gets cut off on revoke.
      accessPoll: NodeJS.Timeout;
      accessCache?: { allowed: boolean; lastChecked: number };
    }
  >();
  // SECURITY (F-02): how often to re-verify RBAC for an active session.
  // 30 s is the documented compromise window in the brief.
  private readonly RBAC_POLL_INTERVAL_MS = 30_000;
  private inputRateLimiter = new Map<
    string,
    { count: number; resetAt: number }
  >();

  // SECURITY FIX: Track sessions per user to prevent resource exhaustion
  private userSessions = new Map<string, number>();
  private readonly MAX_SESSIONS_PER_USER = 5;

  // MED-11 FIX: Rate limit connection attempts per IP
  private connectionAttempts = new Map<
    string,
    { count: number; lastAttempt: number }
  >();
  private readonly MAX_CONN_ATTEMPTS_PER_MIN = 15;

  constructor(
    private readonly sshService: SshService,
    private readonly machinesService: MachinesService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly usersService: UsersService,
    private readonly recorder: SessionRecorderService,
    private readonly settingsService: SettingsService,
  ) {}

  async handleConnection(client: Socket) {
    const clientIp = this.getClientIp(client);
    const now = Date.now();
    const attempts = this.connectionAttempts.get(clientIp) || {
      count: 0,
      lastAttempt: now,
    };

    // Reset counter every minute
    if (now - attempts.lastAttempt > 60000) {
      attempts.count = 0;
      attempts.lastAttempt = now;
    }

    if (attempts.count >= this.MAX_CONN_ATTEMPTS_PER_MIN) {
      this.logger.warn(`Connection attempt throttled for IP: ${clientIp}`);
      client.disconnect();
      return;
    }

    attempts.count++;
    this.connectionAttempts.set(clientIp, attempts);

    try {
      const cookieHeader = client.handshake.headers['cookie'];
      const cookies = parseCookies(cookieHeader);
      const jwt = cookies['jwt'];

      if (!jwt) {
        client.disconnect();
        return;
      }

      // SECURITY FIX: Check if token is blacklisted
      if (await this.tokenBlacklistService.isBlacklisted(jwt)) {
        this.logger.warn(
          `Blacklisted token rejected for terminal: ${client.id}`,
        );
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(jwt, {
        secret: this.configService.getOrThrow('JWT_SECRET'),
      });

      // SECURITY: re-fetch the user so we honour current DB state — JWT
      // payload may be stale w.r.t. tokenVersion / requiresPasswordChange,
      // and the previous WS code was bypassing JwtAuthGuard's password-
      // rotation lockout.
      const dbUser = await this.usersService.findOneById(payload.sub);
      if (!dbUser) {
        client.disconnect();
        return;
      }
      const payloadVersion = payload.version ?? -1;
      if (dbUser.tokenVersion !== payloadVersion) {
        this.logger.warn(`WS rejected: stale tokenVersion for user ${dbUser.id}`);
        client.disconnect();
        return;
      }
      if (dbUser.requiresPasswordChange) {
        this.logger.warn(`WS rejected: user ${dbUser.id} must rotate bootstrap password`);
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
        // SECURITY (audit-2026-06): freeze the tokenVersion observed at
        // connect time so the periodic accessPoll below can compare it
        // to the live DB value and kill the WS when an admin runs
        // `POST /users/:id/revoke-tokens` mid-session. Without this,
        // HTTP requests get rejected with 401 but the open SSH/RDP
        // terminal keeps streaming.
        tokenVersion: dbUser.tokenVersion,
      };

      // SECURITY FIX: Rate limit sessions per user to prevent resource exhaustion
      const userId = dbUser.id;
      const currentSessions = this.userSessions.get(userId) || 0;

      if (currentSessions >= this.MAX_SESSIONS_PER_USER) {
        this.logger.warn(
          `User ${userId} exceeded max sessions (${this.MAX_SESSIONS_PER_USER})`,
        );
        client.disconnect();
        return;
      }

      this.userSessions.set(userId, currentSessions + 1);
    } catch (error) {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const session = this.sshSessions.get(client.id);
    const user = client.data.user;

    if (session) {
      clearTimeout(session.timeoutId);
      clearTimeout(session.inactivityTimer);
      clearInterval(session.accessPoll); // F-02
      const duration = Math.round(
        (new Date().getTime() - session.startTime.getTime()) / 1000,
      );

      await this.recorder.end(session.sessionId);

      await this.auditService.log({
        actorId: user?.sub ?? null,
        action: 'SSH: SESSION_CLOSED',
        category: AuditCategory.TERMINAL,
        authMethod: user?.authMethod ?? null,
        ipAddress: this.getClientIp(client),
        details: {
          machineId: session.machineId,
          durationSeconds: duration,
          sessionId: session.sessionId,
        },
        entities: {
          users: [session.userId],
          machines: [session.machineId],
          recordings: [session.sessionId],
        },
      });

      session.stream.end();
      session.client.end();
      this.sshSessions.delete(client.id);
      this.inputRateLimiter.delete(client.id);
    }

    // SECURITY FIX: Decrement user session counter
    if (user) {
      const userId = user.sub;
      const currentSessions = this.userSessions.get(userId) || 1;
      if (currentSessions <= 1) {
        this.userSessions.delete(userId);
      } else {
        this.userSessions.set(userId, currentSessions - 1);
      }
    }
  }

  private getClientIp(client: Socket): string {
    const forwardedFor = client.handshake.headers['x-forwarded-for'];
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^[0-9a-fA-F:]+$/;
    if (forwardedFor) {
      const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
      const candidate = raw?.trim() ?? '';
      if (ipv4.test(candidate) || ipv6.test(candidate)) return candidate;
    }
    return client.handshake.address;
  }

  private createInactivityTimer(client: Socket): NodeJS.Timeout {
    const parsed = parseInt(process.env['SESSION_INACTIVITY_MS'] ?? '');
    const INACTIVITY_TIMEOUT_MS = Number.isFinite(parsed) && parsed > 0 ? parsed : 1_800_000; // 30 minutes default
    return setTimeout(() => {
      this.logger.warn(`Session ${client.id} closed due to inactivity`);
      client.emit('error', 'Session closed due to inactivity');
      client.disconnect();
    }, INACTIVITY_TIMEOUT_MS);
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage('start-session')
  async handleStartSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: StartSessionDto,
  ) {
    const user = client.data.user;
    if (!user) {
      client.emit('error', 'Authentication required');
      return;
    }

    if (this.sshSessions.has(client.id)) {
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
        // Audit *attempted* sessions on machines the operator has no
        // access to — useful for spotting reconnaissance / misconfigured
        // dashboards even though the request is benign on its own.
        await this.auditService.log({
          actorId: user.sub,
          action: 'SSH: SESSION_DENIED',
          category: AuditCategory.TERMINAL,
          authMethod: user.authMethod,
          ipAddress: this.getClientIp(client),
          details: { machineId: data.machineId, reason: 'no_operator_access' },
          entities: { users: [user.sub], machines: [data.machineId] },
        });
        client.emit('error', 'Permission denied');
        return;
      }

      const machine = await this.machinesService.findOne(data.machineId);
      const secret = await this.machinesService.getDecryptedSecret(
        data.machineId,
      );

      const { client: sshClient, stream } = await this.sshService.createStream({
        host: machine.ip,
        port: machine.port,
        username: secret.username,
        password: secret.password,
        privateKey: secret.privateKey,
        allowTunneling: machine.allowTunneling,
        allowRebound: machine.allowRebound,
        cols: data.cols ?? 80,
        rows: data.rows ?? 24,
      });

      const sessionId = crypto.randomUUID();

      const timeoutId = setTimeout(
        () => {
          this.logger.warn(`Session ${client.id} exceeded max duration`);
          client.emit('error', 'Session expired');
          client.disconnect();
        },
        4 * 60 * 60 * 1000,
      ); // 4 hours

      // SECURITY (F-02 + audit-2026-06): periodic re-check of BOTH
      //   - the user's session validity (`tokenVersion`) so an admin
      //     running `POST /users/:id/revoke-tokens` actually closes
      //     active terminals, not just future HTTP requests;
      //   - their RBAC access on the target machine.
      // Either failing condition tears down the WS, the SSH stream and
      // the session map entry, and emits an audit event so the kill is
      // visible in the admin log.
      const accessPoll = setInterval(async () => {
        const session = this.sshSessions.get(client.id);
        if (!session) return;
        try {
          // (a) tokenVersion check — addresses audit finding #1 of the
          // external review. Pinned at connect-time in `client.data.user`.
          const dbUser = await this.usersService.findOneById(user.sub);
          const tokenRevoked =
            !dbUser || dbUser.tokenVersion !== client.data.user.tokenVersion;

          // (b) RBAC re-check (only if the user is still valid — no
          // point asking the RBAC table about a deleted account).
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
              `Session terminated (${reason}) for user=${user.sub} machine=${session.machineId}`,
            );
            client.emit('error', tokenRevoked ? 'Session revoked' : 'Access revoked');
            session.stream.end();
            session.client.end();
            this.sshSessions.delete(client.id);
            // Surface the kill so admins see *why* a session was cut even
            // though the user did nothing wrong.
            void this.auditService
              .log({
                actorId: session.userId,
                action: tokenRevoked
                  ? 'SSH: SESSION_KILLED_TOKEN_REVOKE'
                  : 'SSH: SESSION_KILLED_RBAC_REVOKE',
                category: AuditCategory.TERMINAL,
                authMethod: user.authMethod,
                ipAddress: this.getClientIp(client),
                details: { sessionId: session.sessionId, reason },
                entities: {
                  users: [session.userId],
                  machines: [session.machineId],
                  recordings: [session.sessionId],
                },
              })
              .catch((e) => this.logger.error('Failed to audit session kill', e));
            client.disconnect();
          }
        } catch (e) {
          // On a transient DB error, do not kill the session — keep going.
          this.logger.warn(
            `Access poll failed (transient): ${(e as Error).message}`,
          );
        }
      }, this.RBAC_POLL_INTERVAL_MS);

      this.sshSessions.set(client.id, {
        client: sshClient,
        stream,
        machineId: data.machineId,
        sessionId,
        userId: user.sub,
        startTime: new Date(),
        timeoutId,
        inactivityTimer: this.createInactivityTimer(client),
        accessPoll,
      });

      if (this.settingsService.isRecordingEnabled('ssh')) {
        await this.recorder.start({
          sessionId,
          userId: user.sub,
          machineId: data.machineId,
          cols: data.cols ?? 80,
          rows: data.rows ?? 24,
          title: `${machine.name} (${machine.ip})`,
          protocol: 'ssh',
        });
      }

      await this.auditService.log({
        actorId: user.sub,
        action: 'SSH: SESSION_STARTED',
        category: AuditCategory.TERMINAL,
        authMethod: user.authMethod,
        ipAddress: this.getClientIp(client),
        details: {
          machineId: data.machineId,
          machineName: machine.name,
          ip: machine.ip,
          sessionId,
          cols: data.cols ?? 80,
          rows: data.rows ?? 24,
        },
        entities: {
          users: [user.sub],
          machines: [data.machineId],
          recordings: [sessionId],
        },
      });

      client.emit('security-settings', {
        allowCopyPaste: machine.allowCopyPaste,
      });

      stream.on('data', (chunk: Buffer) => {
        if (this.sshSessions.has(client.id)) {
          const session = this.sshSessions.get(client.id)!;
          clearTimeout(session.inactivityTimer);
          session.inactivityTimer = this.createInactivityTimer(client);
          this.recorder.writeOutput(session.sessionId, chunk.toString('utf8'));
        }
        client.emit('output', chunk.toString('utf8'));
      });

      stream.on('close', () => {
        client.emit('closed');
        client.disconnect();
      });
    } catch (error: any) {
      this.logger.error('Failed to start SSH session:', error.message);
      client.emit(
        'error',
        'Connection failed. Please contact your administrator.',
      );
    }
  }

  @SubscribeMessage('input')
  async handleInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: string,
  ) {
    const MAX_INPUT_SIZE = 4096;
    if (typeof data !== 'string' || data.length > MAX_INPUT_SIZE) {
      client.emit('error', 'Input too large');
      return;
    }

    const now = Date.now();
    const limiter = this.inputRateLimiter.get(client.id) ?? {
      count: 0,
      resetAt: now + 1000,
    };
    if (now > limiter.resetAt) {
      limiter.count = 0;
      limiter.resetAt = now + 1000;
    }
    if (limiter.count >= 100) return; // 100 events/sec max
    limiter.count++;
    this.inputRateLimiter.set(client.id, limiter);

    const session = this.sshSessions.get(client.id);
    const user = client.data.user;

    if (session && user) {
      clearTimeout(session.inactivityTimer);
      session.inactivityTimer = this.createInactivityTimer(client);

      const nowChecked = Date.now();
      let isAllowed = session.accessCache?.allowed;

      if (
        !session.accessCache ||
        nowChecked - session.accessCache.lastChecked > 5_000
      ) {
        isAllowed = await this.rbacService.hasAccess(
          user.sub,
          session.machineId,
          AccessLevel.OPERATOR,
        );
        session.accessCache = { allowed: isAllowed, lastChecked: nowChecked };
      }

      if (!isAllowed) {
        client.emit('error', 'Access revoked');
        clearInterval(session.accessPoll); // F-02
        session.stream.end();
        session.client.end();
        this.sshSessions.delete(client.id);
        client.disconnect();
        return;
      }

      if (session.stream.writable) {
        session.stream.write(data);
      }
    }
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage('resize')
  async handleResize(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ResizeSessionDto,
  ) {
    const session = this.sshSessions.get(client.id);
    const user = client.data.user;

    // Resize can arrive before start-session is fully processed — silently ignore.
    if (!session || !user) {
      return;
    }

    const nowChecked = Date.now();
    let isAllowed = session.accessCache?.allowed;
    if (
      !session.accessCache ||
      nowChecked - session.accessCache.lastChecked > 5_000
    ) {
      isAllowed = await this.rbacService.hasAccess(
        user.sub,
        session.machineId,
        AccessLevel.OPERATOR,
      );
      session.accessCache = { allowed: isAllowed, lastChecked: nowChecked };
    }

    if (!isAllowed) {
      client.emit('error', 'Access revoked');
      session.stream.end();
      session.client.end();
      this.sshSessions.delete(client.id);
      client.disconnect();
      return;
    }

    if (session.stream.setWindow) {
      session.stream.setWindow(data.rows, data.cols, 0, 0);
    }
  }
}
