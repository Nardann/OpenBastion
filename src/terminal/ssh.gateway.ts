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
import { getCorsConfig } from '../common/config/cors.config';

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
      startTime: Date;
      timeoutId: NodeJS.Timeout;
      inactivityTimer: NodeJS.Timeout;
      accessCache?: { allowed: boolean; lastChecked: number };
    }
  >();
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
      client.data.user = payload;

      // SECURITY FIX: Rate limit sessions per user to prevent resource exhaustion
      const userId = payload.sub;
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
      const duration = Math.round(
        (new Date().getTime() - session.startTime.getTime()) / 1000,
      );

      await this.auditService.logAction(
        user?.sub || null,
        'TERMINAL: SESSION_CLOSED',
        { machineId: session.machineId, duration: `${duration}s` },
        user?.authMethod || null,
        this.getClientIp(client),
        AuditCategory.TERMINAL,
      );

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
    if (forwardedFor) {
      if (Array.isArray(forwardedFor)) {
        return forwardedFor[0] || client.handshake.address;
      }
      return forwardedFor.split(',')[0]?.trim() || client.handshake.address;
    }
    return client.handshake.address;
  }

  private createInactivityTimer(client: Socket): NodeJS.Timeout {
    const INACTIVITY_TIMEOUT_MS = parseInt(
      process.env['SESSION_INACTIVITY_MS'] ?? '1800000',
    ); // 30 minutes default
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
      });

      const timeoutId = setTimeout(
        () => {
          this.logger.warn(`Session ${client.id} exceeded max duration`);
          client.emit('error', 'Session expired');
          client.disconnect();
        },
        4 * 60 * 60 * 1000,
      ); // 4 hours

      this.sshSessions.set(client.id, {
        client: sshClient,
        stream,
        machineId: data.machineId,
        startTime: new Date(),
        timeoutId,
        inactivityTimer: this.createInactivityTimer(client),
      });

      await this.auditService.logAction(
        user.sub,
        'TERMINAL: SESSION_STARTED',
        {
          machineId: data.machineId,
          machineName: machine.name,
          ip: machine.ip,
        },
        user.authMethod,
        this.getClientIp(client),
        AuditCategory.TERMINAL,
      );

      client.emit('security-settings', {
        allowCopyPaste: machine.allowCopyPaste,
      });

      stream.on('data', (chunk: Buffer) => {
        if (this.sshSessions.has(client.id)) {
          const session = this.sshSessions.get(client.id)!;
          clearTimeout(session.inactivityTimer);
          session.inactivityTimer = this.createInactivityTimer(client);
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
        nowChecked - session.accessCache.lastChecked > 30000
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

    if (!session || !user) {
      client.emit('error', 'Session not found');
      return;
    }

    const nowChecked = Date.now();
    let isAllowed = session.accessCache?.allowed;
    if (
      !session.accessCache ||
      nowChecked - session.accessCache.lastChecked > 30000
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
