import { Test, TestingModule } from '@nestjs/testing';
import { SshGateway } from './ssh.gateway';
import { SshService } from './ssh.service';
import { MachinesService } from '../machines/machines.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../config/config.service';
import { RbacService } from '../rbac/rbac.service';
import { AuditService } from '../audit/audit.service';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { SessionRecorderService } from './recording/session-recorder.service';
import { Socket } from 'socket.io';

const createMockSocket = (overrides: Partial<Record<string, unknown>> = {}): jest.Mocked<Socket> => ({
  id: 'socket-1',
  data: {},
  emit: jest.fn(),
  disconnect: jest.fn(),
  handshake: {
    headers: { cookie: 'jwt=valid-token' },
    address: '127.0.0.1',
  },
  ...overrides,
} as unknown as jest.Mocked<Socket>);

describe('SshGateway', () => {
  let gateway: SshGateway;

  const mockJwtService = { verify: jest.fn(), sign: jest.fn() };
  const mockConfigService = { getOrThrow: jest.fn(() => 'test-secret') };
  const mockTokenBlacklist = { isBlacklisted: jest.fn(() => false) };
  const mockMachinesService = { findOne: jest.fn(), getDecryptedSecret: jest.fn() };
  const mockRbacService = { hasAccess: jest.fn(() => true) };
  const mockAuditService = { logAction: jest.fn() };
  const mockSshService = { createStream: jest.fn() };
  const mockRecorder = { start: jest.fn(), writeOutput: jest.fn(), end: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SshGateway,
        { provide: SshService, useValue: mockSshService },
        { provide: MachinesService, useValue: mockMachinesService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RbacService, useValue: mockRbacService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: TokenBlacklistService, useValue: mockTokenBlacklist },
        { provide: SessionRecorderService, useValue: mockRecorder },
      ],
    }).compile();

    gateway = module.get<SshGateway>(SshGateway);
  });

  describe('handleConnection', () => {
    it('should disconnect client without JWT cookie', async () => {
      const client = createMockSocket({ handshake: { headers: {}, address: '127.0.0.1' } });
      await gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should disconnect if JWT is blacklisted', async () => {
      const client = createMockSocket();
      mockTokenBlacklist.isBlacklisted.mockResolvedValueOnce(true);
      await gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should disconnect if JWT is invalid', async () => {
      const client = createMockSocket();
      mockJwtService.verify.mockImplementation(() => { throw new Error('Invalid'); });
      await gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should accept valid JWT and set user data', async () => {
      const client = createMockSocket();
      const payload = { sub: 'u1', role: 'USER' };
      mockJwtService.verify.mockReturnValue(payload);
      mockTokenBlacklist.isBlacklisted.mockResolvedValue(false);

      await gateway.handleConnection(client);
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.user).toEqual(payload);
    });

    it('should reject when user exceeds max sessions', async () => {
      const userId = 'heavy-user';
      const payload = { sub: userId, role: 'USER' };
      mockJwtService.verify.mockReturnValue(payload);
      mockTokenBlacklist.isBlacklisted.mockResolvedValue(false);

      // Fill up max sessions
      for (let i = 0; i < 5; i++) {
        const client = createMockSocket({ id: `socket-${i}` });
        await gateway.handleConnection(client);
      }

      const overflow = createMockSocket({ id: 'socket-overflow' });
      await gateway.handleConnection(overflow);
      expect(overflow.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should end recording on disconnect when session active', async () => {
      const client = createMockSocket();
      client.data.user = { sub: 'u1', authMethod: 'LOCAL' };

      // Inject a fake session
      (gateway as unknown as Record<string, unknown>)['sshSessions'].set('socket-1', {
        client: { end: jest.fn() },
        stream: { end: jest.fn() },
        machineId: 'm1',
        sessionId: 'session-abc',
        startTime: new Date(),
        timeoutId: setTimeout(() => {}, 999999),
        inactivityTimer: setTimeout(() => {}, 999999),
      });

      await gateway.handleDisconnect(client);
      expect(mockRecorder.end).toHaveBeenCalledWith('session-abc');
    });
  });
});
