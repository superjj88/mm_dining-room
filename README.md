# Kibbutz Dining Hall Management Platform

Integrated replacement for legacy "One" (Kupa + Tafrit) POS and Menu systems.
Built on ERPNext v16 / Frappe v16 + custom React SPAs.

## Stack

- **Backend:** ERPNext v16, Frappe v16, MariaDB 10.11, Redis
- **Frontend:** React 18 + Vite (POS, Signage, Public Web, Manager Admin Portal)
- **Design system:** shared light theme + Heebo (`frontend/shared/design/`), desktop-first, Public Web responsive
- **Deployment:** Docker / Docker Compose (frappe_docker)
- **Real-time:** frappe.realtime (Socket.IO)

## Quick Start

### 1. Start dev services

```bash
make up          # starts MariaDB, Redis, frappe/bench container
```

> The devcontainer compose file (`.devcontainer/docker-compose.yml` — MariaDB + Redis + a
> Frappe bench container) is environment-specific and not part of this repo. Any
> frappe_docker-style dev stack works with `scripts/setup.sh` and the Makefile targets.

### 2. Setup bench + ERPNext + custom app

```bash
make devcontainer-setup
```

This runs `scripts/setup.sh` inside the frappe container:
- `bench init --frappe-branch version-16 frappe-bench`
- Creates `development.localhost` site
- Installs ERPNext v16
- Installs `kibbutz_dining` custom app

### 3. Start bench

```bash
make bench-start
# or: docker exec <container> bench start
```

Access: http://development.localhost:8000
Login: `Administrator` / `admin` (or as set by ADMIN_PASSWORD env)

### 4. Dev frontends (from host)

```bash
make pos-dev      # POS SPA on :5173
make signage-dev  # Signage SPA on :5174
make web-dev      # Public web on :5175
make admin-dev    # Manager Admin Portal on :5176
```

Manager portal demo users: `manager1@dining.local` / `manager2@dining.local` (created in the dev database; set dev passwords when creating them)

### 5. Load the sample system (optional, for a full demo)

```bash
docker exec devcontainer-frappe-1 bash -lc \
  "cd /workspace/frappe-bench && \
   bench --site development.localhost execute kibbutz_dining.sample_data.seed_sample_system && \
   bench --site development.localhost execute kibbutz_dining.sample_data.verify_sample_data"
```

Seeds 55 raw ingredients + 5 suppliers, 20 dishes with recipes and costs,
20 diners (14 Member / 6 Employee, 4–5 digit badges) and 6 published daily menus.
Sample data lives in editable CSVs under `apps/kibbutz_dining/kibbutz_dining/sample_data/`.
Daily menus are date-relative, so re-seed whenever "today" has moved.

## Project Structure

```
kibbutz-dining/
├── README.md
├── apps/
│   └── kibbutz_dining/     # Custom Frappe app
├── docs/                   # RUNBOOK.md
├── frontend/
│   ├── pos/               # Touchscreen POS React SPA (offline-resilient)
│   ├── signage/           # Public display React SPA
│   ├── public_web/        # Member web portal (responsive / mobile-friendly)
│   ├── admin/             # Manager Admin Portal (סועדים / רכש / מתכונים / תפריט יומי / משמרות וייצוא)
│   └── shared/            # Shared design tokens + base CSS (imported by all SPAs)
├── scripts/
│   └── setup.sh           # Container init script
└── Makefile
```

## Dev workflow

1. Edit custom app files in `apps/kibbutz_dining/` (mounted into container)
2. Sync changed modules to the container (`rtk docker cp`, trailing `/.`) — the dev web server runs `--noreload`
3. Run `bench --site development.localhost clear-cache` after DocType/hook/Python changes
4. Restart services with `make down && make up` for full reset

## Phase Roadmap

- [x] Phase 0: Infrastructure & Scaffolding
- [x] Phase 1: Procurement, Historical Costing & BOM Engine
- [x] Phase 2: Daily Menu & 3-Tier Multiplier Pricing
- [x] Phase 3: High-Speed Post-Tray POS
- [x] Phase 4: Public Signage & Web Portal
- [x] Phase 5: Financials, Invoicing & Billing (Ma'ala integration engine)
- [x] Phase 6: Pilot, Testing & Rollout

## Current Status

All six phases implemented and committed, plus the POS diner lists, the Manager
Admin Portal (5 tabs), a complete sample dataset, a full UI/design pass, and
reliability & accuracy improvements:

**Verified end-to-end:**
- 3-tier pricing (Member ×1 / Employee ×2 / Guest ×3) computed server-side
- Soft-cap overdraft: sales to negative balance never block for any diner tier, `was_overdraft_sale` flagged
- Real-time signage via Socket.IO (`item_update` / `item_out_of_stock`, room `website`)
- Shift open/close reconciliation, cash drawer variance report, cashier Z-report modal
- **Ma'ala ("מעלה") Integration Engine**:
  - Member budget account mapping (`maala_member_id`) and employee cost centers (`cost_center`)
  - Detailed transaction export (`_to_maala`) and aggregated journal batch (`_to_maala_summary`)
  - Automated pre-export audit validation checking missing IDs and calculating Hash Totals
  - 5th tab in Manager Admin Portal (`משמרות וייצוא`) for shift management and direct downloads
- **Recipe Accuracy & Cost Integrity**:
  - Yield portioning (`yield_portions`) and packaging/overhead costs (`packaging_cost`)
  - Shift-locked pricing invariant: commodity price changes freeze for open shifts with sales
  - Kitchen waste reconciliation logging actual leftover portions against prepared inventory
- **POS Offline-First Resilience**:
  - Local caching of daily menu and diners in `localStorage`
  - Offline sales queue with automatic background sync and UUIDv4 idempotency keys
  - Double-scan guard (<3s lock on duplicate badge)
- Vertical slice test (`tests/e2e/`): price update → POS ring-to-negative → public screen turns red — PASS
- Manager Admin Portal (`:5176`): diner / ingredient / recipe / daily-menu / shift & export management
- Sample system seeded and verified: 55 ingredients, 5 suppliers, 20 dishes, 20 diners, 6 daily menus
- All four SPAs build clean (`tsc` + `vite build`) and pass visual checks at 1920×1080

**Known gaps:**
- Real pilot data (users, recipes, prices) to be supplied by the client — swap `sample_data/*.csv`
- Pre-Phase-5 sales have `shift_ref=NULL`; `tests/e2e/vertical_slice.py` dirties the DB
  (use `sample_data.run_demo_checks` on seeded data instead)
