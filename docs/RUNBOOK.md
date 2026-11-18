# Manual UI/UX Runbook — Kibbutz Dining Hall Platform

Step-by-step guide to bring the stack up on the host and exercise all three
React SPAs (POS, Signage, Public Web) by hand.

Stack recap:
- Backend (Frappe/ERPNext) runs **inside** the devcontainer `devcontainer-frappe-1`
  - Web/API: container `8000` → host `8000`
  - Socket.IO: container `9000` → host `9010`
- SPAs run **on the host** via Vite:
  - POS `:5173` · Signage `:5174` · Public Web `:5175` · Admin `:5176`
- All SPAs call the API at `http://development.localhost:8000`
  and Socket.IO at `http://development.localhost:9010/development.localhost`
  (with `withCredentials: true`, namespace `/development.localhost`).

---

## Step 0 — One-time host prep: `/etc/hosts` (needs sudo)

Browsers must resolve `development.localhost` to localhost. This is the one
blocker that was never completed.

```bash
sudo sh -c 'echo "127.0.0.1 development.localhost" >> /etc/hosts'
getent hosts development.localhost   # should print: 127.0.0.1 development.localhost
```

> If you prefer not to touch `/etc/hosts`, the SPAs use `host: true`, so you
> can reach them from another device on the LAN at `http://<host-ip>:5173` —
> but the API/socket hostname still must resolve, so the hosts entry is the
> reliable path.

---

## Step 1 — Start the backend containers

```bash
make up          # docker compose -f .devcontainer/docker-compose.yml up -d
docker ps --format '{{.Names}}\t{{.Status}}'
```

Expect: `devcontainer-frappe-1`, `devcontainer-mariadb-1`, redis cache/queue.
(Your `docker ps` currently shows none of these — the stack is down.)

---

## Step 2 — First-time only: setup bench + site + app

Skip if `frappe-bench/sites/development.localhost` already exists.

```bash
make devcontainer-setup     # runs scripts/setup.sh inside the container
```

This creates the bench, site `development.localhost`, installs ERPNext v16 and
the `kibbutz_dining` app, and sets `developer_mode: 1` (required for Socket.IO
auth in dev).

If you changed DocTypes / modules.txt / hooks.py since last run:

```bash
docker exec -it $(docker compose -f .devcontainer/docker-compose.yml ps -q frappe) \
  bench --site development.localhost migrate
docker exec -it $(docker compose -f .devcontainer/docker-compose.yml ps -q frappe) \
  bench --site development.localhost clear-cache
```

---

## Step 3 — Start Frappe web + Socket.IO

Easiest (all processes, foreground):

```bash
make bench-start
# = docker exec <frappe> bench start   (web :8000, socketio :9000→9010, workers, scheduler)
```

Or run the two servers separately (two terminals):

```bash
# terminal A — web
docker exec -it <frappe> bash -lc 'cd /workspace/frappe-bench && bench serve --port 8000 --noreload'
# terminal B — socketio
docker exec -it <frappe> bash -lc 'cd /workspace/frappe-bench && bench socketio'
```

Verify backend before touching the UI:

```bash
curl -s http://development.localhost:8000/api/method/ping
# -> {"message":"pong"}
curl -s "http://development.localhost:8000/api/method/kibbutz_dining.pos.api.get_today_menu"
# -> JSON with message.items[] (daily menu for today)
```

If `get_today_menu` returns `null`/empty, there is no Daily Menu for today —
see Step 4.

---

## Step 4 — Load the sample system (dishes, diners, menus)

A complete sample system ships as CSVs in
`apps/kibbutz_dining/kibbutz_dining/sample_data/`, loaded by
`kibbutz_dining.sample_data`:

- `raw_items.csv` — 55 ingredients with ILS purchase prices
- `menu_items.csv` — 20 dishes with full recipes (per-portion quantities)
- `diners.csv` — 20 diners (14 חבר / 6 שכיר) with 4–5 digit badge IDs

Load / reset everything (idempotent; wipes previous demo + test records):

```bash
docker exec devcontainer-frappe-1 bash -lc 'cd /workspace/frappe-bench && \
  bench --site development.localhost execute \
  kibbutz_dining.sample_data.seed_sample_system'
# optional args: --kwargs "{'reset': 1, 'days_ahead': 2}"
```

This creates raw items + price history, dishes (costs auto-propagated),
diners, and published Lunch/Dinner menus for **today + 2 days**. Today's menus
include a sold-out main and a low-stock salad so the red/amber signage states
are visible.

Verify the invariants (20 dishes with cost > 0, 3-tier prices = ×1/×2/×3,
4–7 digit badges):

```bash
docker exec devcontainer-frappe-1 bash -lc 'cd /workspace/frappe-bench && \
  bench --site development.localhost execute \
  kibbutz_dining.sample_data.verify_sample_data'
# -> {"ok": true, "errors": [], "warnings": []}
```

