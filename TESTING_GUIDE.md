# Mizan — Complete User Walkthrough & Testing Guide

This guide assumes **zero prior knowledge** of the application. Follow it top to bottom and you will have exercised every feature of the product, the same way a real supermarket would use it day to day.

---

## 1. What is this application?

**Mizan** is a point-of-sale and back-office system for supermarkets, sold as a service:

- **You (the platform owner)** host it and sign up customer businesses.
- **Each customer business ("store" / tenant)** — e.g. *Al Madina Supermarket* — gets its own completely separate data space, staff accounts, products, stock and sales.
- **Store staff** use it daily: cashiers ring up sales (even with no internet), stock keepers receive deliveries, managers watch reports.

Three kinds of people will appear in this guide:

| Person | Logs in via | What they do |
|---|---|---|
| Platform admin | "Platform admin" tab on login screen | Manages stores: suspend, reactivate, monitor |
| Store owner / manager | "Store login" tab (needs Store ID) | Sets up products, staff, suppliers; sees reports |
| Cashier | "Store login" tab | Sells at the POS, handles refunds |

---

## 2. Start the application (3 terminals)

> Prerequisites: Node.js 20+, npm 10+. No database install needed — the dev launcher runs a disposable in-memory MongoDB.

```powershell
# Terminal 1 — backend API (port 3000) with in-memory database
npm run start:memory -w @mizan/backend

# Terminal 2 — web frontend (port 4200)
npm run start -w @mizan/frontend

# Terminal 3 — desktop app (optional; same UI in an Electron window)
cd apps/desktop
$env:MIZAN_DEV_URL = 'http://localhost:4200'
npm run start
```

Open **http://localhost:4200** in a browser (or use the Electron window).

**Built-in platform admin** (created automatically on first start):

| Field | Value |
|---|---|
| Email | `platform@local.dev` |
| Password | `platform-dev-password-123` |

> ⚠️ The in-memory database is wiped every time you restart Terminal 1. Re-do the registration step after each restart.

---

## 3. Scenario 0 — A new supermarket signs up

There is no public sign-up page yet; onboarding is done through the API (in production this would be your sales/onboarding flow). Run this once in a new PowerShell window:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/v1/tenants/register' `
  -ContentType 'application/json' -Body (@{
    name          = 'Demo Market'
    slug          = 'demo-market'
    industry      = 'supermarket'
    planId        = 'supermarket_pro'
    billingPeriod = 'monthly'
    currency      = 'USD'
    timezone      = 'Asia/Dubai'
    adminName     = 'Owner'
    adminEmail    = 'owner@demo.local'
    adminPassword = 'demo-password-123'
  } | ConvertTo-Json)
