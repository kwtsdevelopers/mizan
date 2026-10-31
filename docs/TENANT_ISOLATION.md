# Tenant Isolation

Isolation is enforced in **layers**, so a single mistake cannot leak tenant data.

## Layer 1 — physical: database per tenant

Every tenant's data lives in its own MongoDB database `mizan_t_<16-hex-tenantId>`.
There is no shared collection containing rows from multiple tenants, hence no
"forgot the tenantId filter" class of bug.

- DB names are derived **server-side only** from `tenantId`, which must match
  `/^[a-z0-9]{8,32}$/` (checked again at DB-handle time). No client-provided string is
  ever used in a database name.
- All tenant DBs are served through one pooled root connection via `useDb`
  (`maxPoolSize` bounded); tenant handles live in a bounded LRU-style cache
  (max 100, 10-minute idle eviction), so tenant count does not multiply sockets.

## Layer 2 — token binding

Tenant access tokens embed `tid` (tenantId) and `scope: tenant`. The models a request can
touch are resolved **only** from the token's `tid` — route params or bodies never select
the tenant. Platform tokens have `scope: platform` and **no** `tid`; the permissions guard
rejects platform tokens on tenant endpoints (no implicit platform access to tenant data).

## Layer 3 — tenant status gate

`TenantAccessService.modelsFor(tid)` re-validates (30 s cache) that the tenant exists and
is `active` before handing out models. Suspension takes effect within seconds and also
blocks login. Provisioning uses a separate bypass path that only the provisioning pipeline
calls.

## Layer 4 — provisioning verification

The provisioning pipeline's `verify_isolation` step confirms the registry's derived DB
name matches and the tenant admin exists in that DB before the tenant is activated.

## Verified by tests

The e2e suite registers multiple tenants and asserts:

- tenant B cannot list, read, update, or barcode-lookup tenant A's products (404),
- a platform admin token is rejected (403) on tenant data endpoints,
- anonymous requests are rejected (401),
- a suspended tenant's API access and logins fail until reactivation.

## Operational notes

- Backups/exports can be taken per tenant database (`mongodump --db mizan_t_<id>`).
- Offboarding = archive tenant, then drop its database after the retention window.