Run a scripted demo (member/employee/guest checkout + one overdraft sale):

```bash
docker exec devcontainer-frappe-1 bash -lc 'cd /workspace/frappe-bench && \
  bench --site development.localhost execute \
  kibbutz_dining.sample_data.run_demo_checks'
```

> `run_demo_checks` mutates dish balances and creates sales. Re-run
> `seed_sample_system` afterwards to restore a pristine state.

### Sample dishes — cost per portion, prices in ₪

| Dish | Category | Food cost | Member ×1 | Employee ×2 | Guest ×3 |
|---|---|---|---|---|---|
| עוגת שוקולד | Dessert | 6.10 | 6.10 | 12.20 | 18.30 |
| פירות חתוכים | Dessert | 3.56 | 3.56 | 7.12 | 10.68 |
| חביתה | Main Course | 7.85 | 7.85 | 15.70 | 23.55 |
| חומוס עם פיתות | Main Course | 3.94 | 3.94 | 7.88 | 11.82 |
| לזניה | Main Course | 9.61 | 9.61 | 19.22 | 28.83 |
| סלמון בתנור | Main Course | 18.27 | 18.27 | 36.54 | 54.81 |
| עוף בתנור עם אורז | Main Course | 7.56 | 7.56 | 15.12 | 22.68 |
| פלאפל | Main Course | 4.84 | 4.84 | 9.68 | 14.52 |
| פסטה בולונז | Main Course | 8.88 | 8.88 | 17.76 | 26.64 |
| קציצות בקר ברוטב עגבניות | Main Course | 12.33 | 12.33 | 24.66 | 36.99 |
| שניצל עוף עם פירה | Main Course | 12.04 | 12.04 | 24.08 | 36.12 |
| שקשוקה | Main Course | 8.33 | 8.33 | 16.66 | 24.99 |
| סלט חצילים | Salad | 4.10 | 4.10 | 8.20 | 12.30 |
| סלט טונה | Salad | 6.32 | 6.32 | 12.64 | 18.96 |
| סלט ירקות | Salad | 3.15 | 3.15 | 6.30 | 9.45 |
| אורז לבן | Side Dish | 1.11 | 1.11 | 2.22 | 3.33 |
| סלט כרוב וגזר | Side Dish | 1.51 | 1.51 | 3.02 | 4.53 |
| פירה תפוחי אדמה | Side Dish | 2.18 | 2.18 | 4.36 | 6.54 |
| מרק עדשים | Soup | 2.22 | 2.22 | 4.44 | 6.66 |
| מרק עוף | Soup | 4.41 | 4.41 | 8.82 | 13.23 |

> Recipes are defined per single portion (`yield_portions = 1`), so
> `calculated_base_cost` is the cost of one dish. To replace with real recipes
> and prices, edit the CSVs and re-run the loader.

### Sample diners — badge ID → tier & Ma'ala mapping

| Badge | Name | Type | Tier | Ma'ala Budget ID | Cost Center |
|---|---|---|---|---|---|
| 20130 | ירדן רז | Member | ×1 | 1001 | חברים |
| 4211 | נועה כהן | Member | ×1 | 1002 | חברים |
| 20132 | איתי לוי | Member | ×1 | 1003 | חברים |
| 8530 | שירה מזרחי | Member | ×1 | 1004 | חברים |
| 20134 | עומר פרץ | Member | ×1 | 1005 | חברים |
| 20135 | מאיה בן דוד | Member | ×1 | 1006 | חברים |
| 7216 | רון אברהם | Member | ×1 | 1007 | חברים |
| 20137 | תמר שפירא | Member | ×1 | 1008 | חברים |
| 20138 | יובל אזולאי | Member | ×1 | 1009 | חברים |
| 4219 | הילה גולן | Member | ×1 | 1010 | חברים |
| 20140 | אסף דיין | Member | ×1 | 1011 | חברים |
| 20141 | ליאור ביטון | Member | ×1 | 1012 | חברים |
| 8220 | יעל רוזן | Member | ×1 | 1013 | חברים |
| 20143 | דניאל חדד | Member | ×1 | 1014 | חברים |
| 30100 | אבי מזרחי | Employee | ×2 | 9001 | חקלאות |
| 5101 | סיגל נחום | Employee | ×2 | 9002 | חינוך |
| 30102 | יוסי אלמוג | Employee | ×2 | 9003 | מוסך |
| 30103 | רותם ברק | Employee | ×2 | 9004 | מפעל |
| 6104 | חן אדרי | Employee | ×2 | 9005 | נוי |
| 30105 | עדי שמש | Employee | ×2 | 9006 | הנהלה |

