import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) return false;

    // Strict Sudo check: If the route requires ADMIN and the user IS an admin,
    // they MUST have activated Sudo mode (isAdminMode).
    // If the route is open to USER and the user is a USER, this check is skipped.
    const requiresOnlyAdmin =
      requiredRoles.includes(Role.ADMIN) && requiredRoles.length === 1;

    if (user.role === Role.ADMIN && (requiresOnlyAdmin || user.isAdminMode)) {
      if (requiresOnlyAdmin && !user.isAdminMode) {
        return false;
      }
    }

    return true;
  }
}
