import { AuthScope, Permission } from '@mizan/shared';

/** Verified identity attached to each authenticated request. */
export interface AuthUser {
  userId: string;
  scope: AuthScope;
  /** present only for tenant scope */
  tenantId?: string;
  roles: string[];
  permissions: Permission[];
  branchIds: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}
