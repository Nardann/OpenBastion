import {
  Controller,
  Get,
  UseGuards,
  Query,
  BadRequestException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  AuditService,
  AuditCategory,
  AuditEntities,
  AuditEntityType,
} from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

const ALLOWED_ENTITY_TYPES: AuditEntityType[] = [
  'user',
  'machine',
  'machineGroup',
  'group',
  'permission',
  'provider',
  'recording',
];

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

/**
 * Defence against the "parameter tampering" class flagged by CodeQL:
 * Express parses repeated query keys into an array, so
 * `?from=foo&from=bar` arrives as `from: ['foo', 'bar']`. Casting to
 * `string` without a runtime check silently passes the array into
 * downstream code where it can confuse `parseInt`, `new Date`,
 * `length` comparisons, and JSON-path queries. We assert string-or-
 * undefined at the controller boundary and reject otherwise.
 */
function asOptionalString(value: unknown, paramName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`Paramètre "${paramName}" invalide`);
  }
  return value;
}

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @SkipThrottle()
  @Roles(Role.ADMIN)
  async getLogs(
    @Query('category') categoryRaw?: unknown,
    @Query('entityType') entityTypeRaw?: unknown,
    @Query('entityId') entityIdRaw?: unknown,
    @Query('search') searchRaw?: unknown,
    @Query('from') fromRaw?: unknown,
    @Query('to') toRaw?: unknown,
    @Query('page') pageRaw?: unknown,
    @Query('limit') limitRaw?: unknown,
  ) {
    // Reject array-shaped query params before any downstream code can
    // be fooled — see `asOptionalString` for the threat model.
    const category = asOptionalString(categoryRaw, 'category');
    const entityType = asOptionalString(entityTypeRaw, 'entityType');
    const entityId = asOptionalString(entityIdRaw, 'entityId');
    const search = asOptionalString(searchRaw, 'search');
    const from = asOptionalString(fromRaw, 'from');
    const to = asOptionalString(toRaw, 'to');
    const page = asOptionalString(pageRaw, 'page');
    const limit = asOptionalString(limitRaw, 'limit');

    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = Math.min(limit ? parseInt(limit, 10) : 50, 200);
    if (isNaN(pageNumber) || pageNumber < 1)
      throw new BadRequestException('Page invalide');
    if (isNaN(limitNumber) || limitNumber < 1)
      throw new BadRequestException('Limit invalide');

    if (
      category &&
      !Object.values(AuditCategory).includes(category as AuditCategory)
    ) {
      throw new BadRequestException(`Catégorie d'audit invalide: ${category}`);
    }

    let typedEntityType: AuditEntityType | undefined;
    if (entityType !== undefined) {
      if (!ALLOWED_ENTITY_TYPES.includes(entityType as AuditEntityType)) {
        throw new BadRequestException(`entityType invalide: ${entityType}`);
      }
      typedEntityType = entityType as AuditEntityType;
    }
    if (typedEntityType && !entityId) {
      throw new BadRequestException('entityId requis quand entityType est fourni');
    }
    if (entityId && !UUID_RE.test(entityId)) {
      throw new BadRequestException('entityId doit être un UUID');
    }

    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) throw new BadRequestException('Date "from" invalide');
      fromDate = d;
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) throw new BadRequestException('Date "to" invalide');
      toDate = d;
    }

    if (search !== undefined && search.length > 200) {
      throw new BadRequestException('Recherche trop longue');
    }

    const filters: Parameters<typeof this.auditService.getLogs>[0] = {
      page: pageNumber,
      limit: limitNumber,
    };
    if (category) filters.category = category;
    if (typedEntityType) filters.entityType = typedEntityType;
    if (entityId) filters.entityId = entityId;
    const trimmedSearch = search?.trim();
    if (trimmedSearch) filters.search = trimmedSearch;
    if (fromDate) filters.from = fromDate;
    if (toDate) filters.to = toDate;
    return this.auditService.getLogs(filters);
  }

  /**
   * Resolve a batch of entity references → display labels. Accepts a
   * comma-separated list per type so an admin page can pre-render chips
   * without one DB query per entity. Capped at 200 ids per type.
   */
  @Get('entities/resolve')
  @SkipThrottle()
  @Roles(Role.ADMIN)
  async resolveEntities(
    @Query('users') usersRaw?: unknown,
    @Query('machines') machinesRaw?: unknown,
    @Query('machineGroups') machineGroupsRaw?: unknown,
    @Query('groups') groupsRaw?: unknown,
    @Query('permissions') permissionsRaw?: unknown,
    @Query('providers') providersRaw?: unknown,
    @Query('recordings') recordingsRaw?: unknown,
  ) {
    const users = asOptionalString(usersRaw, 'users');
    const machines = asOptionalString(machinesRaw, 'machines');
    const machineGroups = asOptionalString(machineGroupsRaw, 'machineGroups');
    const groups = asOptionalString(groupsRaw, 'groups');
    const permissions = asOptionalString(permissionsRaw, 'permissions');
    const providers = asOptionalString(providersRaw, 'providers');
    const recordings = asOptionalString(recordingsRaw, 'recordings');

    const parse = (raw?: string): string[] => {
      if (!raw) return [];
      const ids = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length > 200) {
        throw new BadRequestException('Trop d\'entités à résoudre (max 200)');
      }
      for (const id of ids) {
        if (!UUID_RE.test(id)) {
          throw new BadRequestException(`UUID invalide: ${id}`);
        }
      }
      return ids;
    };

    const refs: AuditEntities = {
      users: parse(users),
      machines: parse(machines),
      machineGroups: parse(machineGroups),
      groups: parse(groups),
      permissions: parse(permissions),
      providers: parse(providers),
      recordings: parse(recordings),
    };

    return this.auditService.resolveEntities(refs);
  }

  @Get('verify-integrity')
  @Roles(Role.ADMIN)
  async verifyIntegrity(
    @Query('limit', new DefaultValuePipe(1000), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 10_000);
    return this.auditService.verifyIntegrity(safeLimit);
  }
}
