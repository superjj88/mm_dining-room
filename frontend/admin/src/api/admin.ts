import type {
  Diner,
  RawItem,
  MenuItem,
  DailyMenu,
  Session,
  Ingredient,
  Supplier,
  DeleteResult,
  Shift,
  ShiftReport,
  ExportValidation,
  KitchenReconciliationItem,
} from "../types";

const API_BASE = "/api/method";

async function postJSON(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?._server_messages
      ? JSON.parse(data._server_messages).map((m: string) => JSON.parse(m).message).join(" ")
      : data.exception || data.message || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  if (data.exception) throw new Error(data.exception);
  return data.message ?? data;
}

export async function login(usr: string, pwd: string): Promise<Session> {
  return postJSON("kibbutz_dining.admin.api.login", { usr, pwd }) as Promise<Session>;
}

export async function getSession(): Promise<Session> {
  return postJSON("kibbutz_dining.admin.api.get_session") as Promise<Session>;
}

export async function logout(): Promise<void> {
  await postJSON("kibbutz_dining.admin.api.logout");
}

export async function listDiners(): Promise<Diner[]> {
  return postJSON("kibbutz_dining.admin.api.list_diners") as Promise<Diner[]>;
}

export async function createDiner(params: {
  badge_id: string;
  diner_name: string;
  diner_type: string;
  employee_id?: string;
  is_active?: number;
}): Promise<Diner> {
  return postJSON("kibbutz_dining.admin.api.create_diner", params) as Promise<Diner>;
}

export async function updateDiner(
  name: string,
  params: Partial<Omit<Diner, "name" | "tier_multiplier">>
): Promise<Diner> {
  return postJSON("kibbutz_dining.admin.api.update_diner", { name, ...params }) as Promise<Diner>;
}

export async function deleteDiner(name: string): Promise<DeleteResult> {
  return postJSON("kibbutz_dining.admin.api.delete_diner", { name }) as Promise<DeleteResult>;
}

export async function listRawItems(): Promise<RawItem[]> {
  return postJSON("kibbutz_dining.admin.api.list_raw_items") as Promise<RawItem[]>;
}

export async function listSuppliers(): Promise<Supplier[]> {
  return postJSON("kibbutz_dining.admin.api.list_suppliers") as Promise<Supplier[]>;
}

export async function updateRawRate(raw_item: string, rate_per_uom: number, note = ""): Promise<unknown> {
  return postJSON("kibbutz_dining.admin.api.update_raw_rate", { raw_item, rate_per_uom, note });
}

export async function createRawItem(params: {
  item_name: string;
  uom: string;
  current_rate?: number;
  category?: string;
  supplier?: string;
}): Promise<RawItem> {
  return postJSON("kibbutz_dining.admin.api.create_raw_item", params) as Promise<RawItem>;
}

export async function updateRawItem(
  name: string,
  params: Partial<{ supplier: string; category: string; is_active: 0 | 1; uom: string }>
): Promise<RawItem> {
  return postJSON("kibbutz_dining.admin.api.update_raw_item", { name, ...params }) as Promise<RawItem>;
}

export async function deleteRawItem(name: string): Promise<DeleteResult> {
  return postJSON("kibbutz_dining.admin.api.delete_raw_item", { name }) as Promise<DeleteResult>;
}

export async function listMenuItems(): Promise<MenuItem[]> {
  return postJSON("kibbutz_dining.admin.api.list_menu_items") as Promise<MenuItem[]>;
}

export async function createMenuItem(params: {
  dish_name: string;
  is_active?: number;
  ingredients: Ingredient[];
  category?: string;
  yield_portions?: number;
  packaging_cost?: number;
}): Promise<MenuItem> {
  return postJSON("kibbutz_dining.admin.api.create_menu_item", params) as Promise<MenuItem>;
}

export async function updateMenuItem(
  name: string,
  params: Partial<{
    dish_name: string;
    is_active: number;
    ingredients: Ingredient[];
    category: string;
    yield_portions: number;
    packaging_cost: number;
  }>
): Promise<MenuItem> {
  return postJSON("kibbutz_dining.admin.api.update_menu_item", { name, ...params }) as Promise<MenuItem>;
}

