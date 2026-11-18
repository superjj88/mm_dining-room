import type { DailyMenu, CartItem, CheckoutResult, DinerType, QueuedSale, ShiftInfo } from "../types";

const API_BASE = "http://development.localhost:8000/api/method";
const QUEUE_STORAGE_KEY = "pos_offline_sales_queue";
const MENU_STORAGE_KEY = "pos_cached_today_menu";
const DINERS_STORAGE_KEY = "pos_cached_diners";

async function fetchJSON(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const url = new URL(`${API_BASE}/${method}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString(), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.exception) throw new Error(data.exception);
  return (data as { message: unknown }).message ?? data;
}

// ─────────────────────────────────────────────────────────────
// Offline Queue Management
// ─────────────────────────────────────────────────────────────

export function getOfflineQueue(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveOfflineQueue(queue: QueuedSale[]): void {
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

export function enqueueOfflineSale(sale: QueuedSale): void {
  const queue = getOfflineQueue();
  queue.push(sale);
  saveOfflineQueue(queue);
}

export function removeOfflineSale(idempotencyKey: string): void {
  const queue = getOfflineQueue().filter((q) => q.idempotency_key !== idempotencyKey);
  saveOfflineQueue(queue);
}

export async function flushOfflineQueue(): Promise<{ synced: number; remaining: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };

  let synced = 0;
  for (const item of [...queue]) {
    try {
      await fetchJSON("kibbutz_dining.pos.api.checkout", {
        idempotency_key: item.idempotency_key,
        badge_id: item.badge_id,
        identification_method: item.identification_method,
        items: JSON.stringify(item.items),
      });
      removeOfflineSale(item.idempotency_key);
      synced++;
    } catch {
      // If server connection is still down, stop draining this cycle
      break;
    }
  }
  return { synced, remaining: getOfflineQueue().length };
}

// ─────────────────────────────────────────────────────────────
// POS Operations (with Cache Fallbacks)
// ─────────────────────────────────────────────────────────────

export async function lookupDiner(badgeId: string): Promise<DinerType | null> {
  try {
    const res = (await fetchJSON("kibbutz_dining.pos.api.lookup_diner", { badge_id: badgeId })) as DinerType;
    if (res) return res;
  } catch {
    // Network down: fallback to cached diners
  }

  try {
    const cachedDiners: DinerType[] = JSON.parse(localStorage.getItem(DINERS_STORAGE_KEY) || "[]");
    const found = cachedDiners.find((d) => d.badge_id === badgeId);
    if (found) return found;
  } catch {
    // ignore
  }
  return null;
}

export async function listDiners(search?: string, dinerType?: string): Promise<DinerType[]> {
  try {
    const data = (await fetchJSON("kibbutz_dining.pos.api.list_diners", {
      search,
      diner_type: dinerType,
    })) as DinerType[];
    if (data && data.length > 0 && !search) {
      localStorage.setItem(DINERS_STORAGE_KEY, JSON.stringify(data));
    }
    return data;
  } catch {
    // Fallback to offline cached diners
    try {
      let cached: DinerType[] = JSON.parse(localStorage.getItem(DINERS_STORAGE_KEY) || "[]");
      if (dinerType) cached = cached.filter((d) => d.diner_type === dinerType);
      if (search) {
        const q = search.toLowerCase();
        cached = cached.filter((d) => d.diner_name.toLowerCase().includes(q) || d.badge_id.includes(q));
      }
      return cached;
    } catch {
      return [];
    }
  }
}

export async function getTodayMenu(): Promise<DailyMenu | null> {
  try {
    const data = (await fetchJSON("kibbutz_dining.pos.api.get_today_menu")) as DailyMenu;
    if (data && data.items) {
      localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(data));
    }
    return data;
  } catch {
    // Fallback to offline cached menu
    try {
      return JSON.parse(localStorage.getItem(MENU_STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }
}

export async function checkout(
  idempotencyKey: string,
  badgeId: string,
  identificationMethod: string,
  items: CartItem[],
  dinerMeta?: { diner_name?: string; diner_type?: string }
): Promise<CheckoutResult> {
  try {
    return (await fetchJSON("kibbutz_dining.pos.api.checkout", {
      idempotency_key: idempotencyKey,
      badge_id: badgeId,
      identification_method: identificationMethod,
      items: JSON.stringify(items),
    })) as CheckoutResult;
  } catch (err: unknown) {
    const isNetworkError =
      !navigator.onLine ||
      (err instanceof Error &&
        (err.message.includes("Failed to fetch") ||
          err.message.includes("NetworkError") ||
          err.message.includes("Load failed") ||
          err.message.includes("Network error")));

    if (isNetworkError) {
      const dName = dinerMeta?.diner_name || (identificationMethod === "Guest" ? "אורח" : badgeId);
      const dType = dinerMeta?.diner_type || (identificationMethod === "Guest" ? "Guest" : "Member");
      const totalAmount = items.reduce((s, it) => s + it.amount, 0);

      const queuedSale: QueuedSale = {
        idempotency_key: idempotencyKey,
        badge_id: badgeId,
        identification_method: identificationMethod,
        items,
        created_at: new Date().toISOString(),
        total_amount: totalAmount,
        diner_name: dName,
        diner_type: dType,
      };
      enqueueOfflineSale(queuedSale);

      return {
        sale: `OFFLINE-${Date.now().toString().slice(-6)}`,
        diner_type: dType,
        diner_name: dName,
        total_amount: totalAmount,
        was_overdraft_sale: false,
        items: items.map((it) => ({ dish: it.dish_name, qty: it.qty, amount: it.amount })),
        status: "queued_offline",
      };
    }
    throw err;
  }
}

export async function getCurrentShift(): Promise<ShiftInfo | null> {
  try {
    return (await fetchJSON("kibbutz_dining.finance.api.get_current_shift")) as ShiftInfo;
  } catch {
    return null;
  }
}

export async function closeShift(shift: string, closingCash: number, notes = ""): Promise<unknown> {
  return fetchJSON("kibbutz_dining.finance.api.close_shift", {
    shift,
    closing_cash: closingCash,
    notes,
  });
}

export async function login(user: string, password: string): Promise<void> {
  const res = await fetch("http://development.localhost:8000/api/method/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usr: user, pwd: password }),
  });
  if (!res.ok) throw new Error("Login failed");
}

export async function getSession(): Promise<{ user: string } | null> {
  try {
    const r = await fetch("http://development.localhost:8000/api/method/frappe.auth.get_logged_user", {
      credentials: "include",
    });
    const d = await r.json();
    return { user: (d.message as string) || "" };
  } catch {
    return null;
  }
}
