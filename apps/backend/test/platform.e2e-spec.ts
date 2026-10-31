import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, TestContext } from './test-app';

/**
 * End-to-end platform verification:
 *  - tenant provisioning (idempotent workflow)
 *  - tenant isolation (cross-tenant access must fail)
 *  - authentication, permissions, entitlements
 *  - online checkout with inventory deduction and idempotency
 *  - offline sync (duplicates, warnings)
 *  - refunds with restocking
 *  - tenant suspension
 */
describe('Mizan platform (e2e)', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;

  // tokens
  let platformToken: string;
  let tokenA: string; // tenant A owner (pro plan)
  let tokenB: string; // tenant B owner (pro plan)
  let tokenBasic: string; // tenant C owner (basic plan - no offline pos / purchasing)
  let cashierToken: string;

  let tenantAId: string;
  let productAId: string;
  let branchAId: string;

  const inject = (opts: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    token?: string;
    payload?: unknown;
  }) =>
    app.inject({
      method: opts.method,
      url: opts.url,
      payload: opts.payload as Record<string, unknown> | undefined,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await ctx.stop();
  });

  it('serves health endpoints without authentication', async () => {
    const res = await inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('lists public plans', async () => {
    const res = await inject({ method: 'GET', url: '/api/v1/plans' });
    expect(res.statusCode).toBe(200);
    const plans = res.json() as Array<{ planId: string }>;
    expect(plans.map((p) => p.planId)).toEqual(
      expect.arrayContaining(['supermarket_basic', 'supermarket_pro']),
    );
  });

  it('registers and provisions tenant A (supermarket pro)', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/tenants/register',
      payload: {
        name: 'Alpha Market',
        slug: 'alpha-market',
        industry: 'supermarket',
        planId: 'supermarket_pro',
        billingPeriod: 'monthly',
        currency: 'USD',
        timezone: 'UTC',
        adminEmail: 'owner@alpha.test',
        adminName: 'Alpha Owner',
        adminPassword: 'alpha-password-1',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { tenantId: string; status: string };
    expect(body.status).toBe('active');
    tenantAId = body.tenantId;
  });

  it('rejects duplicate tenant slug', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/tenants/register',
      payload: {
        name: 'Alpha Clone',
        slug: 'alpha-market',
        industry: 'supermarket',
        planId: 'supermarket_pro',
        billingPeriod: 'monthly',
        currency: 'USD',
        timezone: 'UTC',
        adminEmail: 'clone@alpha.test',
        adminName: 'Clone',
        adminPassword: 'clone-password-1',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('provisions tenants B (pro) and C (basic)', async () => {
    for (const [slug, plan, email] of [
      ['beta-market', 'supermarket_pro', 'owner@beta.test'],
      ['gamma-market', 'supermarket_basic', 'owner@gamma.test'],
    ] as const) {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/tenants/register',
        payload: {
          name: slug,
          slug,
          industry: 'supermarket',
          planId: plan,
          billingPeriod: 'monthly',
          currency: 'USD',
          timezone: 'UTC',
          adminEmail: email,
          adminName: 'Owner',
          adminPassword: 'owner-password-1',
        },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { status: string }).status).toBe('active');
    }
  });

  it('logs in tenant users and the platform admin', async () => {
    const loginA = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'alpha-market', email: 'owner@alpha.test', password: 'alpha-password-1' },
    });
    expect(loginA.statusCode).toBe(200);
    tokenA = (loginA.json() as { accessToken: string }).accessToken;

    const loginB = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'beta-market', email: 'owner@beta.test', password: 'owner-password-1' },
    });
    expect(loginB.statusCode).toBe(200);
    tokenB = (loginB.json() as { accessToken: string }).accessToken;

    const loginC = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'gamma-market', email: 'owner@gamma.test', password: 'owner-password-1' },
    });
    expect(loginC.statusCode).toBe(200);
    tokenBasic = (loginC.json() as { accessToken: string }).accessToken;

    const loginP = await inject({
      method: 'POST',
      url: '/api/v1/auth/platform/login',
      payload: { email: 'platform@test.local', password: 'platform-password-123' },
    });
    expect(loginP.statusCode).toBe(200);
    platformToken = (loginP.json() as { accessToken: string }).accessToken;
  });

  it('rejects wrong credentials', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'alpha-market', email: 'owner@alpha.test', password: 'wrong-password-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a product in tenant A', async () => {
    const branches = await inject({ method: 'GET', url: '/api/v1/org/branches', token: tokenA });
    expect(branches.statusCode).toBe(200);
    const branchList = branches.json() as Array<{ _id: string }>;
    expect(branchList.length).toBe(1);
    branchAId = branchList[0]._id;

    const res = await inject({
      method: 'POST',
      url: '/api/v1/catalog/products',
      token: tokenA,
      payload: {
        sku: 'MILK-1L',
        barcodes: ['6291041500213'],
        name: 'Fresh Milk 1L',
        kind: 'standard',
        unit: 'pc',
        priceMinor: 350,
        costMinor: 250,
        taxRateBps: 500,
        trackInventory: true,
      },
    });
    expect(res.statusCode).toBe(201);
    productAId = String((res.json() as { _id: string })._id);
  });

  it('TENANT ISOLATION: tenant B cannot see or manipulate tenant A data', async () => {
    // B's product list does not contain A's product
    const listB = await inject({ method: 'GET', url: '/api/v1/catalog/products', token: tokenB });
    expect(listB.statusCode).toBe(200);
    expect((listB.json() as { total: number }).total).toBe(0);

    // Direct id access from B fails (resolved in B's database)
    const getB = await inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${productAId}`,
      token: tokenB,
    });
    expect(getB.statusCode).toBe(404);

    // Update/archive attempts also fail
    const patchB = await inject({
      method: 'PATCH',
      url: `/api/v1/catalog/products/${productAId}`,
      token: tokenB,
      payload: { priceMinor: 1 },
    });
    expect(patchB.statusCode).toBe(404);

    // Barcode lookup from B fails
    const lookupB = await inject({
      method: 'GET',
      url: '/api/v1/catalog/products/lookup/6291041500213',
      token: tokenB,
    });
    expect(lookupB.statusCode).toBe(404);
  });

  it('TENANT ISOLATION: unauthenticated and platform-scope access to tenant APIs fails', async () => {
    const anon = await inject({ method: 'GET', url: '/api/v1/catalog/products' });
    expect(anon.statusCode).toBe(401);

    // Platform admin has NO implicit access to tenant business data
    const plat = await inject({ method: 'GET', url: '/api/v1/catalog/products', token: platformToken });
    expect(plat.statusCode).toBe(403);
  });

  it('receives stock via inventory adjustment', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      token: tokenA,
      payload: { productId: productAId, branchId: branchAId, qtyMilli: 10000, type: 'adjustment', note: 'initial stock' },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { newQtyMilli: number }).newQtyMilli).toBe(10000);
  });

  it('completes an online checkout, deducts stock, and is idempotent', async () => {
    const payload = {
      clientTxId: 'tx-online-0001',
      branchId: branchAId,
      registerId: 'reg-1',
      lines: [{ productId: productAId, qtyMilli: 2000, discountMinor: 0 }],
      payments: [{ method: 'cash', amountMinor: 1000 }],
    };
    const res = await inject({ method: 'POST', url: '/api/v1/sales/checkout', token: tokenA, payload });
    expect(res.statusCode).toBe(201);
    const sale = res.json() as { totalMinor: number; changeMinor: number; duplicate: boolean; saleNumber: string };
    // 2 x 3.50 = 7.00 + 5% tax (0.35) = 7.35 ; change = 10.00 - 7.35 = 2.65
    expect(sale.totalMinor).toBe(735);
    expect(sale.changeMinor).toBe(265);
    expect(sale.duplicate).toBe(false);

    // stock: 10000 - 2000 = 8000
    const level = await inject({
      method: 'GET',
      url: `/api/v1/inventory/levels/${productAId}/${branchAId}`,
      token: tokenA,
    });
    expect((level.json() as { qtyMilli: number }).qtyMilli).toBe(8000);

    // duplicate submission returns the same sale, no double deduction
    const dup = await inject({ method: 'POST', url: '/api/v1/sales/checkout', token: tokenA, payload });
    expect((dup.json() as { duplicate: boolean }).duplicate).toBe(true);
    const level2 = await inject({
      method: 'GET',
      url: `/api/v1/inventory/levels/${productAId}/${branchAId}`,
      token: tokenA,
    });
    expect((level2.json() as { qtyMilli: number }).qtyMilli).toBe(8000);
  });

  it('rejects underpaid checkout', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/sales/checkout',
      token: tokenA,
      payload: {
        clientTxId: 'tx-underpaid-01',
        branchId: branchAId,
        registerId: 'reg-1',
        lines: [{ productId: productAId, qtyMilli: 1000, discountMinor: 0 }],
        payments: [{ method: 'cash', amountMinor: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('syncs offline sales idempotently with warnings', async () => {
    const sale = {
      clientTxId: 'tx-offline-0001',
      branchId: branchAId,
      registerId: 'reg-2',
      occurredAt: new Date().toISOString(),
      lines: [
        {
          productId: productAId,
          sku: 'MILK-1L',
          description: 'Fresh Milk 1L',
          qtyMilli: 9000, // more than on hand (8000) -> negative stock warning
          unitPriceMinor: 300, // offline price drift vs current 350 -> warning
          discountMinor: 0,
          taxRateBps: 500,
        },
      ],
      payments: [{ method: 'cash', amountMinor: 2835 }],
    };
    const res = await inject({
      method: 'POST',
      url: '/api/v1/sales/sync',
      token: tokenA,
      payload: { sales: [sale] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { results: Array<{ status: string; warnings?: string[] }> };
    expect(body.results[0].status).toBe('applied');
    expect(body.results[0].warnings?.join(' ')).toMatch(/Price drift/);
    expect(body.results[0].warnings?.join(' ')).toMatch(/negative/i);

    // resubmission -> duplicate, no re-application
    const again = await inject({
      method: 'POST',
      url: '/api/v1/sales/sync',
      token: tokenA,
      payload: { sales: [sale] },
    });
    expect((again.json() as { results: Array<{ status: string }> }).results[0].status).toBe('duplicate');

    const level = await inject({
      method: 'GET',
      url: `/api/v1/inventory/levels/${productAId}/${branchAId}`,
      token: tokenA,
    });
    expect((level.json() as { qtyMilli: number }).qtyMilli).toBe(-1000);
  });

  it('ENTITLEMENTS: basic plan cannot use offline sync or purchasing', async () => {
    const sync = await inject({
      method: 'POST',
      url: '/api/v1/sales/sync',
      token: tokenBasic,
      payload: {
        sales: [
          {
            clientTxId: 'tx-basic-00001',
            branchId: 'x',
            registerId: 'r',
            occurredAt: new Date().toISOString(),
            lines: [
              {
                productId: 'p',
                sku: 's',
                description: 'd',
                qtyMilli: 1000,
                unitPriceMinor: 100,
                discountMinor: 0,
                taxRateBps: 0,
              },
            ],
            payments: [{ method: 'cash', amountMinor: 100 }],
          },
        ],
      },
    });
    expect(sync.statusCode).toBe(403);

    const po = await inject({ method: 'GET', url: '/api/v1/purchasing/orders', token: tokenBasic });
    expect(po.statusCode).toBe(403);
  });

  it('refunds part of a sale and restocks', async () => {
    const sales = await inject({ method: 'GET', url: '/api/v1/sales?pageSize=50', token: tokenA });
    const items = (sales.json() as { items: Array<{ _id: string; clientTxId: string }> }).items;
    const original = items.find((s) => s.clientTxId === 'tx-online-0001');
    expect(original).toBeDefined();

    const res = await inject({
      method: 'POST',
      url: `/api/v1/sales/${original!._id}/refund`,
      token: tokenA,
      payload: { lines: [{ productId: productAId, qtyMilli: 1000 }], reason: 'damaged item' },
    });
    expect(res.statusCode).toBe(201);
    const refund = res.json() as { refundTotalMinor: number };
    // 1 x 3.50 + 5% tax = 3.68 (367.5 -> 368)
    expect(refund.refundTotalMinor).toBe(368);

    const level = await inject({
      method: 'GET',
      url: `/api/v1/inventory/levels/${productAId}/${branchAId}`,
      token: tokenA,
    });
    expect((level.json() as { qtyMilli: number }).qtyMilli).toBe(0); // -1000 + 1000

    // over-refund rejected
    const over = await inject({
      method: 'POST',
      url: `/api/v1/sales/${original!._id}/refund`,
      token: tokenA,
      payload: { lines: [{ productId: productAId, qtyMilli: 2000 }], reason: 'test' },
    });
    expect(over.statusCode).toBe(400);
  });

  it('RBAC: cashier cannot manage catalog or users', async () => {
    const create = await inject({
      method: 'POST',
      url: '/api/v1/org/users',
      token: tokenA,
      payload: {
        email: 'cashier@alpha.test',
        name: 'Cashier One',
        password: 'cashier-password-1',
        roles: ['cashier'],
      },
    });
    expect(create.statusCode).toBe(201);

    const login = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'alpha-market', email: 'cashier@alpha.test', password: 'cashier-password-1' },
    });
    expect(login.statusCode).toBe(200);
    cashierToken = (login.json() as { accessToken: string }).accessToken;

    const forbidden = await inject({
      method: 'POST',
      url: '/api/v1/catalog/products',
      token: cashierToken,
      payload: { sku: 'HACK-1', barcodes: [], name: 'Hack', priceMinor: 1 },
    });
    expect(forbidden.statusCode).toBe(403);

    const users = await inject({ method: 'GET', url: '/api/v1/org/users', token: cashierToken });
    expect(users.statusCode).toBe(403);

    // but cashier CAN look up products and checkout
    const lookup = await inject({
      method: 'GET',
      url: '/api/v1/catalog/products/lookup/MILK-1L',
      token: cashierToken,
    });
    expect(lookup.statusCode).toBe(200);
  });

  it('produces a sales summary report', async () => {
    const res = await inject({ method: 'GET', url: '/api/v1/reports/sales-summary', token: tokenA });
    expect(res.statusCode).toBe(200);
    const report = res.json() as {
      totals: { salesCount: number; totalMinor: number; offlineCount: number };
      refunds: { refundCount: number };
    };
    expect(report.totals.salesCount).toBe(2); // online + offline
    expect(report.totals.offlineCount).toBe(1);
    expect(report.refunds.refundCount).toBe(1);
  });

  it('platform admin can suspend a tenant; suspended tenant is locked out', async () => {
    const suspend = await inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantAId}/suspend`,
      token: platformToken,
    });
    expect(suspend.statusCode).toBe(201);

    const blocked = await inject({ method: 'GET', url: '/api/v1/catalog/products', token: tokenA });
    expect(blocked.statusCode).toBe(403);

    const loginBlocked = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'alpha-market', email: 'owner@alpha.test', password: 'alpha-password-1' },
    });
    expect(loginBlocked.statusCode).toBe(401);

    const reactivate = await inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantAId}/reactivate`,
      token: platformToken,
    });
    expect(reactivate.statusCode).toBe(201);

    const unblocked = await inject({ method: 'GET', url: '/api/v1/catalog/products', token: tokenA });
    expect(unblocked.statusCode).toBe(200);
  });

  it('tenant user cannot call platform admin APIs', async () => {
    const res = await inject({ method: 'GET', url: '/api/v1/platform/tenants', token: tokenA });
    expect(res.statusCode).toBe(403);
  });

  it('refresh token rotation works and old refresh token is rejected', async () => {
    const login = await inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'beta-market', email: 'owner@beta.test', password: 'owner-password-1' },
    });
    const { refreshToken } = login.json() as { refreshToken: string };

    const refresh1 = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(refresh1.statusCode).toBe(200);

    // old token was rotated out
    const replay = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });
});
