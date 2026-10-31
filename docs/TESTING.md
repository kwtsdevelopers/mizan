# Testing

## Layers

| Layer | Where | Runner | External deps |
| --- | --- | --- | --- |
| Unit — money math | libs/shared/src/money.spec.ts | jest | none |
| Unit — module registry | apps/backend/src/subscriptions/module-registry.spec.ts | jest | none |
| E2E — full API | apps/backend/test/platform.e2e-spec.ts | jest + `mongodb-memory-server` + Fastify `app.inject()` | none (downloads a mongod binary on first run) |

```bash
npm run test -w @mizan/shared
npm run test -w @mizan/backend
npm run test:e2e -w @mizan/backend   # --runInBand, 120 s per-test timeout
```

No Docker, no running MongoDB, and no network services are required — the e2e suite boots
the real Nest application (same pipes/prefix as production `main.ts`) against an in-memory
MongoDB and drives it through Fastify's injection interface.

## What the e2e suite proves

- Health endpoints; public plan catalog.
- Tenant self-registration → 7-step provisioning → active; duplicate slug → 409.
- Platform + tenant logins; wrong credentials → 401; lockout fields exercised.
- **Tenant isolation**: tenant B cannot see/update/lookup tenant A's products; platform
  tokens rejected on tenant endpoints; anonymous → 401.
- Catalog create/lookup; stock adjustment; server-priced checkout with tax/change
  validation; duplicate `clientTxId` idempotency; underpaid → 400.
- Offline sync: price-drift + negative-stock warnings, duplicate resubmission,
  basic-plan entitlement rejection (OfflinePos, Purchasing).
- Partial refund with proportional discount, restock, over-refund rejection.
- RBAC: cashier can sell but cannot manage catalog or users.
- Suspension: API 403 + login blocked, then reactivation restores access.
- Refresh token rotation and replay detection.

## Conventions

- Jest maps `@mizan/shared` to its TypeScript source, so tests never require a prebuilt lib.
- E2E env (JWT test secrets, platform admin credentials, `NODE_ENV=test`, silent logs) is
  set in `test/test-app.ts` **before** the app module is imported.
- Tests run `--runInBand`: the suite shares one in-memory mongod.

## Gaps (honest)

- Frontend has no automated tests yet (manual verification); add component tests and a
  Playwright smoke flow next.
- Docker images are not built in CI yet.
- Load/performance testing has not been performed.
