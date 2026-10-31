# Mizan — Multi-Tenant Business Management Platform

Mizan is a production-oriented, multi-tenant, offline-capable business management platform.
The first production vertical is **Supermarket**; the architecture (module registry, plans,
entitlements, per-tenant databases) is built to add Restaurant, Retail, and Pharmacy verticals
later without re-architecting.

## Monorepo layout

| Path | Package | Description |
| --- | --- | --- |
| `libs/shared` | `@mizan/shared` | Shared domain library: money math (integer minor units), roles/permissions, module registry types, offline-sync contracts |
| `apps/backend` | `@mizan/backend` | NestJS 11 + Fastify API. Control-plane DB + database-per-tenant on MongoDB |
| `apps/frontend` | `@mizan/frontend` | Angular 19 SPA: POS, catalog, inventory, purchasing, reporting, org & platform admin |
| `apps/desktop` | `@mizan/desktop` | Electron shell that packages the frontend for offline-capable POS stations |
| `infrastructure/` | — | Dockerfiles, docker-compose, nginx config |
| `docs/` | — | Architecture, security, deployment, testing docs and ADRs |

## Quick start (development)

Prerequisites: Node.js 20.x, npm 10.x. MongoDB is **not** required for tests
(they use `mongodb-memory-server`), but is required to run the backend normally.

```bash
npm install

# Build everything
npm run build -w @mizan/shared
npm run build -w @mizan/backend

# Unit tests
npm run test -w @mizan/shared
npm run test -w @mizan/backend

# Full end-to-end suite (in-memory MongoDB, no external services)
npm run test:e2e -w @mizan/backend

# Run the API (requires a MongoDB; copy apps/backend/.env.example to apps/backend/.env first)
npm run start:dev -w @mizan/backend
```

Swagger UI is available at `http://localhost:3000/docs` in non-production environments.

### Frontend

```bash
npm run start -w @mizan/frontend   # dev server on http://localhost:4200
npm run build -w @mizan/frontend
```

### Desktop (Electron)

```bash
npm run build -w @mizan/frontend   # produce the web bundle first
npm run start -w @mizan/desktop    # launch Electron against the built bundle
```

## Core concepts

- **Tenancy**: one control-plane database (`mizan_core`) plus one database per tenant
  (`mizan_t_<16-hex-id>`), all served through a single pooled MongoDB connection.
  See [docs/TENANT_ISOLATION.md](docs/TENANT_ISOLATION.md).
- **Money**: all amounts are integers in minor units (e.g. cents). Quantities are
  milli-units (1 piece = 1000, 1.250 kg = 1250). Tax rates are basis points.
- **Entitlements**: tenants subscribe to a plan; plans enable modules; every API route
  that belongs to a module is guarded. See [docs/SUBSCRIPTION_MODEL.md](docs/SUBSCRIPTION_MODEL.md).
- **Offline POS**: sales made offline are queued locally (IndexedDB via Dexie in the
  frontend) and synced idempotently. See [docs/OFFLINE_SYNC.md](docs/OFFLINE_SYNC.md).

## Documentation

- [PROJECT_STATUS.md](PROJECT_STATUS.md) — what is implemented vs planned, honestly
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md)
- [docs/TENANT_ISOLATION.md](docs/TENANT_ISOLATION.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/OFFLINE_SYNC.md](docs/OFFLINE_SYNC.md)
- [docs/SUBSCRIPTION_MODEL.md](docs/SUBSCRIPTION_MODEL.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/TESTING.md](docs/TESTING.md)
- [docs/adr/](docs/adr/) — architecture decision records

## License

Proprietary. All rights reserved.
# mizan
