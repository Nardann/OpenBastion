import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { AuthMethod, Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';

export enum AuditCategory {
  AUTH = 'AUTH',
  USER = 'USER',
  GROUP = 'GROUP',
  MACHINE = 'MACHINE',
  MACHINE_GROUP = 'MACHINE_GROUP',
  PERMISSION = 'PERMISSION',
  SYSTEM = 'SYSTEM',
  TERMINAL = 'TERMINAL',
  RECORDING = 'RECORDING',
}

/**
 * Entity types referenced by an audit log. Used both to populate the
 * `metadata.entities` block (so the frontend can render clickable chips)
 * and to filter logs by an entity from any admin page.
 */
export type AuditEntityType =
  | 'user'
  | 'machine'
  | 'machineGroup'
  | 'group'
  | 'permission'
  | 'provider'
  | 'recording';

export interface AuditEntities {
  users?: string[];
  machines?: string[];
  machineGroups?: string[];
  groups?: string[];
  permissions?: string[];
  providers?: string[];
  recordings?: string[];
}

/** Map of audit entity type → metadata.entities[] key. */
const ENTITY_FIELD: Record<AuditEntityType, keyof AuditEntities> = {
  user: 'users',
  machine: 'machines',
  machineGroup: 'machineGroups',
  group: 'groups',
  permission: 'permissions',
  provider: 'providers',
  recording: 'recordings',
};

export interface AuditLogPayload {
  /** Who triggered the action (acting user). Null = system/cron/bootstrap. */
  actorId: string | null;
  /** Human-readable action key, e.g. "MACHINE: CREATED". */
  action: string;
  /** Audit category (defaults to SYSTEM). */
  category?: AuditCategory;
  /** Authentication method used by the actor (carried from JWT). */
  authMethod?: AuthMethod | null;
  /** Client IP, already extracted upstream. */
  ipAddress?: string | null;
  /** Free-form details — secrets MUST be redacted by the caller. */
  details?: Record<string, unknown> | null;
  /**
   * Entities referenced by this event. Frontend uses these to render
   * clickable chips that jump back to the same log filter, and to filter
   * "show me everything touching this user / machine / group".
   */
  entities?: AuditEntities;
}

@Injectable()
export class AuditService {
  private readonly hmacKey: Buffer;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const vaultKey = this.config.get('VAULT_KEY') ?? '';
    // Derive a dedicated HMAC key from VAULT_KEY so it's independent from encryption keys.
    this.hmacKey = crypto
      .createHmac('sha256', Buffer.from(vaultKey, 'hex'))
      .update('audit-log-hmac-v1')
      .digest();
  }

  /**
   * Canonical JSON serializer — sorts object keys recursively before
   * stringifying. Required because PostgreSQL JSONB does NOT preserve
   * the insertion order of object keys, so a row written with
   * `{a:1, b:2}` may be read back as `{b:2, a:1}`. Without canonical
   * order, `verifyIntegrity()` would flag perfectly intact rows as
   * tampered (audit-2026-06 finding #3).
   *
   * Arrays preserve their order (Postgres JSONB does too); only object
   * key order is normalised. `Date` instances are converted to ISO
   * strings so they round-trip cleanly through JSONB.
   */
  private canonicalStringify(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.canonicalStringify(v)).join(',') + ']';
    }
    if (t === 'object') {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return (
        '{' +
        keys
          .map(
            (k) =>
              JSON.stringify(k) + ':' + this.canonicalStringify(obj[k]),
          )
          .join(',') +
        '}'
      );
    }
    return 'null';
  }

  private computeHmac(entry: {
    id: string;
    action: string;
    userId: string | null;
    timestamp: Date;
    category: string | null;
    ipAddress: string | null;
    metadata: any;
    userSnapshot: any;
  }): string {
    // Canonical JSON: object keys sorted recursively. See
    // `canonicalStringify` for the full rationale.
    const payload = this.canonicalStringify({
      id: entry.id,
      action: entry.action,
      userId: entry.userId ?? null,
      timestamp: entry.timestamp.toISOString(),
      category: entry.category ?? null,
      ipAddress: entry.ipAddress ?? null,
      metadata: entry.metadata ?? null,
      userSnapshot: entry.userSnapshot ?? null,
    });
    return crypto.createHmac('sha256', this.hmacKey).update(payload).digest('hex');
  }

  /**
   * Legacy HMAC algorithm (pre-audit-2026-06): plain `JSON.stringify`
   * with no key sorting. Kept ONLY so `verifyIntegrity` can validate
   * rows written before the canonical fix without flagging them as
   * tampered. New writes always use `computeHmac` above.
   *
   * The legacy algorithm is technically vulnerable to false positives
   * (JSONB key reorder), but a row that successfully verified under
   * the legacy code path before the upgrade still verifies under the
   * legacy fallback after the upgrade — the integrity guarantee is
   * preserved across the boundary, and nothing weakens.
   */
  private computeLegacyHmac(entry: {
    id: string;
    action: string;
    userId: string | null;
    timestamp: Date;
    category: string | null;
    ipAddress: string | null;
    metadata: any;
    userSnapshot: any;
  }): string {
    const payload = JSON.stringify({
      id: entry.id,
      action: entry.action,
      userId: entry.userId ?? null,
      timestamp: entry.timestamp.toISOString(),
      category: entry.category ?? null,
      ipAddress: entry.ipAddress ?? null,
      metadata: entry.metadata ?? null,
      userSnapshot: entry.userSnapshot ?? null,
    });
    return crypto.createHmac('sha256', this.hmacKey).update(payload).digest('hex');
  }

  /**
   * Normalise entity ids → unique, non-empty strings. Empty arrays are
   * dropped from the resulting object so audit rows aren't bloated with
   * `{ users: [], machines: [], ... }`.
   */
  private normaliseEntities(entities?: AuditEntities): AuditEntities | null {
    if (!entities) return null;
    const out: AuditEntities = {};
    let any = false;
    for (const k of Object.keys(entities) as Array<keyof AuditEntities>) {
      const raw = entities[k];
      if (!Array.isArray(raw)) continue;
      const uniq = Array.from(
        new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0)),
      );
      if (uniq.length > 0) {
        out[k] = uniq;
        any = true;
      }
    }
    return any ? out : null;
  }

  /**
   * Modern entrypoint. Prefer this over `logAction` in new code — it
   * produces a structured `entities` block which is what the admin UI
   * needs to render clickable chips.
   */
  async log(payload: AuditLogPayload) {
    const category = payload.category ?? AuditCategory.SYSTEM;
    const details = payload.details ?? null;
    const entities = this.normaliseEntities(payload.entities);

    // Auto-add the actor to entities.users so a per-user filter catches
    // every event the actor produced.
    const finalEntities: AuditEntities = entities ? { ...entities } : {};
    if (payload.actorId) {
      const users = new Set(finalEntities.users ?? []);
      users.add(payload.actorId);
      finalEntities.users = Array.from(users);
    }
    const finalEntitiesValue = Object.keys(finalEntities).length > 0 ? finalEntities : null;

    const metadata =
      details || finalEntitiesValue
        ? { ...(details ?? {}), entities: finalEntitiesValue ?? undefined }
        : null;

    return this.createRow({
      userId: payload.actorId,
      action: payload.action,
      category,
      authMethod: payload.authMethod ?? null,
      ipAddress: payload.ipAddress ?? null,
      metadata,
    });
  }

  /**
   * Legacy signature kept for the dozens of existing call sites. New
   * features should call `log(...)` instead so the entities chips render
   * cleanly. We do best-effort entity extraction here from common keys
   * (targetUserId, machineId, …) so even legacy events get chips.
   */
  async logAction(
    userId: string | null,
    action: string,
    metadata?: any,
    authMethod?: AuthMethod | null,
    ipAddress?: string | null,
    category: AuditCategory = AuditCategory.SYSTEM,
  ) {
    const normalizedMetadata = metadata
      ? typeof metadata === 'object'
        ? metadata
        : { value: metadata }
      : null;

    const extracted = this.extractEntitiesFromLegacyMetadata(normalizedMetadata);
    const finalEntities: AuditEntities = { ...extracted };
    if (userId) {
      const users = new Set(finalEntities.users ?? []);
      users.add(userId);
      finalEntities.users = Array.from(users);
    }
    const finalEntitiesValue =
      Object.keys(finalEntities).length > 0 ? finalEntities : null;

    const finalMetadata =
      normalizedMetadata || finalEntitiesValue
        ? {
            ...(normalizedMetadata ?? {}),
            entities: finalEntitiesValue ?? undefined,
          }
        : null;

    return this.createRow({
      userId,
      action,
      category,
      authMethod: authMethod ?? null,
      ipAddress: ipAddress ?? null,
      metadata: finalMetadata,
    });
  }

  /**
   * Heuristic mapping for the legacy `logAction` callers — pulls common
   * field names out of the metadata so they show up as clickable chips
   * without rewriting every call site at once.
   */
  private extractEntitiesFromLegacyMetadata(meta: any): AuditEntities {
    if (!meta || typeof meta !== 'object') return {};
    const e: AuditEntities = {};
    const pushUser = (id?: unknown) => {
      if (typeof id === 'string' && id.length > 0) {
        e.users = Array.from(new Set([...(e.users ?? []), id]));
      }
    };
    const pushMachine = (id?: unknown) => {
      if (typeof id === 'string' && id.length > 0) {
        e.machines = Array.from(new Set([...(e.machines ?? []), id]));
      }
    };
    const pushMachineGroup = (id?: unknown) => {
      if (typeof id === 'string' && id.length > 0) {
        e.machineGroups = Array.from(new Set([...(e.machineGroups ?? []), id]));
      }
    };
    const pushGroup = (id?: unknown) => {
      if (typeof id === 'string' && id.length > 0) {
        e.groups = Array.from(new Set([...(e.groups ?? []), id]));
      }
    };
    const pushPermission = (id?: unknown) => {
      if (typeof id === 'string' && id.length > 0) {
        e.permissions = Array.from(new Set([...(e.permissions ?? []), id]));
      }
    };
    const pushProvider = (id?: unknown) => {
      if (typeof id === 'string' && id.length > 0) {
        e.providers = Array.from(new Set([...(e.providers ?? []), id]));
      }
    };
    const pushRecording = (id?: unknown) => {
      if (typeof id === 'string' && id.length > 0) {
        e.recordings = Array.from(new Set([...(e.recordings ?? []), id]));
      }
    };

    pushUser(meta.userId);
    pushUser(meta.targetUserId);
    pushUser(meta.actorId);
    pushMachine(meta.machineId);
    pushMachineGroup(meta.machineGroupId);
    pushGroup(meta.groupId);
    pushPermission(meta.permissionId);
    pushProvider(meta.providerId);
    pushProvider(meta.authProviderId);
    pushRecording(meta.recordingId);
    pushRecording(meta.sessionId);

    return e;
  }

  private async createRow(input: {
    userId: string | null;
    action: string;
    category: AuditCategory;
    authMethod: AuthMethod | null;
    ipAddress: string | null;
    metadata: any;
  }) {
    let userSnapshot = null;
    if (input.userId) {
      const user = await this.prisma.user
        .findUnique({
          where: { id: input.userId },
          select: { email: true, username: true, role: true },
        })
        .catch(() => null);
      if (user) userSnapshot = user;
    }

    const id = crypto.randomUUID();
    const timestamp = new Date();

    const hmac = this.computeHmac({
      id,
      action: input.action,
      userId: input.userId,
      timestamp,
      category: input.category,
      ipAddress: input.ipAddress,
      metadata: input.metadata,
      userSnapshot,
    });

    return this.prisma.auditLog.create({
      data: {
        id,
        userId: input.userId,
        userSnapshot: userSnapshot as any,
        action: input.action,
        category: input.category,
        metadata: input.metadata,
        authMethod: input.authMethod ?? null,
        ipAddress: input.ipAddress ?? null,
        timestamp,
        hmac,
      },
    });
  }

  /**
   * List audit logs with optional filters.
   *
   * @param entityType / entityId — match logs that mention this entity in
   *   their `metadata.entities` block. The acting user is also indexed
   *   under `entities.users` so a per-user query catches both "things they
   *   did" and "things done to them".
   * @param search — substring matched against the action label OR the IP.
   * @param from / to — ISO timestamps, inclusive.
   */
  async getLogs(opts: {
    category?: string;
    entityType?: AuditEntityType;
    entityId?: string;
    search?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  } = {}) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;

    const where: Prisma.AuditLogWhereInput = {};
    const andClauses: Prisma.AuditLogWhereInput[] = [];

    if (opts.category) where.category = opts.category;
    if (opts.from || opts.to) {
      where.timestamp = {};
      if (opts.from) (where.timestamp as any).gte = opts.from;
      if (opts.to) (where.timestamp as any).lte = opts.to;
    }

    if (opts.search) {
      // Substring search on action label OR IP. Prisma applies these
      // case-insensitively against `text` columns on Postgres.
      andClauses.push({
        OR: [
          { action: { contains: opts.search, mode: 'insensitive' } },
          { ipAddress: { contains: opts.search } },
        ],
      });
    }

    if (opts.entityType && opts.entityId) {
      const arrayKey = ENTITY_FIELD[opts.entityType];
      // Match logs whose metadata.entities.<arrayKey> array contains the id.
      // We use `path` + `array_contains` so Postgres can use a GIN index on
      // the JSONB column if/when one is added.
      const path = ['entities', arrayKey];
      andClauses.push({
        metadata: {
          path,
          array_contains: [opts.entityId],
        } as any,
      });
    }

    if (andClauses.length > 0) where.AND = andClauses;

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              role: true,
              authMethod: true,
            },
          },
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Resolve a batch of entity references to display labels. Used by the
   * admin UI to render chips even when the underlying row has since been
   * renamed or deleted (returns `deleted: true` in that case).
   *
   * Accepts a map `{ users: [...ids], machines: [...ids], ... }` and
   * returns an object keyed by type → array of `{id, label, deleted}`.
   */
  async resolveEntities(refs: AuditEntities): Promise<Record<string, Array<{ id: string; label: string; deleted: boolean }>>> {
    const out: Record<string, Array<{ id: string; label: string; deleted: boolean }>> = {};

    const dedupe = (arr?: string[]) => Array.from(new Set(arr ?? [])).filter(Boolean);

    const userIds = dedupe(refs.users);
    if (userIds.length) {
      const rows = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, username: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      out.users = userIds.map((id) => {
        const r = byId.get(id);
        return {
          id,
          label: r ? (r.username || r.email) : `user:${id.slice(0, 8)}`,
          deleted: !r,
        };
      });
    }

    const machineIds = dedupe(refs.machines);
    if (machineIds.length) {
      const rows = await this.prisma.machine.findMany({
        where: { id: { in: machineIds } },
        select: { id: true, name: true, ip: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      out.machines = machineIds.map((id) => {
        const r = byId.get(id);
        return {
          id,
          label: r ? `${r.name} (${r.ip})` : `machine:${id.slice(0, 8)}`,
          deleted: !r,
        };
      });
    }

    const machineGroupIds = dedupe(refs.machineGroups);
    if (machineGroupIds.length) {
      const rows = await this.prisma.machineGroup.findMany({
        where: { id: { in: machineGroupIds } },
        select: { id: true, name: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      out.machineGroups = machineGroupIds.map((id) => {
        const r = byId.get(id);
        return { id, label: r?.name ?? `machine-group:${id.slice(0, 8)}`, deleted: !r };
      });
    }

    const groupIds = dedupe(refs.groups);
    if (groupIds.length) {
      const rows = await this.prisma.group.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, name: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      out.groups = groupIds.map((id) => {
        const r = byId.get(id);
        return { id, label: r?.name ?? `group:${id.slice(0, 8)}`, deleted: !r };
      });
    }

    const providerIds = dedupe(refs.providers);
    if (providerIds.length) {
      const rows = await this.prisma.authProvider.findMany({
        where: { id: { in: providerIds } },
        select: { id: true, name: true, type: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      out.providers = providerIds.map((id) => {
        const r = byId.get(id);
        return {
          id,
          label: r ? `${r.name} (${r.type})` : `provider:${id.slice(0, 8)}`,
          deleted: !r,
        };
      });
    }

    // Permissions and recordings: we don't usually need a fancy label,
    // just echo the short id. The frontend can present "permission #abc"
    // without an extra DB hit.
    const permissionIds = dedupe(refs.permissions);
    if (permissionIds.length) {
      out.permissions = permissionIds.map((id) => ({
        id,
        label: `permission:${id.slice(0, 8)}`,
        deleted: false,
      }));
    }

    const recordingIds = dedupe(refs.recordings);
    if (recordingIds.length) {
      out.recordings = recordingIds.map((id) => ({
        id,
        label: `recording:${id.slice(0, 8)}`,
        deleted: false,
      }));
    }

    return out;
  }

  async verifyIntegrity(limit: number = 1000): Promise<{
    checked: number;
    tampered: string[];
    nullHmac: number;
    legacyHmac: number;
  }> {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    const tampered: string[] = [];
    let nullHmac = 0;
    let legacyHmac = 0;

    for (const log of logs) {
      if (!log.hmac) {
        nullHmac++;
        continue;
      }
      const input = {
        id: log.id,
        action: log.action,
        userId: log.userId ?? null,
        timestamp: log.timestamp,
        category: log.category ?? null,
        ipAddress: log.ipAddress ?? null,
        metadata: log.metadata ?? null,
        userSnapshot: log.userSnapshot ?? null,
      };
      // Try the canonical algorithm first (post-audit-2026-06). If it
      // doesn't match, fall back to the legacy non-canonical algorithm
      // so rows written before the upgrade still verify cleanly. Only
      // when BOTH fail do we flag the row as tampered.
      const expectedCanonical = this.computeHmac(input);
      if (expectedCanonical === log.hmac) continue;

      const expectedLegacy = this.computeLegacyHmac(input);
      if (expectedLegacy === log.hmac) {
        legacyHmac++;
        continue;
      }

      tampered.push(log.id);
    }

    return { checked: logs.length, tampered, nullHmac, legacyHmac };
  }
}