Guest (אורח, ×3) is anonymous — use the "המשך כאורח" button in the POS (billed to general guest code 9999).

Manager accounts for the Admin portal:
- `manager1@dining.local` / `manager2@dining.local` — Dining Manager demo users (create them in the dev site and set dev passwords yourself)

---

## Step 5 — Start the three SPAs (host)

```bash
make pos-dev        # :5173  → http://localhost:5173
make signage-dev    # :5174  → http://localhost:5174
make web-dev        # :5175  → http://localhost:5175
make admin-dev      # :5176  → http://localhost:5176
```

(Each target runs `npm install && npm run dev`. Run them in separate terminals,
or background them.) Open each URL in a browser tab.

---

## Step 6 — Manual UI/UX walkthrough

### 6a. Public Web (`:5175`) — member view
- Header shows Hebrew date/time, shift (צהריים/ערב), and a connection dot.
- Each dish shows member/employee/guest prices, a status badge
  (זמין / מעט נשאר / אזל) and "נותרו N מנות מתוך M".
- Footer shows "עודכן לאחרונה: hh:mm:ss". Auto-refreshes menu every 30 s.

### 6b. Signage (`:5174`) — hall monitor
- High-contrast dish cards with a top status bar (green/amber/red).
- Sold-out dish shows the red "אזל מהמלאי" banner.
- Connection dot reflects live Socket.IO state.
- Auto-refreshes every 30 s as a fallback.

### 6c. POS (`:5173`) — tray checkout & offline resilience
1. **Network status & offline indicator**:
   - The POS header displays live connectivity (`🌐 מחובר`).
   - If network connectivity drops or the Frappe web server is unreachable, the POS automatically falls back to locally cached menus and diners, switching the banner to `⚠️ מצב לא מקוון`.
   - Offline checkouts complete optimistically (`💾 נשמר אופליין`) into a client queue (`pos_offline_sales_queue`).
   - Once reconnected, a "סנכרן כעת" button and auto-flusher replay all queued sales to the server with their original idempotency keys.
2. **Identify screen** ("הזדהות"):
   - Two tabs, **חברים** and **שכירים**, show live, searchable lists of active diners with tier badges (×1 / ×2). Tap any row to identify that diner.
   - Alternatively, type a badge into the **מספר זהות / מספר כרטיס** field and press Enter / "אישור".
   - **Double-scan guard**: Scanning or entering the same diner badge within 3 seconds alerts with a warning toast to prevent accidental duplicate rings.
   - Click "🧑‍💼 המשך כאורח" to continue as Guest (×3 pricing, mapped to general guest account 9999).
   - Badge not found → inline error message.
   - "📋 צפה בתפריט" loads the menu in view-only mode.
3. **Menu screen & soft-cap overdraft**:
   - Dish cards are colour-coded by status with prices shown for the identified tier.
   - **Soft-cap overdraft (Rule 1)**: Sold-out dishes (`balance_portions <= 0`) are clickable for **all** diners (Member, Employee, Guest). Checkouts never halt; overdraft dishes display a `חריגה` badge.
4. Click dishes to add to the cart; cart shows qty, line amount, removes with ✕, and a running total (₪).
5. Click "💰 תשלום" to check out. On success a green `✅ ₪total` flash appears; an overdraft sale additionally shows `⚠️ חריגת מנות`. Cart clears and menu reloads.
6. **Cashier shift close modal (Z-report)**:
   - Cashiers can tap the "🔒 סגירת משמרת" button in the header.
   - Displays current shift info and cashier name.
   - Cashier enters actual counted cash. The modal calculates cash variance (Actual vs Expected sales) in real time.
   - Cashier enters optional closing notes and submits to close the shift directly from the terminal.

### 6d. End-to-end realtime check (the money shot)
With a **Signage** or **Public Web** tab open next to the POS:
1. In POS, select any diner or continue as **Guest**.
2. Add a dish repeatedly until its balance reaches 0 and then negative (overdraft).
3. Checkout. Within ~1 s the signage/public-web card for that dish should turn
   **red / "אזל מהמלאי"** without a manual refresh — delivered over Socket.IO
   (`item_update` / `item_out_of_stock`, room `website`).

This is the same flow the headless test in Step 7 asserts.

### 6e. Manager Admin portal (`:5176`)
Open `http://localhost:5176` and log in with one of the manager accounts from Step 4.

