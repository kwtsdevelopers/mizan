# Subscription & Module Model

## Concepts

- **Module**: a sellable unit of functionality (`Catalog`, `Inventory`, `Sales`,
  `Customers`, `Suppliers`, `Purchasing`, `Reporting`, `CashManagement`, `OfflinePos`,
  `SupermarketOps`, and the planned `RestaurantOps`, `RetailOps`, `PharmacyOps`).
- **Module registry** (`module-registry.ts`): the single source of truth. Each descriptor
  declares dependencies (e.g. `Sales → Catalog, Inventory`), compatible industries, and an
  `implemented` flag. `validateModuleSet()` rejects unknown modules, unimplemented
  modules, industry mismatches, and missing dependencies — so future verticals are
  visible in the design but cannot be sold until they ship.
- **Plan**: a priced set of modules + limits (`maxUsers`, `maxBranches`, `maxRegisters`)
  + trial days. Seeded idempotently at boot:

| Plan | Modules | Limits | Price |
| --- | --- | --- | --- |
| `supermarket_basic` | Catalog, Inventory, Sales, Customers, Reporting, CashManagement, SupermarketOps | 5 users / 1 branch / 2 registers | $49/mo, 14-day trial |
| `supermarket_pro` | basic + Suppliers, Purchasing, OfflinePos | 25 / 5 / 10 | $149/mo, 14-day trial |

- **Subscription**: one per tenant. Statuses: `trialing → active → past_due → canceled`.
  `past_due` keeps the tenant working until `graceEndsAt`; after that, entitlements
  resolve to nothing (read-only lockout at the API level: module-guarded routes 403).

## Enforcement path

1. `EntitlementsService.enabledModules(tenantId)` resolves the subscription → plan →
   module set (30 s cache; invalidated on subscription changes).
2. The global `EntitlementsGuard` compares the route's `@RequireModules(...)` metadata
   against that set; any missing module → 403 with the module id in the message.

E2E-verified: a `supermarket_basic` tenant receives 403 on `/sales/sync` (OfflinePos) and
`/purchasing/orders` (Purchasing), while a `supermarket_pro` tenant succeeds.

## Billing

Plans/subscriptions are fully modeled, and platform admins can change a tenant's
subscription via `POST /platform/tenants/:id/subscription`. Payment-provider integration
(cards, invoices, dunning) is **not implemented** — see PROJECT_STATUS.md.

## Adding a vertical later

1. Implement the module's features behind `@RequireModules(NewModule)`.
2. Set `implemented: true` in the registry.
3. Create plans including the module. No tenancy/auth changes required.
