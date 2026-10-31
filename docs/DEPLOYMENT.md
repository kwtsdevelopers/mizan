# Deployment

> Honesty note: Docker is not installed on the original development machine, so the
> Dockerfiles and compose stack are **written but unverified locally**. Validate them in a
> Docker-capable environment before first production use.

## Topology (single host, small deployments)

`infrastructure/compose/docker-compose.yml` runs:

- `mongodb` — MongoDB 7 as a single-node replica set (volume-backed, healthchecked);
  `mongo-init` initializes the replica set once.
- `backend` — the API image (multi-stage build, non-root user, readiness healthcheck).
- `frontend` — Angular bundle served by nginx, which also reverse-proxies `/api/` to the
  backend.

```bash
cd infrastructure/compose
# create a .env next to the compose file:
#   JWT_ACCESS_SECRET=<64+ random chars>
#   JWT_REFRESH_SECRET=<different 64+ random chars>
#   PLATFORM_ADMIN_EMAIL=you@example.com
#   PLATFORM_ADMIN_PASSWORD=<strong password>
#   CORS_ORIGINS=https://your.domain
docker compose up -d --build
```

Put TLS in front (Caddy/Traefik/nginx with certificates, or a cloud load balancer).
The app sets `trustProxy`, so forwarded headers are honored.

## Environment variables (backend)

See apps/backend/.env.example. Critical ones:

| Variable | Notes |
| --- | --- |
| `MONGODB_URI` | prefer a replica-set URI; managed MongoDB (Atlas) recommended for SaaS |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | must differ; production boot refuses placeholders |
| `CORE_DB_NAME` / `TENANT_DB_PREFIX` | default `mizan_core` / `mizan_t_` |
| `CORS_ORIGINS` | comma-separated exact origins |
| `PLATFORM_ADMIN_EMAIL/PASSWORD` | bootstrap only; first boot creates the admin if none exists |

## Zero-downtime notes

- The backend is stateless — run N replicas behind a load balancer freely.
- Indexes are created by provisioning per tenant DB; new indexes added in code are applied
  on provisioning or by a maintenance script (`ensureTenantIndexes`), not at request time.
- Health endpoints: `/health/live` (process up), `/health/ready` (DB reachable, 503 otherwise).

## Backups

- Control plane: `mongodump --db mizan_core` on a schedule.
- Tenants: `mongodump --db mizan_t_<tenantId>` — per-tenant granularity enables
  tenant-level restore and data export for offboarding.
- Test restores regularly; backups you have not restored are hopes, not backups.

## Upgrades

1. `npm ci && npm run build` all workspaces; run the full test suite.
2. Build & push images; rolling-restart backend replicas; frontend is static and atomic.
3. Tenant DB migrations: write idempotent scripts; run per tenant iterating the registry.
