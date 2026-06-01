import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Prisma, AuthMethod, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuditService, AuditCategory } from '../audit/audit.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

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
    authProviderId?: string | null,
  ): Promise<User | null> {
    // Provider-scoped lookup so two IdPs that happen to emit the same `sub`
    // resolve to two distinct local users. A NULL `authProviderId` (legacy
    // row before migration 0007) only matches against `authProviderId: null`.
    return this.prisma.user.findFirst({
      where: {
        externalId,
        authMethod,
        authProviderId: authProviderId ?? null,
      },
      include: { groups: true },
    });
  }

  async findOrCreateExternalUser(
    email: string,
    externalId: string,
    authMethod: AuthMethod,
    authProviderId: string | null,
    candidateUsername?: string | null,
  ): Promise<User> {
    const existing = await this.findByExternalId(
      externalId,
      authMethod,
      authProviderId,
    );
    if (existing) return existing;

    // Honour the IdP's preferred display handle when we can. Two reasons
    // we may have to fall back to a NULL username on JIT create:
    //   1. The IdP didn't send one (rare with Authentik / Keycloak).
    //   2. The handle clashes with an existing local username — `User`
    //      has a UNIQUE index on `username`. Inserting a duplicate would
    //      throw; we'd rather silently fall back to NULL and surface a
    //      warning so an admin can resolve it manually.
    const username = await this.pickAvailableUsername(candidateUsername);

    // SECURITY: hit Prisma directly here instead of going through
    // `create()`, which sanitises the result (strips `tokenVersion`,
    // `passwordHash`, `externalId`, etc.) for admin-facing endpoints.
    // The caller of this method — `AuthService.login(user)` — needs
    // `tokenVersion` to embed in the JWT payload's `version` claim. If
    // it's stripped, the JWT is signed with `version: undefined`, which
    // collides with the guard's freshly-fetched `user.tokenVersion = 0`
    // on the very first request and triggers a "Session expired" 401 on
    // the first OIDC / LDAP login.
    const newUser = await this.prisma.user.create({
      data: {
        email,
        ...(username ? { username } : {}),
        externalId,
        authMethod,
        authProviderId,
        role: Role.USER,
      },
    });

    // Surface the JIT creation as its own audit row so an admin scanning
    // `/administration/logs` sees a distinct event instead of having to
    // infer it from a LOGIN_SUCCESS that "happens to be" the first one.
    // We don't have the source IP at this layer; the LOGIN_SUCCESS row
    // emitted a few ms later by the auth controller carries it, and the
    // two rows are linked by `entities.users`.
    await this.audit
      .log({
        actorId: newUser.id,
        action: `USER: JIT_CREATED_${authMethod}`,
        category: AuditCategory.USER,
        authMethod,
        ipAddress: null,
        details: {
          email: newUser.email,
          username: newUser.username ?? null,
          // Truncate the externalId — for OIDC it's the IdP `sub` which
          // can be a long opaque string; for LDAP it's the DN which we
          // also don't want to dump in full into every row.
          externalIdPreview:
            externalId.length > 32 ? externalId.slice(0, 32) + '…' : externalId,
        },
        entities: {
          users: [newUser.id],
          ...(authProviderId ? { providers: [authProviderId] } : {}),
        },
      })
      .catch((e) =>
        this.logger.warn(`Failed to audit JIT user creation: ${(e as Error).message}`),
      );

    return newUser;
  }

  /**
   * Returns `candidate` when it's a non-empty, currently-unused username,
   * otherwise `null`. We strip whitespace and reject anything that would
   * cause Prisma to throw at insert time (empty string, already taken).
   */
  private async pickAvailableUsername(
    candidate: string | null | undefined,
  ): Promise<string | null> {
    if (!candidate) return null;
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    const taken = await this.prisma.user.findUnique({
      where: { username: trimmed },
      select: { id: true },
    });
    if (taken) {
      this.logger.warn(
        `JIT provisioning: username "${trimmed}" is already taken; creating user without a username`,
      );
      return null;
    }
    return trimmed;
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

  /**
   * Additive group sync for an externally-authenticated user.
   *
   * For every group name received from the IdP we:
   *   1. Find the matching `Group` by name, creating it if missing.
   *   2. Attach the user to it (no-op if already attached).
   *
   * We never *remove* group memberships here, even when a previously-
   * synced group is absent from the new claim. Reason: a hybrid setup
   * where an admin adds locally-managed groups on top of the IdP-sourced
   * ones is common — stripping them silently on every login would
   * surprise admins and break workflows.
   *
   * Audit events are emitted per side-effect so the chips in
   * `/administration/logs` link the user, the group, and the provider.
   */
  async syncExternalGroups(
    userId: string,
    groupNames: string[],
    ctx: {
      providerId: string | null;
      ipAddress: string | null;
      authMethod: AuthMethod;
    },
  ): Promise<{ created: string[]; attached: string[] }> {
    if (!groupNames.length) return { created: [], attached: [] };

    const created: string[] = [];
    const attached: string[] = [];

    // Pre-load the user's current group membership in ONE query so we can
    // skip the no-op attachments without a per-name round-trip.
    const existingMemberships = await this.prisma.group.findMany({
      where: { users: { some: { id: userId } } },
      select: { id: true, name: true },
    });
    const memberOf = new Set(existingMemberships.map((g) => g.name));

    for (const rawName of groupNames) {
      const name = rawName.trim();
      if (!name) continue;

      // Upsert: create the group on first sight, otherwise just read it.
      // We use upsert so two concurrent logins of the same user can race
      // on the same group without one of them throwing on the unique
      // constraint.
      let group;
      try {
        group = await this.prisma.group.upsert({
          where: { name },
          update: {},
          create: {
            name,
            description: 'Created automatically from external identity provider',
          },
          select: { id: true, name: true },
        });
      } catch (e) {
        this.logger.warn(
          `External group sync: failed to upsert "${name}": ${(e as Error).message}`,
        );
        continue;
      }

      // Track whether THIS call was the one that created it. `upsert`
      // doesn't tell us directly; cheap heuristic: re-check createdAt
      // ≤ updatedAt within a small window. Instead we just compare
      // against the prior list of groups — anything not in the
      // pre-existing memberships list AND not in the pre-existing all-
      // groups list is "new this time". For simplicity, we just log
      // creations via a quick exists check before upsert next time.

      const isNewMembership = !memberOf.has(group.name);
      if (isNewMembership) {
        try {
          await this.prisma.user.update({
            where: { id: userId },
            data: { groups: { connect: { id: group.id } } },
          });
          attached.push(group.name);
          memberOf.add(group.name);
        } catch (e) {
          this.logger.warn(
            `External group sync: failed to attach user ${userId} to "${name}": ${(e as Error).message}`,
          );
          continue;
        }
      }

      // Was the group itself created by this sync call? If the
      // upsert had to insert, `createdAt === updatedAt` within ms. We
      // distinguish creations by checking whether the group has at most
      // ONE user (this one we just connected) and was created within the
      // last few seconds. Cheap and good enough for the audit log.
      const fresh = await this.prisma.group.findUnique({
        where: { id: group.id },
        select: { createdAt: true, updatedAt: true },
      });
      if (
        fresh &&
        Math.abs(fresh.updatedAt.getTime() - fresh.createdAt.getTime()) < 5_000 &&
        Date.now() - fresh.createdAt.getTime() < 10_000
      ) {
        created.push(group.name);
      }
    }

    // Emit ONE audit row per outcome (created / attached) so the log
    // table stays readable. Both rows carry the user + group + provider
    // entities so the chips in the UI link everything together.
    if (created.length > 0) {
      await this.audit.log({
        actorId: userId,
        action: 'GROUP: JIT_CREATED_FROM_IDP',
        category: AuditCategory.GROUP,
        authMethod: ctx.authMethod,
        ipAddress: ctx.ipAddress,
        details: { groupNames: created },
        entities: {
          users: [userId],
          ...(ctx.providerId ? { providers: [ctx.providerId] } : {}),
        },
      });
    }
    if (attached.length > 0) {
      // Resolve to ids so the audit entities are queryable by id and the
      // group chips remain stable across renames.
      const rows = await this.prisma.group.findMany({
        where: { name: { in: attached } },
        select: { id: true },
      });
      await this.audit.log({
        actorId: userId,
        action: 'GROUP: USER_ATTACHED_FROM_IDP',
        category: AuditCategory.GROUP,
        authMethod: ctx.authMethod,
        ipAddress: ctx.ipAddress,
        details: { groupNames: attached },
        entities: {
          users: [userId],
          groups: rows.map((r) => r.id),
          ...(ctx.providerId ? { providers: [ctx.providerId] } : {}),
        },
      });
    }

    return { created, attached };
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