The portal is RTL Hebrew and contains five tabs:
- **סועדים** — search, add, edit, and remove diners (badge, name, type חבר/שכיר/אורח, employee ID, active flag). Includes fields for **קוד תקציב במעלה** (`maala_member_id`) and **ענף/מחלקה לחיוב** (`cost_center`). Removal is hybrid: if the diner has sale history it is deactivated (hidden from the active list, history preserved); otherwise it is deleted permanently.
- **רכש** — raw ingredient list with category, supplier, current price and the date/price of the last purchase update. Update a purchase price per unit to insert a new `Raw Item Price History` row, which propagates to linked recipes and active daily menus (unless shift-locked). Ingredients can be added and removed with hybrid delete.
- **מתכונים** — create/edit `Menu Item` recipes with ingredient rows, **כמות מנות בתפוקת המתכון** (`yield_portions`) and **עלות אריזה וחומרי לוואי** (`packaging_cost`). Base cost is calculated as `(total_ingredient_cost / yield_portions) + packaging_cost`. Recipes can be removed with hybrid delete.
- **תפריט יומי** — create a daily menu for a date/shift, add dishes from recipes, set prepared portions, edit prepared portions and member/employee/guest prices per dish, publish, and remove menus. Manual price/portion edits persist until the next raw-ingredient price update re-applies the ×1/×2/×3 tier formula.
- **משמרות וייצוא (Shifts & Ma'ala Export)**:
  - **סקירת משמרות**: list shifts with date, shift type (בוקר/צהריים/ערב), cashier, cash variance, and sales totals broken down by Member / Employee / Guest.
  - **פעולות משמרת**: open new shifts and close active shifts with cash drawer counting and variance computation.
  - **בדיקת תקינות לפני ייצוא (Hash Totals Audit)**: runs automated pre-export audit checking for missing Ma'ala member budget IDs, zero amounts, and computes Hash Totals (סה"כ כספי, סה"כ רשומות).
  - **ייצוא לתוכנת "מעלה"**:
    - **ייצוא מעלה - מפורט**: generates Ma'ala CSV transaction batch with diner budget accounts, kibbutz dining branch (310), cost centers, and transaction codes (50 חיוב תקציב, 60 חיוב ענף, 10 אורחים).
    - **ייצוא מעלה - מרוכז**: generates aggregated journal batch grouped by member budget ID.
    - Also supports Inbar CSV and raw transaction CSV downloads.
  - **בקרת פחת ומטבח (Kitchen Reconciliation)**:
    - Dedicated end-of-shift table comparing prepared portions vs sold portions vs actual leftovers and waste entered by the kitchen team.
    - Computes portion variance and saves reconciliation directly to backend.

> In dev, both demo managers also have the `System Manager` role so the portal
> works before DocType permissions are fully tightened. For production, remove
> `System Manager` and rely only on the `Dining Manager` role.

---

## Step 7 — Headless E2E (optional, no browser)

Runs price propagation + overdraft + realtime assertion inside the container.

```bash
tests/e2e/run.sh
```

Prerequisites (already assumed by the script):
- Container `devcontainer-frappe-1` running.
- The `rtk` docker wrapper available on the host.
- `/tmp/socktest/node_modules` (socket.io-client) present in the container —
  the script copies it into `/tmp/e2e/node_modules`.

Expected tail: prices recomputed, sale flagged `was_overdraft_sale`, and the
socket listener log showing the expected `item_update` / `item_out_of_stock`
events. Last known result: **PASS** (commit `b3d4584`).

---

## Step 8 — Teardown

```bash
# stop SPAs: Ctrl-C in their terminals
make down       # stop the devcontainer stack
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Browser can't load `development.localhost` | Missing `/etc/hosts` entry — do Step 0. |
| SPAs show "טוען תפריט..." forever / network error | Frappe web not running → Step 3; check `curl .../ping`. |
| Menu loads but empty | No Daily Menu for today → Step 4. |
| Connection dot stays grey (disconnected) | Socket.IO not running on container `9000`→host `9010`, or `developer_mode` not set. Start `bench socketio`; run `bench --site development.localhost set-config developer_mode 1`. |
| Signage doesn't turn red after checkout | Socket not connected, or balance was not decremented to <= 0. |
| POS shows "מצב לא מקוון" | Frappe web server unreachable. POS operates using cached menu/diners; sales queue up locally in `pos_offline_sales_queue` and sync when server is restored. |
| `bench start` errors on ports | Something already holds 8000/9000 inside the container. |
| `get_today_menu` 500 / import error | App not synced into container. Re-copy: `rtk docker cp apps/kibbutz_dining/. devcontainer-frappe-1:/workspace/frappe-bench/apps/kibbutz_dining/` then `bench --site development.localhost migrate && clear-cache`. |

---

## Reference

- Backend APIs: `kibbutz_dining.pos.api.{get_today_menu,lookup_diner,list_diners,checkout}`,
  `kibbutz_dining.admin.api.*` (manager portal CRUD),
  `kibbutz_dining.finance.api.*` (shift reconciliation / exports).
- Vertical slice: `tests/e2e/vertical_slice.py`, `tests/e2e/socket_listener.mjs`.
