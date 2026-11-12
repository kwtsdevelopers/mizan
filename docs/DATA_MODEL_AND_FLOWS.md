# Mizan — Full Data Model & Flow Documentation (Study Guide)

This is the deep technical reference for the whole platform: every collection, every field, how collections connect (ER diagrams), and exactly which documents change when each business action happens.

> MongoDB has no foreign keys. All relationships below are **soft references** (a string field holding another document's `_id` or a business key like `tenantId`/`planId`). Integrity is enforced in the service layer, not by the database.

---

## 1. Big Picture

```mermaid
flowchart LR
    subgraph Client["Clients"]
        EL["Electron shell<br/>(desktop POS)"]
        NG["Angular 19 SPA<br/>(signals + Dexie offline queue)"]
        EL --> NG
    end

    subgraph API["NestJS + Fastify  :3000/api/v1"]
        TH[ThrottlerGuard] --> JG[JwtAuthGuard] --> PG[PermissionsGuard] --> EG[EntitlementsGuard] --> CTRL[Controllers]
        CTRL --> SVC["Services<br/>(Sales, Inventory, Tenants, Entitlements...)"]
    end

    subgraph Mongo["MongoDB"]
        CORE[("mizan_core<br/>control plane")]
        T1[("mizan_t_&lt;tenantA&gt;")]
        T2[("mizan_t_&lt;tenantB&gt;")]
        TN[("mizan_t_&lt;tenantN&gt;...")]
    end

    NG -- "HTTPS + JWT" --> TH
    SVC --> CORE
    SVC --> T1
    SVC --> T2
    SVC --> TN

    subgraph Offline["Offline (browser IndexedDB via Dexie)"]
        Q[(pending_sales queue)]
    end
    NG <--> Q
```

**Isolation model: database-per-tenant.** The control plane (`mizan_core`) knows *who* tenants are and *what* they are entitled to. Each tenant's business data lives in its own physical database `mizan_t_<tenantId>` (16-hex-char id). A request's JWT carries `tenantId`; `TenantAccessService.modelsFor(tenantId)` resolves the connection to that one database — code can never accidentally query another tenant's data.

---

## 2. Control Plane — `mizan_core` ER Diagram

```mermaid
erDiagram
    TENANTS ||--|| SUBSCRIPTIONS : "tenantId"
    TENANTS ||--|| PROVISIONING_JOBS : "tenantId"
    TENANTS ||--o{ PLATFORM_AUDIT : "tenantId"
    PLANS ||--o{ SUBSCRIPTIONS : "planId"
    PLANS ||--o{ PROVISIONING_JOBS : "input.planId"
    PLATFORM_ADMINS ||--o{ PLATFORM_AUDIT : "actorId"

    TENANTS {
        string tenantId UK "16-hex, immutable, business key"
        string name
        string slug UK "login namespace, lowercase"
        string industry "enum: supermarket (more later)"
        string status "provisioning | active | suspended | ..."
        string dbName "server-controlled: mizan_t_<tenantId>"
        string clusterKey "multi-cluster placement, default 'default'"
        string currency "ISO 4217, 3 chars"
        string timezone
        date createdAt
        date activatedAt
        date suspendedAt
    }

    PLANS {
        string planId UK "e.g. supermarket_pro"
        string name
        string industry
        stringArray modules "ModuleId[] granted by this plan"
        object limits "maxUsers / maxBranches / maxRegisters"
        int priceMonthlyMinor
        int priceAnnualMinor
        string currency
        int trialDays "default 14"
        bool active
    }

    SUBSCRIPTIONS {
        string tenantId UK "1:1 with tenant"
        string planId FK "-> plans.planId"
        string status "trial | active | past_due | canceled | expired"
        string billingPeriod "monthly | annual"
        date startsAt
        date currentPeriodEndsAt
        date canceledAt
        date graceEndsAt "read-only grace after past_due"
    }

    PLATFORM_ADMINS {
        objectId _id PK
        string email UK
        string passwordHash "bcrypt"
        string name
        string status "active | disabled"
    }

    PROVISIONING_JOBS {
        string tenantId UK
        string status "pending | running | completed | failed"
        stringArray completedSteps "idempotent resume point"
        int attempts
        string lastError
        object input "planId, adminEmail, adminName, adminPasswordHash (bcrypt only)"
    }

    PLATFORM_AUDIT {
        date at
        string actorId
        string actorScope "platform | tenant"
        string action "tenant.provisioned, tenant.suspended, ..."
        string tenantId
        mixed details
    }
```

### Key invariants (core)
- `tenants.dbName` is **always server-generated** from `tenantId` — never from user input (prevents injection into DB naming).
- `subscriptions` is strictly 1:1 with tenants (unique index on `tenantId`).
- `provisioning_jobs.completedSteps` makes provisioning **resumable**: a retry skips finished steps.
- Plaintext passwords are never persisted anywhere — `provisioning_jobs.input.adminPasswordHash` is already bcrypt.

---

## 3. Tenant Database — `mizan_t_<tenantId>` ER Diagram

```mermaid
erDiagram
    USERS ||--o{ SALES : "cashierId"
    USERS ||--o{ STOCK_MOVEMENTS : "createdBy"
    USERS ||--o{ PURCHASE_ORDERS : "createdBy"
    USERS ||--o{ AUDIT_EVENTS : "actorId"
    USERS ||--o{ CASHIER_SESSIONS : "cashierId"
    BRANCHES ||--o{ SALES : "branchId"
    BRANCHES ||--o{ STOCK_LEVELS : "branchId"
    BRANCHES ||--o{ STOCK_MOVEMENTS : "branchId"
    BRANCHES ||--o{ PURCHASE_ORDERS : "branchId"
    BRANCHES ||--o{ CASHIER_SESSIONS : "branchId"
    CATEGORIES ||--o{ PRODUCTS : "categoryId"
    CATEGORIES ||--o{ CATEGORIES : "parentId (tree)"
    PRODUCTS ||--o{ STOCK_LEVELS : "productId"
    PRODUCTS ||--o{ STOCK_MOVEMENTS : "productId"
    PRODUCTS ||--o{ SALE_LINES : "productId (embedded in sales)"
    PRODUCTS ||--o{ PO_LINES : "productId (embedded in POs)"
    CUSTOMERS ||--o{ SALES : "customerId (optional)"
    SUPPLIERS ||--o{ PURCHASE_ORDERS : "supplierId"
    SALES ||--o{ SALES : "refundOfSaleId (refund doc -> original)"
    SALES ||--o{ STOCK_MOVEMENTS : "refId (type=sale|refund)"
    PURCHASE_ORDERS ||--o{ STOCK_MOVEMENTS : "refId (type=receipt)"
    COUNTERS ||..o{ SALES : "generates saleNumber"
    COUNTERS ||..o{ PURCHASE_ORDERS : "generates poNumber"

    USERS {
        objectId _id PK
        string email UK
        string passwordHash "bcrypt"
        string name
        stringArray roles "owner | manager | cashier | stock_keeper | accountant"
        stringArray branchIds "branch scoping (empty = all)"
        string status "active | disabled"
        stringArray refreshTokenIds "hashed rotation ids, bounded"
        int failedLoginAttempts
        date lockedUntil "brute-force lockout"
    }

    BRANCHES {
        objectId _id PK
        string name
        string code UK
        string address
        bool active
    }

    CATEGORIES {
        objectId _id PK
        string name "unique with parentId"
        string parentId "null = root"
        int sortOrder
        bool active
    }

    PRODUCTS {
        objectId _id PK
        string sku UK
        stringArray barcodes "EAN/UPC/PLU, indexed"
        string name "text-indexed for search"
        string categoryId
        string kind "standard | weighted"
        string unit "pc, kg, ..."
        int priceMinor "sell price, integer minor units"
        int costMinor
        int taxRateBps "0..10000 basis points"
        bool trackInventory
        bool batchTracking
        int reorderLevelMilli "low-stock threshold"
        string status "active | archived (never hard-deleted)"
        int version "bumped on price-relevant updates"
    }

    STOCK_LEVELS {
        string productId "UK with branchId"
        string branchId
        int qtyMilli "materialized balance; MAY go negative (offline)"
        date updatedAt
    }

    STOCK_MOVEMENTS {
        objectId _id PK
        string productId
        string branchId
        int qtyMilli "SIGNED delta"
        string type "sale | refund | receipt | adjustment | transfer_in | transfer_out | waste"
        string refType "sale | refund | purchase_order | ..."
        string refId "source document id"
        string idempotencyKey "UK sparse - replay protection"
        string batchNumber "from goods receipt"
        date expiryDate
        string note
        string createdBy
        date at
    }

    CUSTOMERS {
        objectId _id PK
        string name "text-indexed"
        string phone "sparse index"
        string email
        string address
        string status "active | archived"
        string notes
    }

    SUPPLIERS {
        objectId _id PK
        string name UK
        string contactName
        string phone
        string email
        string address
        string status "active | archived"
    }

    PURCHASE_ORDERS {
        objectId _id PK
        string poNumber UK "PO-000001"
        string supplierId
        string branchId "delivery branch"
        string status "draft | ordered | partially_received | received | canceled"
        array lines "embedded poLine[]"
        int totalMinor
        string note
        string createdBy
    }

    PO_LINES {
        string productId
        string sku "snapshot"
        string description "snapshot of product name"
        int qtyMilli "ordered"
        int unitCostMinor
        int receivedQtyMilli "accumulates per receipt"
    }

    SALES {
        objectId _id PK
        string saleNumber UK "S-00000001 / RF-00000001"
        string clientTxId UK "IDEMPOTENCY KEY (offline + retry safety)"
        string branchId
        string registerId "default 'default'"
        string cashierId
        string customerId "nullable"
        array lines "embedded saleLine[]"
        array payments "embedded payment[]"
        int subtotalMinor
        int discountMinor
        int taxMinor
        int totalMinor "NEGATIVE on refund documents"
        int paidMinor
        int changeMinor
        string status "completed | voided | refunded | partially_refunded"
        string refundOfSaleId "set => this doc IS a refund"
        bool offline "captured offline, synced later"
        date occurredAt "device wall-clock"
        stringArray syncWarnings "price drift, negative stock, clock skew"
        string note
    }

    SALE_LINES {
        string productId
        string sku "snapshot at time of sale"
        string description "snapshot"
        int qtyMilli "milli-units: 1 pc = 1000; 1.5 kg = 1500"
        int unitPriceMinor "snapshot"
        int discountMinor
        int taxRateBps "snapshot"
        int grossMinor "qty x price (rounded half-up)"
        int netMinor "gross - discount"
        int taxMinor "net x rate"
        int totalMinor "net + tax"
    }

    CASHIER_SESSIONS {
        objectId _id PK
        string cashierId
        string branchId
        string registerId
        date openedAt
        date closedAt
        int openingFloatMinor
        int countedCashMinor "entered at close"
        int expectedCashMinor "float + cash sales - cash refunds"
        int varianceMinor "counted - expected"
        string status "open | closed"
    }

    COUNTERS {
        string key UK "sale:<branchId> | refund:<branchId> | po"
        int seq "atomic $inc"
    }

    AUDIT_EVENTS {
        date at
        string actorId
        string action "product.created, sale.refunded, user.updated, ..."
        string entityType
        string entityId
        mixed details
    }
```

### Design principles baked into this schema

| Principle | Where you see it |
|---|---|
| **Money = integers** | Every `*Minor` field is integer minor units (cents/fils). No floats anywhere. Rounding is half-up via bigint math (libs/shared/src/money.ts). |
| **Quantity = milli-units** | Every `*Milli` field: 1 piece = 1000, 1.5 kg = 1500. Lets weighted items share one integer representation. |
| **Snapshot, don't join** | Sale lines and PO lines embed `sku`, `description`, `unitPriceMinor`, `taxRateBps` *as they were at transaction time*. Later price/name changes never rewrite history. |
| **Ledger + materialized balance** | `stock_movements` is the append-only truth; `stock_levels` is just the running balance (`$inc`), unique per (product, branch). You can always rebuild levels from movements. |
| **Idempotency everywhere** | `sales.clientTxId` (unique), `stock_movements.idempotencyKey` (unique sparse), provisioning `completedSteps`. Safe to retry anything. |
| **Soft delete only** | Products/customers/suppliers get `status: 'archived'`; users get `status: 'disabled'`; tenants get `suspended`. Nothing referenced by history is ever hard-deleted. |
| **Refund = new document** | A refund is a new `sales` doc with negative totals and `refundOfSaleId` set. The original is never mutated except its `status`. |

---

## 4. Action → Effect Matrix (what changes when)

This is the heart of understanding the system: every business action and the exact writes it causes.

### 4.1 Tenant registration — `POST /tenants/register`

```mermaid
flowchart TD
    A[Validate slug/plan/industry<br/>module set valid for industry] --> B["core.tenants.create<br/>status=provisioning, dbName=mizan_t_&lt;id&gt;"]
    B --> C["core.provisioning_jobs upsert<br/>status=pending, input={planId, admin creds (bcrypt)}"]
    C --> D{Run steps in order,<br/>skip completedSteps}
    D --> S1[1 create_database<br/>opens tenant DB connection]
    S1 --> S2[2 apply_indexes<br/>syncIndexes on all tenant collections]
    S2 --> S3[3 seed_defaults<br/>tenant.branches: 'Main Branch' MAIN]
    S3 --> S4[4 create_admin_user<br/>tenant.users: owner role]
    S4 --> S5["5 create_subscription<br/>core.subscriptions: trial (trialDays) or paid period"]
    S5 --> S6[6 verify_isolation<br/>sanity: tenant DB ≠ core DB]
    S6 --> S7[7 activate<br/>core.tenants.status=active, activatedAt=now]
    S7 --> OK["core.provisioning_jobs.status=completed<br/>core.platform_audit: tenant.provisioned"]
    D -- "any step throws" --> FAIL["job.status=failed, lastError saved<br/>tenant stays 'provisioning'<br/>platform admin can POST /retry-provisioning<br/>→ resumes from first incomplete step"]
```

| Collection | Effect |
|---|---|
| `core.tenants` | created (`provisioning`) → `active` + `activatedAt` on success |
| `core.provisioning_jobs` | created; `completedSteps` grows step-by-step; `attempts` +1 per run |
| `core.subscriptions` | created 1:1 (status `trial` if plan has trialDays, else `active`) |
| `tenant.branches` | 1 seeded branch (`Main Branch`/`MAIN`) |
| `tenant.users` | 1 owner user (bcrypt hash) |
| `core.platform_audit` | `tenant.provisioned` or `tenant.provisioning_failed` |

### 4.2 Login — `POST /auth/login` (tenant) / `POST /auth/platform/login`

| Condition | Effect |
|---|---|
| Tenant not `active` | 403 — suspension blocks login itself |
| Wrong password | `users.failedLoginAttempts` +1; lockout sets `lockedUntil` |
| Success | counters reset; a hashed refresh-token id is pushed to `users.refreshTokenIds` (bounded list → oldest rotations drop off); returns access JWT (~15 min) + refresh token |
| `POST /auth/refresh` | validates + **rotates**: old id removed, new id appended (stolen-token replay fails) |
| `POST /auth/logout` | removes the refresh id |

JWT payload carries: `userId`, `tenantId`, `scope` (`tenant`/`platform`), `roles`. Every subsequent request flows through the guard chain: Throttler → JwtAuth → Permissions (role → permission map) → Entitlements (module enabled for this tenant's plan?).

### 4.3 Online checkout — `POST /sales/checkout`

```mermaid
flowchart TD
    A[Client sends ONLY productIds + qty + discounts + payments<br/>clientTxId generated on device] --> B{sales.findOne clientTxId?}
    B -- exists --> DUP["return existing sale, duplicate=true<br/>(NO new writes - idempotent)"]
    B -- no --> C["Load products (status=active only)<br/>price/tax ALWAYS from server catalog"]
    C --> D["computeLineTotals per line:<br/>gross = qty x price / 1000 (half-up)<br/>net = gross - discount<br/>tax = net x bps / 10000 (half-up)"]
    D --> E{Validations}
    E -- "paid < total" --> R1[400 Insufficient payment]
    E -- "change > cash tendered" --> R2[400 Change exceeds cash]
    E -- ok --> F["counters: $inc sale:&lt;branchId&gt; → S-00000001"]
    F --> G["sales.create (status=completed, offline=false)<br/>unique clientTxId catches races → return duplicate"]
    G --> H["For each line with trackInventory:<br/>stock_movements.create (qty = -qtyMilli, type=sale,<br/>idempotencyKey = sale:&lt;clientTxId&gt;:&lt;productId&gt;)<br/>stock_levels $inc -qtyMilli (upsert)"]
    H --> I[Return saleId, saleNumber, totalMinor, changeMinor]
```

| Collection | Effect |
|---|---|
| `sales` | +1 doc, `status=completed`, lines snapshot server prices |
| `counters` | `sale:<branchId>` seq +1 |
| `stock_movements` | +1 per tracked line, negative delta, idempotency-keyed |
| `stock_levels` | `qtyMilli` decreases per (product, branch); `updatedAt` bumped |

### 4.4 Offline sale → sync — `POST /sales/sync`

The POS enqueues sales in Dexie (IndexedDB) when offline. On reconnect it submits the queue.

```mermaid
flowchart TD
    subgraph Device["Device (offline)"]
        P[Cashier completes sale] --> Q["Dexie pending_sales:<br/>full snapshot incl. unitPriceMinor, sku,<br/>description, taxRateBps, occurredAt, clientTxId"]
    end
    Q -- reconnect --> S["POST /sales/sync {sales: [...]}"]
    S --> L{Per item}
    L -- "clientTxId exists" --> D2[status=duplicate → device deletes from queue]
    L -- "bad timestamp / underpaid / empty" --> RJ[status=rejected + errorCode<br/>kept server-side NOWHERE - device must correct]
    L -- ok --> AP["sales.create offline=true<br/>CLIENT prices honored (price shown = price charged)"]
    AP --> W["Warnings appended to sale.syncWarnings:<br/>- price drift vs current catalog<br/>- product no longer exists<br/>- device clock ahead > 5 min<br/>- stock went negative"]
    W --> MV["stock_movements + stock_levels<br/>(same idempotency scheme; balance MAY go negative)"]
    MV --> OK[status=applied + warnings → device deletes from queue]
```

Key policy differences vs online checkout:

| Aspect | Online | Offline sync |
|---|---|---|
| Price source | Server catalog (authoritative) | **Client snapshot honored**; drift logged as warning |
| Stock | Decrements, warns if negative | Decrements, **allowed negative**, warning recorded |
| `occurredAt` | Server time | Device time (skew ≥ 5 min → warning) |
| Archived/missing product | 400 rejection | Accepted with warning (sale already happened in real life) |

### 4.5 Refund — `POST /sales/:id/refund`

```mermaid
flowchart TD
    A[Load original sale] --> B{Guards}
    B -- "voided / fully refunded / is itself a refund" --> X[409 Conflict]
    B -- ok --> C["Sum prior refunds per product<br/>(all docs with refundOfSaleId = saleId)"]
    C --> D{"requested qty + already refunded<br/>≤ originally sold qty?"}
    D -- no --> X2[400 exceeds sold quantity]
    D -- yes --> E["Recompute amounts at ORIGINAL prices<br/>discount prorated: orig.discount x qty / orig.qty"]
    E --> F["counters: refund:&lt;branchId&gt; → RF-00000001"]
    F --> G["sales.create REFUND DOC:<br/>totals all NEGATIVE, refundOfSaleId=saleId,<br/>payments=[cash -total], note=reason"]
    G --> H["Per tracked line: stock_movements +qtyMilli type=refund<br/>idempotencyKey=refund:&lt;refundId&gt;:&lt;productId&gt;<br/>stock_levels $inc +qtyMilli (restock)"]
    H --> I{"total refunded qty ≥ total sold qty?"}
    I -- yes --> J[original sale.status = refunded]
    I -- no --> K[original sale.status = partially_refunded]
```

| Collection | Effect |
|---|---|
| `sales` | +1 refund doc (negative money); original doc: **only `status` mutates** |
| `counters` | `refund:<branchId>` +1 |
| `stock_movements` / `stock_levels` | positive delta per line (restock) |

### 4.6 Purchasing lifecycle

```mermaid
stateDiagram-v2
    [*] --> ordered : POST /purchasing/orders
    ordered --> partially_received : receive (some lines/qty)
    ordered --> received : receive (all qty)
    partially_received --> partially_received : receive more
    partially_received --> received : last qty received
    ordered --> canceled : cancel
    received --> [*]
```

**Create PO** (`POST /purchasing/orders`): validates supplier is `active`, snapshots product `sku`/`name` into lines, `totalMinor = Σ qty×cost`, `counters.po` +1 → `PO-000001`, status starts at `ordered`, audit event `purchase_order.created`.

**Goods receipt** (`POST /purchasing/orders/:id/receive`):

| Check / Effect | Detail |
|---|---|
| Guard | 409 if PO `canceled`/`received`; 400 if line not on PO or over-receiving (`receivedQtyMilli + qty > ordered qty`) |
| `purchase_orders.lines[].receivedQtyMilli` | += received qty per line |
| `purchase_orders.status` | all lines full → `received`, else `partially_received` |
| `stock_movements` | +1 per line: positive delta, `type=receipt`, `refId=poId`, carries `batchNumber`/`expiryDate` (this is where batch/expiry live — per receipt line, not on the product) |
| `stock_levels` | `qtyMilli` += per (product, **PO's branchId**) |
| `audit_events` | `purchase_order.received` |

### 4.7 Stock adjustment / waste — `POST /inventory/adjustments`

One call → one signed movement (`type = adjustment | waste`, note optional) → `stock_levels` `$inc`. Used for stock counts, damage, shrinkage. Response returns the new balance.

### 4.8 Catalog / customers / suppliers / org mutations

| Action | Writes |
|---|---|
| Create/update product | `products` (+`version` bump); `audit_events` |
| "Delete" product | `products.status='archived'` only — historical sales keep their snapshots |
| Create branch | `branches` — **blocked by plan limit** `maxBranches` (EntitlementsGuard/plan limits) |
| Create user | `users` — blocked by `maxUsers`; roles map to permissions |
| Disable user | `users.status='disabled'` → login rejected, refresh rotation dies |
| Suspend tenant (platform) | `core.tenants.status='suspended'` + `suspendedAt`; **every** API call and login for that tenant is rejected at guard level; data untouched |
| Subscription expires | `entitlements` resolves to **empty module set** (30 s cache) → module-gated endpoints 403; data never deleted; `past_due` + `graceEndsAt` in future keeps modules alive (grace window) |

---

## 5. Request Pipeline (every API call)

```mermaid
flowchart LR
    REQ[Request] --> T[ThrottlerGuard<br/>rate limit]
    T --> J["JwtAuthGuard<br/>verify token, attach AuthUser<br/>(public routes skip via @Public)"]
    J --> TS["Tenant status check<br/>suspended → 403"]
    TS --> P["PermissionsGuard<br/>roles → Permission map<br/>e.g. cashier can sales:write<br/>but not catalog:write"]
    P --> E["EntitlementsGuard<br/>@RequireModules(...)<br/>plan modules ⊇ required?<br/>30s cached from core.subscriptions+plans"]
    E --> V["ValidationPipe (global)<br/>whitelist + forbidNonWhitelisted + transform<br/>unknown body/query fields → 400"]
    V --> C[Controller → Service → Tenant DB]
```

Role → permission examples (libs/shared/src/security.ts): `owner` = everything; `manager` = catalog/inventory/purchasing/sales/reports; `cashier` = sales write + catalog read; `stock_keeper` = inventory + purchasing; `accountant` = reports + read access.

---

## 6. Numbering, Idempotency & Money — the fine print

**Counters** (per tenant DB): atomic `findOneAndUpdate {$inc: {seq: 1}}` on keyed docs — `sale:<branchId>` → `S-00000001…`, `refund:<branchId>` → `RF-…`, `po` → `PO-000001`. Gap-free within a branch, race-safe.

**Idempotency keys:**

| Key | Protects |
|---|---|
| `sales.clientTxId` (unique) | double-submits of checkout & offline sync replays — second attempt returns the original sale as `duplicate` |
| `stock_movements.idempotencyKey` = `sale:<clientTxId>:<productId>` / `refund:<refundId>:<productId>` / `receipt:<poId>:…` | stock being decremented/incremented twice if a request is retried after a partial failure |
| `provisioning_jobs.completedSteps` | re-running provisioning repeating finished steps |

**Money math** (libs/shared/src/money.ts): all derived amounts computed with `bigint` then rounded **half-up** once per derived value:
- `grossMinor = round(qtyMilli × unitPriceMinor / 1000)`
- `netMinor = grossMinor − discountMinor`
- `taxMinor = round(netMinor × taxRateBps / 10000)`
- `totalMinor = netMinor + taxMinor`; sale totals are plain sums of line values (so lines always add up to the total — no reconciliation drift).

---

## 7. End-to-End Master Flow

```mermaid
flowchart TD
    subgraph Platform["Platform plane (mizan_core)"]
        REG["Tenant registers<br/>(plan, industry, admin)"] --> PROV["Provisioning saga<br/>(7 idempotent steps)"]
        PROV --> ACT[Tenant active + subscription trial/active]
        PA[Platform admin] -->|suspend / reactivate / retry| ACT
        SUB[(subscriptions + plans)] -->|module entitlements, 30s cache| GATE
    end

    subgraph Tenant["Tenant plane (mizan_t_*)"]
        LOGIN[Staff login<br/>slug + email + password] --> JWT[Access 15min + rotating refresh]
        JWT --> GATE{Guard chain<br/>throttle→jwt→perms→modules}
        GATE --> CAT[Catalog: products, categories]
        GATE --> PUR["Purchasing: PO → goods receipt<br/>(+stock, batch/expiry)"]
        GATE --> INV["Inventory: adjustments, waste<br/>levels = materialized ledger"]
        GATE --> POS[POS checkout<br/>server-priced, idempotent]
        GATE --> REF[Refunds<br/>negative sale doc + restock]
        GATE --> REP["Reports: sales summary,<br/>top products, low stock<br/>(aggregation pipelines)"]
        GATE --> ORG[Org: users, branches, audit]
    end

    subgraph Offline["Offline capability"]
        POSUI[POS UI] -->|no network| DEX[(Dexie queue<br/>price snapshots)]
        DEX -->|reconnect| SYNC["POST /sales/sync<br/>applied / duplicate / rejected<br/>warnings: drift, negative stock"]
        SYNC --> POS
    end

    CAT --> POS
    PUR --> INV
    POS --> INV
    REF --> INV
    INV --> REP
    POS --> REP
```

### Data-flow summary of one supermarket day

1. **Morning** — stock keeper receives yesterday's PO: `purchase_orders.lines[].receivedQtyMilli` fill up, `stock_movements(+receipt)` append, `stock_levels` rise, PO flips to `received`.
2. **Daytime** — cashiers check out customers: each sale appends a `sales` doc (price snapshots), a counter tick, and negative `sale` movements; levels fall in real time.
3. **Network drops** — POS keeps selling from Dexie-cached catalog; sales pile up in IndexedDB with device timestamps.
4. **Reconnect** — queue syncs; duplicates are absorbed by `clientTxId`; price drift and negative stock become `syncWarnings` for the manager, never blockers.
5. **A return** — refund doc with negative totals references the original via `refundOfSaleId`; items restock; original flips to `partially_refunded`.
6. **Evening** — reports aggregate `sales` (excluding `voided`, separating `refundOfSaleId` docs) by day/product; `low-stock` joins `products.reorderLevelMilli` against summed `stock_levels`.
7. **Anytime** — every mutation also appended a row in `audit_events` (tenant) or `platform_audit` (core); nothing was ever hard-deleted.

---

## 8. Visual Walkthroughs — step-by-step sequence & state diagrams

These diagrams show the *same* flows as section 4, but as time-ordered conversations between the actual moving parts: UI → guards → services → collections.

### 8.1 Login & token lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor U as Cashier
    participant FE as Angular (login)
    participant API as POST /auth/login
    participant CORE as mizan_core.tenants
    participant TDB as tenant.users

    U->>FE: slug + email + password
    FE->>API: credentials
    API->>CORE: find tenant by slug
    alt tenant suspended / provisioning
        API-->>FE: 403 (no login while not active)
    end
    API->>TDB: find user by email
    alt wrong password
        API->>TDB: failedLoginAttempts +1 (lockedUntil after N)
        API-->>FE: 401
    else success
        API->>TDB: reset counters, push hashed refreshTokenId
        API-->>FE: accessToken (~15 min) + refreshToken
    end
    FE->>FE: store tokens, decode roles for menu

    Note over FE,API: ...15 minutes later, any API call returns 401...
    FE->>API: POST /auth/refresh (refreshToken)
    API->>TDB: validate + ROTATE (old id removed, new id pushed)
    API-->>FE: new access + refresh pair
    FE->>FE: retry original request transparently (authInterceptor)
```

### 8.2 Online checkout — every write, in order

```mermaid
sequenceDiagram
    autonumber
    actor C as Cashier
    participant POS as POS UI
    participant G as Guard chain
    participant S as SalesService
    participant P as products
    participant CT as counters
    participant SA as sales
    participant SM as stock_movements
    participant SL as stock_levels

    C->>POS: scan items, take payment
    POS->>POS: generate clientTxId (device-unique)
    POS->>G: POST /sales/checkout {clientTxId, lines[productId,qty,discount], payments}
    G->>G: throttle → JWT → sales:write perm → POS module enabled
    G->>S: checkout()
    S->>SA: findOne(clientTxId)?
    alt already exists (retry/double-click)
        S-->>POS: same sale, duplicate=true (zero new writes)
    end
    S->>P: load products (status=active) — SERVER prices & tax
    S->>S: computeLineTotals (bigint, round half-up)
    alt paid < total OR change > cash tendered
        S-->>POS: 400 (nothing written)
    end
    S->>CT: $inc sale:<branchId> → "S-00000042"
    S->>SA: create sale (completed, offline=false, snapshots)
    loop each line with trackInventory
        S->>SM: create movement −qty, key sale:<clientTxId>:<productId>
        S->>SL: $inc qtyMilli −qty (upsert)
    end
    S-->>POS: {saleNumber, totalMinor, changeMinor}
    POS-->>C: show change due, print/display receipt
```

### 8.3 Offline sale — capture now, sync later

```mermaid
sequenceDiagram
    autonumber
    actor C as Cashier
    participant POS as POS UI
    participant DX as Dexie (IndexedDB)
    participant NET as Network
    participant API as POST /sales/sync
    participant SA as sales
    participant SL as stock_levels

    Note over POS,NET: network is DOWN — POS keeps working
    C->>POS: checkout
    POS->>DX: enqueue full snapshot<br/>(prices, sku, description, taxRateBps,<br/>occurredAt=device clock, clientTxId)
    POS-->>C: receipt from local data

    Note over POS,NET: network restored
    POS->>NET: online event → syncNow()
    POS->>API: {sales: [queued submissions]}
    loop each queued sale
        API->>SA: clientTxId exists?
        alt duplicate
            API-->>POS: status=duplicate → delete from Dexie
        else valid
            API->>SA: create (offline=true, CLIENT prices honored)
            API->>SL: deduct stock (negative allowed!)
            API-->>POS: status=applied (+warnings:<br/>price drift / missing product / clock skew / negative stock)
            POS->>DX: delete from queue
        else invalid (underpaid, bad timestamp)
            API-->>POS: status=rejected + errorCode (stays on device for correction)
        end
    end
```

### 8.4 Refund — negative mirror document

```mermaid
sequenceDiagram
    autonumber
    actor M as Manager
    participant UI as Sales screen
    participant S as SalesService
    participant SA as sales
    participant SM as stock_movements
    participant SL as stock_levels

    M->>UI: pick sale S-00000042, select lines/qty, reason
    UI->>S: POST /sales/:id/refund
    S->>SA: load original + ALL prior refunds (refundOfSaleId=id)
    alt qty + already refunded > sold qty
        S-->>UI: 400 (over-refund blocked)
    end
    S->>S: recompute at ORIGINAL prices, prorate discounts
    S->>SA: create REFUND doc "RF-00000007"<br/>totals NEGATIVE, refundOfSaleId=original
    loop each tracked line
        S->>SM: movement +qty, type=refund
        S->>SL: $inc qtyMilli +qty (restock)
    end
    S->>SA: original.status = refunded | partially_refunded
    S-->>UI: refundNumber + amount
```

### 8.5 Purchase order → goods receipt

```mermaid
sequenceDiagram
    autonumber
    actor K as Stock keeper
    participant UI as Purchasing screen
    participant API as PurchasingController
    participant PO as purchase_orders
    participant SM as stock_movements
    participant SL as stock_levels

    K->>UI: create PO (supplier, deliver-to branch, lines)
    UI->>API: POST /purchasing/orders
    API->>PO: create "PO-000013" status=ordered<br/>(sku/name snapshots, totalMinor)

    Note over K,UI: truck arrives (maybe partially)
    K->>UI: enter received qty per line (+batch, expiry)
    UI->>API: POST /orders/:id/receive {lines}
    API->>PO: guard: not canceled/received,<br/>no over-receiving per line
    loop each received line
        API->>SM: movement +qty type=receipt<br/>carries batchNumber + expiryDate
        API->>SL: $inc qtyMilli +qty (PO's branch)
        API->>PO: line.receivedQtyMilli += qty
    end
    API->>PO: all lines full? received : partially_received
    API-->>UI: updated PO
```

### 8.6 Lifecycles at a glance (state machines)

**Tenant**

```mermaid
stateDiagram-v2
    [*] --> provisioning : POST /tenants/register
    provisioning --> active : all 7 steps complete
    provisioning --> provisioning : retry-provisioning (resumes)
    active --> suspended : platform suspend (logins + API blocked)
    suspended --> active : reactivate (data untouched)
```

**Subscription → what the tenant can do**

```mermaid
stateDiagram-v2
    [*] --> trial : provisioned (plan.trialDays > 0)
    [*] --> active : provisioned (no trial)
    trial --> active : payment
    active --> past_due : payment fails
    past_due --> active : payment recovers
    past_due --> expired : graceEndsAt passes
    active --> canceled : cancel
    note right of past_due : modules STILL enabled while graceEndsAt in future
    note right of expired : module set = empty → feature endpoints 403, data retained
```

**Sale document**

```mermaid
stateDiagram-v2
    [*] --> completed : checkout / offline sync
    completed --> partially_refunded : refund (some qty)
    partially_refunded --> partially_refunded : more partial refunds
    partially_refunded --> refunded : last remaining qty refunded
    completed --> refunded : full refund in one go
    completed --> voided : void (manager)
    note right of refunded : refund docs are SEPARATE sales rows with negative totals
```

### 8.7 Master journey — one picture, whole product

```mermaid
flowchart TB
    subgraph SIGNUP["1 — Onboarding (once)"]
        direction LR
        A1[Shop owner registers<br/>plan + industry + admin] --> A2[7-step provisioning saga] --> A3[(New isolated DB<br/>mizan_t_xxxx)]
        A3 --> A4[Owner logs in]
    end

    subgraph SETUP["2 — Setup (first days)"]
        direction LR
        B1[Create branches + users<br/>within plan limits] --> B2[Build catalog<br/>SKUs, barcodes, prices, tax]
        B2 --> B3[Add suppliers] --> B4[First POs + goods receipts<br/>→ shelves stocked]
    end

    subgraph DAILY["3 — Daily operations (forever)"]
        direction LR
        C1[POS checkout<br/>online or offline] --> C2[(Stock ledger<br/>auto-decrements)]
        C3[Refunds] --> C2
        C4[Adjustments / waste] --> C2
        C2 --> C5[Low-stock report] --> C6[Reorder POs] --> C2
    end

    subgraph INSIGHT["4 — Insight & control"]
        direction LR
        D1[Sales summary by day] & D2[Top products] & D3[Audit trail]
        D4[Platform admin:<br/>suspend / plans / billing]
    end

    SIGNUP --> SETUP --> DAILY --> INSIGHT
    DAILY -->|every sale & receipt| INSIGHT
```

---

## 9. Where to read the code for each topic

| Topic | File |
|---|---|
| Core (control-plane) schemas | apps/backend/src/database/core.schemas.ts |
| Tenant schemas | apps/backend/src/database/tenant.schemas.ts |
| Tenant DB resolution / isolation | apps/backend/src/database/tenant-access.service.ts |
| Provisioning saga | apps/backend/src/tenants/tenants.service.ts |
| Checkout / offline sync / refund engine | apps/backend/src/sales/sales.service.ts |
| Stock ledger engine | apps/backend/src/inventory/inventory.service.ts |
| Entitlements (plan → modules, caching) | apps/backend/src/subscriptions/entitlements.service.ts |
| Money & quantity math | libs/shared/src/money.ts |
| Roles → permissions | libs/shared/src/security.ts |
| Offline queue (client) | apps/frontend/src/app/core/offline-queue.service.ts |
| Guard chain wiring | apps/backend/src/app.module.ts, apps/backend/src/main.ts |
