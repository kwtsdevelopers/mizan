import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ModuleId, Permission } from '@mizan/shared';
import { AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const MODULES_KEY = 'requiredModules';
export const RequireModules = (...modules: ModuleId[]): MethodDecorator & ClassDecorator =>
  SetMetadata(MODULES_KEY, modules);

export const PLATFORM_ONLY_KEY = 'platformOnly';
export const PlatformOnly = (): MethodDecorator & ClassDecorator => SetMetadata(PLATFORM_ONLY_KEY, true);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!req.authUser) {
    throw new Error('CurrentAuth used on an unauthenticated route');
  }
  return req.authUser;
});