```

**Expected:** a JSON response with `status: active`. Behind the scenes the platform created the store's private database, a default **Main Branch**, the owner account, and a subscription to the *Supermarket Pro* plan.

✅ **Test idea:** run the same command again → it fails with "slug already taken" (no duplicate stores).

---

## 4. Scenario 1 — First login (store owner)

1. Go to http://localhost:4200 → you are redirected to the login page.
2. Keep the **Store login** tab selected.
3. Enter:
   - Store ID (slug): `demo-market`
   - Email: `owner@demo.local`
   - Password: `demo-password-123`
4. Click **Sign in**.

**Expected:** you land on the **Point of Sale** page. A dark sidebar shows: POS, Products, Inventory, Sales, Customers, Suppliers, Purchasing, Reports, Organization. Bottom-left shows a green **Online** badge and a **Sign out** button.

✅ **Negative tests:**
- Wrong password → "Invalid credentials". (5 wrong attempts in a row locks the account briefly.)
- Wrong slug → same generic error (we don't reveal whether a store exists).

---

## 5. Scenario 2 — Set up the organization

Go to **Organization** in the sidebar.

### 5a. Branches
1. You already have **Main Branch (MAIN)** — created automatically.
2. Add a branch: name `City Center`, code `CC01` → **Create branch**.

**Expected:** both branches listed with green Active badges.

### 5b. Staff users
1. In the Users section, create a cashier:
   - Name: `Sara Cashier`, Email: `sara@demo.local`, Password: `cashier-pass-123` (min 10 chars)
   - Roles: select **cashier**
2. Create a manager the same way if you like (`manager` role).

**Expected:** users appear in the list with Active badges and their roles.

✅ **Test ideas:**
- Click **Disable** on a user → badge turns red; that user can no longer log in (try it!). **Enable** restores access.
- The **Audit log** card at the bottom records everything you just did (who, what, when).

---

## 6. Scenario 3 — Build the product catalog

Go to **Products** → **New product**. Create these two:

| Field | Product 1 | Product 2 |
|---|---|---|
| SKU | `MILK-1L` | `RICE-5KG` |
| Name | `Fresh Milk 1L` | `Basmati Rice 5kg` |
| Kind | standard | standard |
| Price | `3.50` | `24.00` |
| Cost | `2.50` | `18.00` |
| Tax rate % | `5` | `0` |
| Barcodes | `6291041500213` | `6291041500220` |

**Expected:** products appear in the grid with formatted prices and Active badges.

✅ **Test ideas:**
- Search box filters by name/SKU.
- **Edit** a product, change the price → saved immediately.
- **Archive** a product → badge flips to Archived; it can no longer be sold at the POS, but old sales of it remain intact.
- Try a duplicate SKU → rejected.

> 💡 "Weighted" kind is for items sold by weight (e.g. produce priced per kg); quantity can then be fractional like `1.5` at the POS.

---

## 7. Scenario 4 — Suppliers

Go to **Suppliers** → **New supplier**:

- Name: `Gulf Food Distributors`, phone/email optional → **Save**.

**Expected:** supplier listed with an Active badge. (Edit later to archive — archived suppliers can't receive new purchase orders.)

---

## 8. Scenario 5 — Order and receive stock (Purchasing)

Your shelves are empty — stock arrives via purchase orders.

### 8a. Create the order
Go to **Purchasing** → **New purchase order**:
1. Supplier: `Gulf Food Distributors`
2. **Deliver to branch:** `Main Branch`
3. Add lines (search product by name/SKU):
   - `Fresh Milk 1L` — qty `100`, unit cost `2.50`
   - `Basmati Rice 5kg` — qty `40`, unit cost `18.00`
4. **Create order**.

**Expected:** order `PO-000001` appears with status **ordered** and the correct total.

### 8b. Receive the delivery
1. Open the PO → **Receive**.
2. Enter received quantities — try a **partial** receipt first: Milk `60`, Rice `0`.
   - Optionally fill batch number / expiry date per line (dairy!).
3. Confirm.

**Expected:** PO status becomes **partially_received**; line shows 60/100 received.

4. Receive again with Milk `40`, Rice `40`.

**Expected:** PO flips to **received**.

✅ **Verify the effect:** go to **Inventory** → Main Branch now shows Milk `100`, Rice `40` on hand.

✅ **Negative test:** try receiving more than ordered → blocked with a clear error.

---

## 9. Scenario 6 — Inventory corrections

Go to **Inventory**:

1. The table shows live stock per branch (switch branch with the dropdown).
2. In **Stock adjustment**: search `MILK`, quantity `-2`, type **Waste / damage**, reason `2 cartons expired` → **Apply**.

**Expected:** Milk drops to `98`. Every change like this is permanently recorded — nothing edits stock "silently".

---

## 10. Scenario 7 — Sell at the POS (the main event)

Go to **POS**:

1. In the scan box type a barcode (`6291041500213`) or SKU (`MILK-1L`) and press **Enter** — the item lands in the cart. Add it twice; add rice once.
2. Change a line's quantity by typing over it; the running **Total** (incl. tax) updates live.
3. Payment: enter **Cash received** `50` (you can also split with **Card amount**).
4. Click **Complete sale**.

**Expected:** a confirmation like *"Sale S-00000001 — total 31.35, change 18.65"*. Cart resets for the next customer.

✅ **Verify the effects:**
- **Inventory** → Milk decreased by 2, Rice by 1.
- **Sales** → the sale is listed, status **completed**, source **online**.

✅ **Negative tests:**
- Pay less than the total → "Insufficient payment", nothing is saved.
- Archived product's barcode → not found at POS.

---

## 11. Scenario 8 — Offline selling (the superpower)

The POS keeps working with no internet and catches up later.

1. **Simulate going offline:** in the browser press F12 → Network tab → set throttling to **Offline**. (Alternative: stop the backend in Terminal 1.)
2. The sidebar badge flips to red **Offline**.
3. Ring up a sale exactly like before → button now says **Complete sale (offline)**.

**Expected:** *"Saved offline — will sync when connection returns."* The sidebar shows a yellow **1 pending** badge. Sell another one — **2 pending**.

4. **Reconnect** (set throttling back to "No throttling" / restart the backend).
5. Either wait a moment or go to POS → **Offline queue** card → **Sync now**.

**Expected:** pending count drops to 0. Go to **Sales** — the offline sales are listed with source **offline** and real receipt numbers.

✅ **Deep test:** while offline, sell *more milk than is in stock*, then sync. The sale is still accepted (the customer already left with the goods!) and Inventory shows **negative stock** highlighted in red — a flag for the manager to investigate, not a data error.

---

## 12. Scenario 9 — Refund a customer

Go to **Sales**:

1. Pick the first sale → **Refund**.
2. The dialog lists what was bought. Refund **1 × Fresh Milk** only (partial refund), reason: `Customer returned - leaking carton`.
3. Confirm.

**Expected:**
- A refund receipt `RF-00000001` appears in the list with a **negative** amount.
- The original sale's status becomes **partially_refunded**.
- **Inventory**: the milk went back on the shelf (+1).

✅ **Negative test:** try refunding that same line again for the full quantity → blocked ("exceeds sold quantity"). You can never refund more than was bought, even across multiple partial refunds.

---

## 13. Scenario 10 — Customers

Go to **Customers** → **New customer**: `Ayesha Khan`, phone `0501234567` → Save.

At the **POS**, you can attach a customer to a sale before completing it — their purchase history then shows on their record. Search works by name or phone.

---

## 14. Scenario 11 — Reports (the manager's view)

Go to **Reports**. Default range is the last 30 days; click **Run** after changing dates.

**Expected to see, reflecting everything you did above:**

| Card | Should show |
|---|---|
| Sales | count of completed sales (online + offline) |
| Revenue | sum of your sales |
| Tax collected | the 5% milk tax portion |
| Offline sales | how many came through the offline queue |
| Refunded | your RF- refund amount and count |
| Daily sales table | one row per day with counts and revenue |
| Top products | Milk and Rice ranked by revenue |
| Low stock | any product at/below its reorder level (set a product's reorder level to test) |

---

## 15. Scenario 12 — Role-based access (log in as the cashier)

1. **Sign out** (bottom of sidebar).
2. Log in as `sara@demo.local` / `cashier-pass-123` (slug `demo-market`).

**Expected:** Sara can use the **POS** and view products, but attempts to manage products, purchasing, organization, or reports are **rejected by the server** (you'll see permission errors on those screens). Each role sees only what their job needs:

| Role | Can |
|---|---|
| owner | everything |
| manager | catalog, inventory, purchasing, sales, reports |
| cashier | sell + refund at POS, read catalog |
| stock_keeper | inventory + purchasing |
| accountant | reports + read-only data |

---

## 16. Scenario 13 — Platform administration

1. Sign out → login page → **Platform admin** tab.
2. Log in: `platform@local.dev` / `platform-dev-password-123`.

**Expected:** a different, minimal UI with only a **Tenants** screen listing `Demo Market` (status **active**, creation date).

### Suspend / reactivate a store
1. Click **Suspend** on Demo Market → confirm.
2. Open a private browser window and try to log in as the store owner.

**Expected:** login is refused — the entire store is frozen (API access and logins), but **no data is lost**.

3. Back in the platform window, click **Reactivate** → the owner can log in again, everything intact.

> Note the deliberate boundary: the platform admin can manage the store's *lifecycle* but can never see its products, sales or customers.

---

## 17. Full regression checklist (quick re-test after changes)

- [ ] Register store (Scenario 0) → active
- [ ] Owner login / wrong-password rejection
- [ ] Create branch + cashier user; disable/enable user
- [ ] Create 2 products; edit; archive; duplicate-SKU rejected
- [ ] Create supplier
- [ ] PO: create → partial receive → full receive; over-receive blocked
- [ ] Inventory shows received stock; waste adjustment works
- [ ] Online sale: change calculated, stock decremented, appears in Sales
- [ ] Underpayment rejected
- [ ] Offline: badge flips, sales queue up, pending count shows
- [ ] Reconnect: queue syncs, sales appear as offline, duplicates never created
- [ ] Oversell offline → negative stock flagged red
- [ ] Partial refund → RF- doc, restock, status partially_refunded; over-refund blocked
- [ ] Customer created and attachable to a sale
- [ ] Reports reflect all of the above (incl. offline + refund numbers)
- [ ] Cashier role blocked from management screens
- [ ] Platform admin: list, suspend (owner locked out), reactivate (data intact)

---

## 18. Troubleshooting

| Symptom | Fix |
|---|---|
| Login says "Tenant is not available" | Backend restarted (in-memory DB wiped) — re-run Scenario 0 |
| "Invalid credentials" as platform admin | Backend bootstraps the admin only on first start with an empty DB; restart Terminal 1 |
| Frontend loads but every action fails | Backend not running — check Terminal 1, health at http://localhost:3000/health |
| Offline badge never turns red | Use DevTools Network → Offline in the same tab, or fully stop the backend |
| Electron shows "Frontend bundle not found" | Set `$env:MIZAN_DEV_URL='http://localhost:4200'` before `npm run start`, or build the frontend first |
| Session expires mid-testing | Normal — tokens rotate automatically; if it ever sticks, sign out and back in |
