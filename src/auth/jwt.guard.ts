import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { appEnv } from '../config/env';
import type { Request } from 'express';

function tryExtractUser(request: Request): boolean {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, appEnv.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    const req = request as unknown as Record<string, unknown>;
    req.userId = String(payload.sub ?? '');
    req.userRole = String(payload.role ?? '');
    req.userRoles = Array.isArray(payload.roles)
      ? payload.roles.map((role) => String(role))
      : [String(payload.role ?? '')].filter(Boolean);
    return Boolean(req.userId);
  } catch {
    return false;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!tryExtractUser(request)) {
      throw new UnauthorizedException('Missing or invalid authorization token');
    }
    return true;
  }
}

@Injectable()
export class JwtOptionalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    tryExtractUser(context.switchToHttp().getRequest<Request>());
    return true;
  }
}
