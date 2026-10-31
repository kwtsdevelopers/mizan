# Database Design

MongoDB, accessed through Mongoose. All monetary values are integers in minor units,
all quantities are integers in milli-units, all tax rates are basis points.

## Control plane — `mizan_core`

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| `tenants` | tenant registry: `tenantId` (16-hex), `slug`, `name`, `industry`, `status` (provisioning/active/suspended/archived) | unique `tenantId`, unique `slug` |
| `plans` | plan catalog: modules, limits (users/branches/registers), price, trial days | unique `planId` |
| `subscriptions` | one per tenant: plan, status (trialing/active/past_due/canceled), period end, `graceEndsAt` | unique `tenantId` |
| `platform_admins` | platform operator accounts | unique `email` |
| `provisioning_jobs` | resumable provisioning state: ordered `steps`, `completedSteps`, `status`, hashed admin credentials in `input` | unique `tenantId` |
| `platform_audit` | control-plane audit trail | `createdAt` |

### Provisioning steps (ordered, idempotent, resumable)

`create_database → apply_indexes → seed_defaults → create_admin_user → create_subscription → verify_isolation → activate`

Each step is recorded in `completedSteps` on success; a failed job can be retried and
resumes from the first incomplete step. Every step is written to be idempotent (upserts,
`$addToSet`, marker collections).

## Tenant databases — `mizan_t_<tenantId>`

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| `users` | tenant users, roles, `refreshTokenIds` (hashed, max 10), lockout fields | unique `email` |
| `branches` | branches/locations | unique `code` |
| `categories` | product categories | `name` |
| `products` | `kind` standard/weighted, `priceMinor`, `costMinor`, `taxRateBps`, `barcodes[]`, batch tracking flag, `reorderLevelMilli`, optimistic `version` | unique `sku`, `barcodes`, text `name` |
| `stock_levels` | current qty per product×branch (`qtyMilli`, may be negative) | unique `productId+branchId` |
| `stock_movements` | signed ledger: sale/refund/receipt/adjustment/transfer/waste; batch & expiry | unique sparse `idempotencyKey` |
| `customers` | customer master | `name`, `phone` |
| `suppliers` | supplier master | unique `name` |
| `purchase_orders` | PO with embedded lines + `receivedQtyMilli` | unique `poNumber` |
| `sales` | sale documents with embedded money-complete lines and payments; refunds are negative-amount sale docs linked by `refundOfSaleId`; `offline` flag + persisted `syncWarnings` | unique `clientTxId`, unique `saleNumber`, `occurredAt` |
| `counters` | sequential number generator (`findOneAndUpdate` + `$inc`) | unique `key` |
| `cashier_sessions` | opening float, close with expected vs counted cash variance | `branchId+status` |
| `audit_events` | tenant audit trail | `createdAt` |

## Consistency model

- No multi-document transactions (runs on standalone MongoDB). Instead:
  - every stock movement carries a unique `idempotencyKey`
    (`sale:<clientTxId>:<productId>`, `refund:<refundId>:<productId>`,
    `grn:<poId>:<productId>:<cumQty>`, `adj:<uuid>`): the movement insert is the
    commit point; the level `$inc` follows and is derivable from the ledger.
  - sale ingestion is idempotent by `clientTxId` — duplicates return the stored sale.
  - sequence numbers come from atomic counter updates.
- Stock may legitimately go negative (offline sales); reporting surfaces it, policy
  decides the correction via adjustments.

## Why database-per-tenant

Hard isolation (no tenant filter can be forgotten), per-tenant backup/restore/export,
simple deletion for offboarding, and index tuning per tenant size — at the cost of more
databases to manage. Names are always derived server-side from the validated
`tenantId` (`/^[a-z0-9]{8,32}$/`); client input never reaches a DB name.
