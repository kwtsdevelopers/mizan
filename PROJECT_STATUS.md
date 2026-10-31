# Project Status

This document is an honest statement of what is implemented, what is verified by tests,
and what is planned. "Implemented" means code exists and compiles; "verified" means it is
covered by the automated test suite that runs green locally/CI.

## Implemented and verified by automated tests

- Monorepo (npm workspaces): shared lib, backend, frontend, desktop.
- `@mizan/shared`: integer money math (round-half-up via bigint), sale/line total
  computation, roles → permissions mapping, module/plan types, offline-sync contracts.
  15 unit tests.
- Backend (NestJS 11 + Fastify):
  - Control plane: tenant registration (public), 7-step resumable provisioning pipeline,
    retry, suspend/reactivate, platform admin bootstrap from env.
  - Multi-tenancy: DB-per-tenant via `useDb` on one pooled connection, bounded tenant
    handle cache, tenant status gate on every request.
  - Auth: platform + tenant JWT logins, refresh rotation with replay detection,
    account lockout, RBAC permissions, module entitlement guard, throttling.
  - Catalog: products (standard + weighted), categories, barcode/SKU lookup, archive-only delete.
  - Inventory: idempotent stock movements, adjustments/waste, levels.
  - Sales: server-priced checkout, idempotent by `clientTxId`, payments/change validation,
    sequential sale numbers, stock deduction, offline sync endpoint with warnings
    (price drift, clock skew, negative stock), partial/full refunds with restock,
    cashier sessions with expected-cash computation.
  - Customers, suppliers, purchasing (PO create/receive with batch/expiry, last-cost update).
  - Reporting: sales summary (by day), top products, low stock.
  - Org: branches, users (create/disable, token revocation on disable), audit log.
  - Subscriptions/entitlements: default plans seeded, module registry with dependency and
    industry validation; unimplemented verticals are declared but rejected at plan validation.
  - E2E suite (in-memory MongoDB, Fastify inject): provisioning, tenant isolation,
    entitlements, RBAC, checkout/sync/refund flows, suspension, refresh rotation/replay.

## Implemented, not yet covered by automated tests

- Angular 19 frontend (login, POS with offline queue, catalog/inventory/purchasing/
  customers/suppliers/reports/org/platform admin screens). Manual verification only.
- Electron desktop shell.
- Dockerfiles, docker-compose, nginx config — written but **not built/run locally**
  (Docker is not installed on the development machine). Treat as a starting point and
  verify in a Docker-capable environment before relying on them.
- CI workflow (GitHub Actions) — will be exercised on first push.

## Deliberately deferred (planned)

- Restaurant, Retail, Pharmacy verticals: module IDs, industry compatibility, and plan
  validation are in place; the domain features are not implemented. The module registry
  rejects plans that reference unimplemented modules, so they cannot be sold accidentally.
- Payment-provider integration for subscription billing (plans/subscriptions are modeled;
  no card processing).
- Advanced security hardening: 2FA, IP allowlists, per-tenant encryption keys, SIEM export.
- Multi-register conflict resolution beyond idempotency (e.g. CRDT carts) — not needed for
  the current single-register-per-sale model.
- Horizontal scale-out concerns: tenant DB sharding across clusters, read replicas.
- Automated DB backup tooling (operational runbook documented in DEPLOYMENT.md instead).

## Known limitations / honest notes

- Transactions: the backend intentionally avoids multi-document transactions so it can run
  on standalone MongoDB; consistency relies on idempotency keys and atomic single-document
  updates. The compose file provisions a single-node replica set so transactions are
  available later if needed.
- Offline sync honors client-captured prices (with drift warnings persisted on the sale) —
  this is a documented business policy, not a bug; see OFFLINE_SYNC.md.
- `npm audit` reports transitive advisories primarily in dev tooling; review before release.
