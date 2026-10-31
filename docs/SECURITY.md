# Security

## Authentication

- **JWT access tokens** (15 min) + **refresh tokens** (7 days) signed with separate secrets.
- **Refresh rotation with replay detection**: each refresh token carries a random `rid`;
  only the sha256 hash is stored (max 10 active per user). Refreshing atomically swaps the
  old `rid` for a new one (positional update) — replaying a rotated token fails with 401.
- **Account lockout**: 5 failed logins lock the account for 15 minutes.
- **Disabling a user revokes all refresh tokens** immediately; self-disable is blocked.
- Passwords hashed with bcrypt. Login responses are uniform ("invalid credentials")
  regardless of which part failed.
- Platform bootstrap: the first platform admin is created from
  `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD` env only when none exists.

## Authorization

- Two token scopes: `platform` and `tenant`. Neither works on the other's endpoints —
  platform admins have **no implicit access to tenant business data**.
- Tenant RBAC: roles (Owner, Admin, BranchManager, Cashier, InventoryOperator, Accountant)
  map to fine-grained permissions in `@mizan/shared`; controllers declare
  `@RequirePermissions(...)`.
- Module entitlements: `@RequireModules(...)` is enforced per route against the tenant's
  subscription (e.g. a basic-plan tenant gets 403 on purchasing and offline sync).

## Transport & platform hardening

- `@fastify/helmet` security headers; CORS restricted to configured origins; 2 MB body
  limit; `trustProxy` enabled for correct client IPs behind a reverse proxy.
- Global rate limiting (300 req/min) plus tighter per-route throttles on login,
  registration, and refresh.
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`: unknown fields are
  rejected, all inputs validated with class-validator.
- Regex inputs (search) are escaped before use; barcode/SKU lookups use exact matches.
- Tenant DB names derive only from the validated server-side `tenantId` — no injection
  path into database selection.
- Logs redact `authorization`, `cookie`, `password`, `adminPassword`, `refreshToken`.
- Swagger UI is disabled in production.
- Config fail-safes: production boot **refuses** default/placeholder JWT secrets and
  refuses identical access/refresh secrets.

## Auditing

- Control-plane audit (`platform_audit`): registrations, provisioning results,
  suspend/reactivate.
- Tenant audit (`audit_events`): catalog changes, adjustments, user management, sync
  batches, refunds. Audit writes are fire-and-forget by design (never fail the business op).

## Deferred (tracked in PROJECT_STATUS.md)

2FA, IP allowlisting, per-tenant encryption keys, SIEM export, CSP for the SPA (currently
helmet's CSP is disabled to keep Swagger/Angular dev simple — enable and tune before
exposing the API directly to browsers in production), payment-data handling (no card data
is ever stored; billing integration is future work).

## Reporting a vulnerability

Open a private security advisory or contact the maintainers directly; do not file public
issues for exploitable bugs.
