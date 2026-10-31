/** Platform-level and tenant-level security model. */

export enum AuthScope {
  Platform = 'platform',
  Tenant = 'tenant',
}

export enum PlatformRole {
  PlatformAdmin = 'platform_admin',
}

export enum TenantRole {
  Owner = 'owner',
  Admin = 'admin',
  BranchManager = 'branch_manager',
  Cashier = 'cashier',
  InventoryOperator = 'inventory_operator',
  Accountant = 'accountant',
}

export enum Permission {
  // catalog
  CatalogRead = 'catalog:read',
  CatalogWrite = 'catalog:write',
  // inventory
  InventoryRead = 'inventory:read',
  InventoryWrite = 'inventory:write',
  // sales
  SalesCheckout = 'sales:checkout',
  SalesRead = 'sales:read',
  SalesRefund = 'sales:refund',
  SalesVoid = 'sales:void',
  SalesSync = 'sales:sync',
  // customers / suppliers
  CustomersRead = 'customers:read',
  CustomersWrite = 'customers:write',
  SuppliersRead = 'suppliers:read',
  SuppliersWrite = 'suppliers:write',
  // purchasing
  PurchasingRead = 'purchasing:read',
  PurchasingWrite = 'purchasing:write',
  // reporting
  ReportsRead = 'reports:read',
  // cashier sessions
  CashSessionManage = 'cash:session',
  // tenant administration
  UsersManage = 'users:manage',
  SettingsManage = 'settings:manage',
  AuditRead = 'audit:read',
}

export const TENANT_ROLE_PERMISSIONS: Record<TenantRole, Permission[]> = {
  [TenantRole.Owner]: Object.values(Permission),
  [TenantRole.Admin]: Object.values(Permission),
  [TenantRole.BranchManager]: [
    Permission.CatalogRead,
    Permission.CatalogWrite,
    Permission.InventoryRead,
    Permission.InventoryWrite,
    Permission.SalesCheckout,
    Permission.SalesRead,
    Permission.SalesRefund,
    Permission.SalesVoid,
    Permission.SalesSync,
    Permission.CustomersRead,
    Permission.CustomersWrite,
    Permission.SuppliersRead,
    Permission.PurchasingRead,
    Permission.PurchasingWrite,
    Permission.ReportsRead,
    Permission.CashSessionManage,
  ],
  [TenantRole.Cashier]: [
    Permission.CatalogRead,
    Permission.SalesCheckout,
    Permission.SalesRead,
    Permission.SalesSync,
    Permission.CustomersRead,
    Permission.CashSessionManage,
  ],
  [TenantRole.InventoryOperator]: [
    Permission.CatalogRead,
    Permission.CatalogWrite,
    Permission.InventoryRead,
    Permission.InventoryWrite,
    Permission.SuppliersRead,
    Permission.SuppliersWrite,
    Permission.PurchasingRead,
    Permission.PurchasingWrite,
  ],
  [TenantRole.Accountant]: [
    Permission.SalesRead,
    Permission.ReportsRead,
    Permission.CustomersRead,
    Permission.SuppliersRead,
    Permission.PurchasingRead,
    Permission.AuditRead,
  ],
};

export function permissionsForRoles(roles: TenantRole[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const p of TENANT_ROLE_PERMISSIONS[role] ?? []) set.add(p);
  }
  return [...set];
}

export interface AccessTokenPayload {
  /** user id */
  sub: string;
  scope: AuthScope;
  /** tenant id; absent for platform scope */
  tid?: string;
  roles: string[];
  /** token type */
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  scope: AuthScope;
  tid?: string;
  /** rotation id */
  rid: string;
  typ: 'refresh';
}