export async function deleteMenuItem(name: string): Promise<DeleteResult> {
  return postJSON("kibbutz_dining.admin.api.delete_menu_item", { name }) as Promise<DeleteResult>;
}

export async function listDailyMenus(): Promise<DailyMenu[]> {
  return postJSON("kibbutz_dining.admin.api.list_daily_menus") as Promise<DailyMenu[]>;
}

export async function getDailyMenu(name: string): Promise<DailyMenu> {
  return postJSON("kibbutz_dining.admin.api.get_daily_menu", { name }) as Promise<DailyMenu>;
}

export async function createDailyMenu(menu_date: string, shift: string): Promise<DailyMenu> {
  return postJSON("kibbutz_dining.admin.api.create_daily_menu", { menu_date, shift }) as Promise<DailyMenu>;
}

export async function addDailyMenuItem(
  parent: string,
  dish: string,
  prepared_portions: number,
  sort_order = 0
): Promise<DailyMenu> {
  return postJSON("kibbutz_dining.admin.api.add_daily_menu_item", {
    parent,
    dish,
    prepared_portions,
    sort_order,
  }) as Promise<DailyMenu>;
}

export async function removeDailyMenuItem(parent: string, item_name: string): Promise<DailyMenu> {
  return postJSON("kibbutz_dining.admin.api.remove_daily_menu_item", { parent, item_name }) as Promise<DailyMenu>;
}

export async function updateDailyMenuItem(
  parent: string,
  item_name: string,
  params: Partial<{
    prepared_portions: number;
    member_price: number;
    employee_price: number;
    guest_price: number;
  }>
): Promise<DailyMenu> {
  return postJSON("kibbutz_dining.admin.api.update_daily_menu_item", {
    parent,
    item_name,
    ...params,
  }) as Promise<DailyMenu>;
}

export async function publishDailyMenu(name: string): Promise<{ name: string; status: string }> {
  return postJSON("kibbutz_dining.admin.api.publish_daily_menu", { name }) as Promise<{ name: string; status: string }>;
}

export async function deleteDailyMenu(name: string): Promise<DeleteResult> {
  return postJSON("kibbutz_dining.admin.api.delete_daily_menu", { name }) as Promise<DeleteResult>;
}

export async function listShifts(limit = 50): Promise<Shift[]> {
  return postJSON("kibbutz_dining.admin.api.list_shifts", { limit }) as Promise<Shift[]>;
}

export async function getShiftReport(shift: string): Promise<ShiftReport> {
  return postJSON("kibbutz_dining.admin.api.get_shift_report", { shift }) as Promise<ShiftReport>;
}

export async function validateShiftExport(shift: string): Promise<ExportValidation> {
  return postJSON("kibbutz_dining.admin.api.validate_shift_export", { shift }) as Promise<ExportValidation>;
}

export async function exportShift(shift: string, format = "maala"): Promise<{ filename: string; content: string; mimetype: string }> {
  return postJSON("kibbutz_dining.admin.api.export_shift", { shift, format }) as Promise<{ filename: string; content: string; mimetype: string }>;
}

export async function openShift(shift_date?: string, shift_type = "Lunch", opening_cash = 0): Promise<{ shift: string; status: string; created: boolean }> {
  return postJSON("kibbutz_dining.admin.api.open_shift", { shift_date, shift_type, opening_cash }) as Promise<{ shift: string; status: string; created: boolean }>;
}

export async function closeShift(shift: string, closing_cash = 0, notes = ""): Promise<unknown> {
  return postJSON("kibbutz_dining.admin.api.close_shift", { shift, closing_cash, notes });
}

export async function saveKitchenReconciliation(shift: string, items: KitchenReconciliationItem[]): Promise<{ ok: boolean; shift: string }> {
  return postJSON("kibbutz_dining.admin.api.save_kitchen_reconciliation", { shift, items: JSON.stringify(items) }) as Promise<{ ok: boolean; shift: string }>;
}

