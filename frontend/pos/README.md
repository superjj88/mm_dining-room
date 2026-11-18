# Dining Hall POS (touchscreen)

React 18 + Vite SPA for the high-speed post-tray POS. Offline-resilient: caches the
daily menu and diner list in `localStorage`, queues offline sales, and syncs in the
background with UUIDv4 idempotency keys.

```bash
npm install
npm run dev    # http://localhost:5173
```

Requires the Frappe/ERPNext backend to be reachable at
`http://development.localhost:8000` (see the root README and `docs/RUNBOOK.md`).
