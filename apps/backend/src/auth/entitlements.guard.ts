import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { AuthScope, ModuleId } from '@mizan/shared';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { IS_PUBLIC_KEY, MODULES_KEY } from './decorators';

/** Backend enforcement of purchased module entitlements. */
@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<ModuleId[]>(MODULES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const user = req.authUser;
    if (!user || user.scope !== AuthScope.Tenant || !user.tenantId) {
      throw new ForbiddenException('Tenant context required');
    }

    const enabled = await this.entitlements.enabledModules(user.tenantId);
    const missing = required.filter((m) => !enabled.has(m));
    if (missing.length > 0) {
      throw new ForbiddenException(`Module not included in subscription: ${missing.join(', ')}`);
    }
    return true;
  }
}
