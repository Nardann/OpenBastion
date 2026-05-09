import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Prisma, AuthMethod, Role } from '@prisma/client';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // SECURITY FIX: Exclude sensitive fields from API responses
  private sanitizeUser(
    user: User,
  ): Omit<
    User,
    'passwordHash' | 'tokenVersion' | 'externalId' | 'otpSecret' | 'pendingOtpSecret'
  > {
    const {
      passwordHash,
      tokenVersion,
      externalId,
      otpSecret,
      pendingOtpSecret,
      ...sanitized
    } = user;
    return sanitized;
  }

  // SECURITY FIX: Sanitize array of users
  private sanitizeUsers(
    users: User[],
  ): Omit<
    User,
    'passwordHash' | 'tokenVersion' | 'externalId' | 'otpSecret' | 'pendingOtpSecret'
  >[] {
    return users.map((user) => this.sanitizeUser(user));
  }

  async create(
    data: any,
  ): Promise<
    Omit<
      User,
      'passwordHash' | 'tokenVersion' | 'externalId' | 'otpSecret' | 'pendingOtpSecret'
    >
  > {
    const { password, ...userData } = data;

    const createData: Prisma.UserCreateInput = {
      ...userData,
      passwordHash: password ? await argon2.hash(password) : undefined,
    };

    const user = await this.prisma.user.create({ data: createData });
    return this.sanitizeUser(user);
  }

  async findAll(): Promise<
    Omit<
      User,
      'passwordHash' | 'tokenVersion' | 'externalId' | 'otpSecret' | 'pendingOtpSecret'
    >[]
  > {
    const users = (await this.prisma.user.findMany({
      include: {
        groups: true,
      },
    })) as unknown as User[];
    return this.sanitizeUsers(users);
  }

  async findOneByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: { groups: true },
    });
  }

  async findOneByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { username },
      include: { groups: true },
    });
  }

  /**
   * SECURITY: single-query lookup so no information leaks about which field
   * matched (used by anti-enumeration login path).
   */
  async findOneByEmailOrUsername(identifier: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
      include: { groups: true },
    });
  }

  async findOneById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: { groups: true, permissions: true },
    });
  }

  async findByExternalId(
    externalId: string,
    authMethod: AuthMethod,
  ): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { externalId, authMethod },
      include: { groups: true },
    });
  }

  async findOrCreateExternalUser(
    email: string,
    externalId: string,
    authMethod: AuthMethod,
  ): Promise<User> {
    const existing = await this.findByExternalId(externalId, authMethod);
    if (existing) return existing;

    // JIT Provisioning
    return this.create({
      email,
      externalId,
      authMethod,
      role: Role.USER,
    }) as Promise<User>;
  }

  async update(
    id: string,
    data: any,
  ): Promise<
    Omit<
      User,
      'passwordHash' | 'tokenVersion' | 'externalId' | 'otpSecret' | 'pendingOtpSecret'
    >
  > {
    const { password, ...userData } = data;
    const updateData: Prisma.UserUpdateInput = { ...userData };

    if (password) {
      updateData.passwordHash = await argon2.hash(password);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });
    return this.sanitizeUser(user);
  }

  async remove(
    id: string,
  ): Promise<
    Omit<
      User,
      'passwordHash' | 'tokenVersion' | 'externalId' | 'otpSecret' | 'pendingOtpSecret'
    >
  > {
    const user = await this.prisma.user.delete({ where: { id } });
    return this.sanitizeUser(user);
  }

  async revokeAllTokens(
    id: string,
  ): Promise<
    Omit<
      User,
      'passwordHash' | 'tokenVersion' | 'externalId' | 'otpSecret' | 'pendingOtpSecret'
    >
  > {
    // SECURITY: bumping tokenVersion only invalidates the current access JWT.
    // Without revoking the refresh tokens too, the target can immediately
    // POST /auth/refresh, get a JWT signed with the new tokenVersion, and
    // continue. Do BOTH atomically so admin revoke actually terminates the
    // session.
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return this.sanitizeUser(user);
  }
}
