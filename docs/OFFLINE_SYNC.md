# Offline Sync

The POS keeps working when the network does not. This document defines the contract.

## Client behaviour (frontend/Electron)

1. Every sale gets a UUID `clientTxId` **at creation time** — online or offline.
2. Online: `POST /api/v1/sales/checkout`. The server prices everything; the client sends
   only `productId`, `qtyMilli`, `discountMinor`, payments.
3. Offline (request fails / no network): the finished sale — **including the prices the
   customer actually paid** — is stored in IndexedDB (Dexie) in a `pendingSales` queue.
4. When connectivity returns, the client posts batches (≤100) to `POST /api/v1/sales/sync`
   as `OfflineSaleSubmission[]` and removes items whose result is `applied` or `duplicate`;
   `rejected` items are kept and surfaced to the user with the error code.

## Server behaviour (`sales/sync`)

Per item, independently (one bad sale never blocks the batch):

- **Idempotency**: an existing `clientTxId` short-circuits to `duplicate` (safe retries).
- **Validation**: timestamps must parse; payments must cover the total (else
  `rejected: UNDERPAID`); quantities must be positive safe integers.
- **Price policy**: client-captured prices are **honored** — the customer already paid
  them at the till. The server compares against current catalog prices and persists
  `PRICE_DRIFT` warnings on the sale instead of rewriting history.
- **Clock skew**: an `occurredAt` more than 5 minutes in the future is accepted with a
  `CLOCK_AHEAD` warning.
- **Missing products**: the line is kept (audit truth) with a `UNKNOWN_PRODUCT` warning;
  no stock movement for that line.
- **Stock**: deducted idempotently (`sale:<clientTxId>:<productId>`); stock **may go
  negative** — a `NEGATIVE_STOCK` warning is persisted and surfaced in reports.

Response: `SyncResponse` with per-item `applied | duplicate | rejected` and warnings.

## Entitlement

Offline sync requires the `OfflinePos` module; basic-plan tenants get 403 on `/sales/sync`.

## Conflict model

There is no multi-master editing of a sale: a sale is immutable once created, identified
globally by `clientTxId`. Idempotent ingestion + warnings is therefore sufficient; no
merge/CRDT machinery is needed. Refunds reference the server-side sale and are
online-only operations.

## Tested

The e2e suite covers: offline sale with price drift and negative stock (warnings
returned), duplicate resubmission (`duplicate`), underpaid rejection, and the entitlement
block for basic plans.
