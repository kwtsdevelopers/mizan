import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { AuthScope, Permission } from '@mizan/shared';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, PLATFORM_ONLY_KEY } from './decorators';

/**
 * Enforces platform/tenant scope and fine-grained permissions.
 * Runs after JwtAuthGuard.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const user = req.authUser;
    if (!user) throw new ForbiddenException('No authenticated user');

    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (platformOnly) {
      if (user.scope !== AuthScope.Platform) {
        throw new ForbiddenException('Platform administrator access required');
      }
      return true;
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    if (user.scope !== AuthScope.Tenant || !user.tenantId) {
      // Platform admins have no implicit access to tenant business data.
      throw new ForbiddenException('Tenant membership required');
    }

    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permissions: ${missing.join(', ')}`);
    }
    return true;
  }
}
