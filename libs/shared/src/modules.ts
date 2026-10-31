/** Industry/module registry contracts. The platform core is industry-agnostic. */

export enum Industry {
  Supermarket = 'supermarket',
  Restaurant = 'restaurant',
  Retail = 'retail',
  Pharmacy = 'pharmacy',
  Rental = 'rental',
  Hospitality = 'hospitality',
}

export enum ModuleId {
  Catalog = 'catalog',
  Inventory = 'inventory',
  Sales = 'sales',
  Customers = 'customers',
  Suppliers = 'suppliers',
  Purchasing = 'purchasing',
  Reporting = 'reporting',
  CashManagement = 'cash_management',
  OfflinePos = 'offline_pos',
  // industry modules
  SupermarketOps = 'supermarket_ops',
  RestaurantOps = 'restaurant_ops',
  RetailOps = 'retail_ops',
  PharmacyOps = 'pharmacy_ops',
}

export interface ModuleDescriptor {
  id: ModuleId;
  version: string;
  name: string;
  /** industries the module can be enabled for; empty = all */
  industries: Industry[];
  /** required modules */
  dependencies: ModuleId[];
  /** permissions introduced/used by the module */
  permissions: string[];
  description: string;
}

export interface TenantLimits {
  maxUsers: number;
  maxBranches: number;
  maxRegisters: number;
}

export interface PlanDefinition {
  planId: string;
  name: string;
  industry: Industry;
  modules: ModuleId[];
  limits: TenantLimits;
  priceMonthlyMinor: number;
  priceAnnualMinor: number;
  currency: string;
  trialDays: number;
}

export enum TenantStatus {
  Provisioning = 'provisioning',
  Active = 'active',
  Suspended = 'suspended',
  Deleted = 'deleted',
}

export enum SubscriptionStatus {
  Trial = 'trial',
  Active = 'active',
  PastDue = 'past_due',
  Canceled = 'canceled',
  Expired = 'expired',
}
