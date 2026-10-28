import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import type { Request } from 'express';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const req = request as unknown as Record<string, unknown>;
    const role = typeof req.userRole === 'string' ? req.userRole : '';
    const rolesFromToken = Array.isArray(req.userRoles)
      ? (req.userRoles as unknown[]).map((item) => String(item))
      : [];

    const userRoles = new Set<string>([role, ...rolesFromToken].filter(Boolean));
    const allowed = requiredRoles.some((required) => userRoles.has(required));

    if (!allowed) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return true;
  }
}
