import { Industry, ModuleDescriptor, ModuleId, PlanDefinition } from '@mizan/shared';

/**
 * Static module registry. Industry modules declare dependencies on shared modules.
 * New industries register their descriptors here (or, later, via dynamic registration).
 */
export const MODULE_REGISTRY: Record<ModuleId, ModuleDescriptor> = {
  [ModuleId.Catalog]: {
    id: ModuleId.Catalog,
    version: '1.0.0',
    name: 'Catalog',
    industries: [],
    dependencies: [],
    permissions: ['catalog:read', 'catalog:write'],
    description: 'Products, categories, barcodes, units',
  },
  [ModuleId.Inventory]: {
    id: ModuleId.Inventory,
    version: '1.0.0',
    name: 'Inventory',
    industries: [],
    dependencies: [ModuleId.Catalog],
    permissions: ['inventory:read', 'inventory:write'],
    description: 'Stock balances, movements, adjustments',
  },
  [ModuleId.Sales]: {
    id: ModuleId.Sales,
    version: '1.0.0',
    name: 'Sales & POS',
    industries: [],
    dependencies: [ModuleId.Catalog],
    permissions: ['sales:checkout', 'sales:read', 'sales:refund', 'sales:void'],
    description: 'Checkout, receipts, returns and refunds',
  },
  [ModuleId.Customers]: {
    id: ModuleId.Customers,
    version: '1.0.0',
    name: 'Customers',
    industries: [],
    dependencies: [],
    permissions: ['customers:read', 'customers:write'],
    description: 'Customer profiles',
  },
  [ModuleId.Suppliers]: {
    id: ModuleId.Suppliers,
    version: '1.0.0',
    name: 'Suppliers',
    industries: [],
    dependencies: [],
    permissions: ['suppliers:read', 'suppliers:write'],
    description: 'Supplier profiles',
  },
  [ModuleId.Purchasing]: {
    id: ModuleId.Purchasing,
    version: '1.0.0',
    name: 'Purchasing',
    industries: [],
    dependencies: [ModuleId.Suppliers, ModuleId.Inventory],
    permissions: ['purchasing:read', 'purchasing:write'],
    description: 'Purchase orders and goods receipts',
  },
  [ModuleId.Reporting]: {
    id: ModuleId.Reporting,
    version: '1.0.0',
    name: 'Reporting',
    industries: [],
    dependencies: [ModuleId.Sales],
    permissions: ['reports:read'],
    description: 'Sales, inventory and cash reports',
  },
  [ModuleId.CashManagement]: {
    id: ModuleId.CashManagement,
    version: '1.0.0',
    name: 'Cash Management',
    industries: [],
    dependencies: [ModuleId.Sales],
    permissions: ['cash:session'],
    description: 'Cashier sessions, floats, variance',
  },
  [ModuleId.OfflinePos]: {
    id: ModuleId.OfflinePos,
    version: '1.0.0',
    name: 'Offline POS',
    industries: [],
    dependencies: [ModuleId.Sales],
    permissions: ['sales:sync'],
    description: 'Offline checkout and synchronization',
  },
  [ModuleId.SupermarketOps]: {
    id: ModuleId.SupermarketOps,
    version: '1.0.0',
    name: 'Supermarket Operations',
    industries: [Industry.Supermarket],
    dependencies: [ModuleId.Catalog, ModuleId.Inventory, ModuleId.Sales],
    permissions: [],
    description: 'Barcode checkout, weighted items, PLU, batch/expiry',
  },
  [ModuleId.RestaurantOps]: {
    id: ModuleId.RestaurantOps,
    version: '0.0.1',
    name: 'Restaurant Operations (planned)',
    industries: [Industry.Restaurant],
    dependencies: [ModuleId.Catalog, ModuleId.Sales],
    permissions: [],
    description: 'PLANNED - not implemented yet',
  },
  [ModuleId.RetailOps]: {
    id: ModuleId.RetailOps,
    version: '0.0.1',
    name: 'Retail Operations (planned)',
    industries: [Industry.Retail],
    dependencies: [ModuleId.Catalog, ModuleId.Inventory, ModuleId.Sales],
    permissions: [],
    description: 'PLANNED - not implemented yet',
  },
  [ModuleId.PharmacyOps]: {
    id: ModuleId.PharmacyOps,
    version: '0.0.1',
    name: 'Pharmacy Operations (planned)',
    industries: [Industry.Pharmacy],
    dependencies: [ModuleId.Catalog, ModuleId.Inventory, ModuleId.Sales],
    permissions: [],
    description: 'PLANNED - not implemented yet',
  },
};

/** Modules implemented and shippable today. */
export const IMPLEMENTED_MODULES: ReadonlySet<ModuleId> = new Set([
  ModuleId.Catalog,
  ModuleId.Inventory,
  ModuleId.Sales,
  ModuleId.Customers,
  ModuleId.Suppliers,
  ModuleId.Purchasing,
  ModuleId.Reporting,
  ModuleId.CashManagement,
  ModuleId.OfflinePos,
  ModuleId.SupermarketOps,
]);

/** Validate a module set: dependencies present, industry compatible, implemented. */
export function validateModuleSet(modules: ModuleId[], industry: Industry): string[] {
  const errors: string[] = [];
  const set = new Set(modules);
  for (const id of modules) {
    const desc = MODULE_REGISTRY[id];
    if (!desc) {
      errors.push(`Unknown module: ${id}`);
      continue;
    }
    if (!IMPLEMENTED_MODULES.has(id)) {
      errors.push(`Module not yet available: ${id}`);
    }
    if (desc.industries.length > 0 && !desc.industries.includes(industry)) {
      errors.push(`Module ${id} is not compatible with industry ${industry}`);
    }
    for (const dep of desc.dependencies) {
      if (!set.has(dep)) errors.push(`Module ${id} requires ${dep}`);
    }
  }
  return errors;
}

/** Default commercial plans seeded into the control plane. Prices are examples. */
export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    planId: 'supermarket_basic',
    name: 'Supermarket Basic',
    industry: Industry.Supermarket,
    modules: [
      ModuleId.Catalog,
      ModuleId.Inventory,
      ModuleId.Sales,
      ModuleId.Customers,
      ModuleId.Reporting,
      ModuleId.CashManagement,
      ModuleId.SupermarketOps,
    ],
    limits: { maxUsers: 5, maxBranches: 1, maxRegisters: 2 },
    priceMonthlyMinor: 4900,
    priceAnnualMinor: 49000,
    currency: 'USD',
    trialDays: 14,
  },
  {
    planId: 'supermarket_pro',
    name: 'Supermarket Pro',
    industry: Industry.Supermarket,
    modules: [
      ModuleId.Catalog,
      ModuleId.Inventory,
      ModuleId.Sales,
      ModuleId.Customers,
      ModuleId.Suppliers,
      ModuleId.Purchasing,
      ModuleId.Reporting,
      ModuleId.CashManagement,
      ModuleId.OfflinePos,
      ModuleId.SupermarketOps,
    ],
    limits: { maxUsers: 25, maxBranches: 5, maxRegisters: 10 },
    priceMonthlyMinor: 14900,
    priceAnnualMinor: 149000,
    currency: 'USD',
    trialDays: 14,
  },
];
