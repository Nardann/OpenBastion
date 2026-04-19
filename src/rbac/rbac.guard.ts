import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { AccessLevel } from '@prisma/client';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private rbacService: RbacService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredLevel = this.reflector.get<AccessLevel>(
      'accessLevel',
      context.getHandler(),
    );
    if (!requiredLevel) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) throw new UnauthorizedException();

    // Try to find machineId in multiple places
    const machineId =
      request.params.id || request.body.machineId || request.query.machineId;

    if (!machineId) {
      // If a level is required but no machineId is provided, it's a suspicious request
      throw new ForbiddenException('Resource context missing for access check');
    }

    const hasAccess = await this.rbacService.hasAccess(
      user.sub,
      machineId,
      requiredLevel,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        `Insufficient permissions for machine ${machineId}`,
      );
    }

    return true;
  }
}
