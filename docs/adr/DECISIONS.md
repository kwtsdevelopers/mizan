# ADR-0001: Database per tenant

- Status: accepted
- Date: 2026-02

## Context

The platform serves many businesses (tenants). Options: (a) shared collections with a
`tenantId` field, (b) one MongoDB database per tenant on shared infrastructure,
(c) dedicated cluster per tenant.

## Decision

One MongoDB **database per tenant** (`mizan_t_<16-hex-id>`) plus a control-plane database
(`mizan_core`), all served through a single pooled connection using `useDb` with a
bounded tenant-handle cache.

## Consequences

- Strong isolation: queries physically cannot cross tenants; no "forgotten filter" bugs.
- Per-tenant backup/restore/export/delete is trivial (`mongodump --db ...`).
- `useDb` on one connection keeps socket count flat regardless of tenant count.
- Cost: many databases to manage; cross-tenant analytics require explicit aggregation in
  the control plane (acceptable — such analytics should be deliberate anyway).
- Index changes must be rolled out per tenant DB (provisioning step + maintenance script).

# ADR-0002: Integer money and milli-unit quantities

- Status: accepted

## Decision

All money is stored/computed as integers in **minor units** (cents, fils). Quantities are
integers in **milli-units** (1 pc = 1000; 1.250 kg = 1250). Tax rates are **basis
points**. Rounding is half-up implemented with bigint arithmetic in `@mizan/shared`.

## Consequences

No floating-point drift; totals are reproducible on client and server from the same
shared library; weighted items (per-kg pricing) need no special cases. UI must
format/parse at the edge only.

# ADR-0003: Idempotency keys instead of multi-document transactions

- Status: accepted

## Decision

The backend does not use MongoDB multi-document transactions. Correctness relies on:
unique idempotency keys on stock movements, unique `clientTxId` on sales, atomic
single-document updates (`$inc` counters and stock levels), and resumable provisioning
steps.

## Consequences

Runs on standalone MongoDB (dev/test use `mongodb-memory-server`); retries are always
safe; the stock ledger is the source of truth from which levels are derivable. Trade-off:
brief windows where a movement exists before the level `$inc` lands — acceptable because
the ledger wins and operations are idempotent.

# ADR-0004: Electron instead of PWA for offline POS

- Status: accepted (user requirement)

## Decision

The offline-capable POS ships as an **Electron** desktop app wrapping the Angular SPA.
No service-worker/PWA installation path.

## Consequences

Reliable local storage (IndexedDB inside a desktop profile), native-feeling kiosk
deployment, future access to receipt printers/cash drawers via Node integrations. Cost:
app distribution/update channel (electron-builder) instead of URL-only delivery. The web
SPA remains usable online in a browser for back-office work.

# ADR-0005: Supermarket first, registry-gated verticals

- Status: accepted (user requirement)

## Decision

Only the Supermarket vertical ships now. Restaurant/Retail/Pharmacy exist as module
registry entries flagged `implemented: false`; plan validation rejects them.

## Consequences

The platform's tenancy, auth, entitlements, and plan machinery already account for all
verticals; enabling one later is: implement features → flip flag → create plans.
