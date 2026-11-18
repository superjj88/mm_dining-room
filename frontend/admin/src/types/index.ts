export type DinerTypeValue = "Member" | "Employee" | "Guest";

export interface Diner {
  name: string;
  badge_id: string;
  diner_name: string;
  diner_type: DinerTypeValue;
  employee_id?: string;
  maala_member_id?: string;
  cost_center?: string;
  billing_notes?: string;
  is_active: 0 | 1;
  tier_multiplier: number;
}

export interface RawItem {
  name: string;
  item_name: string;
  uom: string;
  current_rate: number;
  category?: string;
  supplier?: string | null;
  supplier_name?: string | null;
  is_active?: 0 | 1;
  last_price_update?: string | null;
  last_rate?: number | null;
}

export interface Ingredient {
  raw_item_name: string;
  raw_item_label?: string;
  qty: number;
  uom?: string;
  wastage_percent: number;
  cost?: number;
}

export interface MenuItem {
  name: string;
  dish_name: string;
  is_active: 0 | 1;
  calculated_base_cost: number;
  category?: string;
  yield_portions?: number;
  packaging_cost?: number;
  ingredients: Ingredient[];
  last_cost_update?: string | null;
}

export interface DailyMenuItem {
  name: string;
  dish: string;
  calculated_base_cost: number;
  member_price: number;
  employee_price: number;
  guest_price: number;
  prepared_portions: number;
  sold_portions: number;
  balance_portions: number;
  status: string;
  sort_order: number;
}

export interface DailyMenu {
  name: string;
  menu_date: string;
  shift: "Lunch" | "Dinner";
  status: "Draft" | "Published" | "Closed";
  items: DailyMenuItem[];
  item_count?: number;
}

export interface Supplier {
  name: string;
  supplier_name: string;
  supplier_group?: string;
}

export interface Shift {
  name: string;
  shift_date: string;
  shift_type: "Lunch" | "Dinner";
  status: "Open" | "Closed";
  opened_at?: string;
  closed_at?: string;
  opening_cash?: number;
  closing_cash?: number;
  cash_variance?: number;
  total_sales?: number;
  total_transactions?: number;
  overdraft_sales?: number;
  variance_report?: string;
  notes?: string;
}

export interface ShiftSaleLine {
  sale_id: string;
  timestamp: string;
  diner_type: string;
  badge_id?: string;
  maala_member_id?: string;
  cost_center?: string;
  diner_name?: string;
  payment_method: string;
  identification_method?: string;
  dish_name: string;
  qty: number;
  unit_price: number;
  amount: number;
  was_overdraft: number;
}

export interface ExportHashTotals {
  total_transactions: number;
  total_items: number;
  total_amount: number;
  member_amount: number;
  employee_amount: number;
  guest_amount: number;
  cash_amount: number;
  credit_amount: number;
  missing_ids_count: number;
}

export interface ExportValidation {
  valid: boolean;
  shift: string;
  errors: string[];
  warnings: string[];
  hash_totals: ExportHashTotals;
  missing_maala_diners: string[];
}

export interface ShiftReport {
  shift: string;
  shift_date: string;
  shift_type: "Lunch" | "Dinner";
  status: "Open" | "Closed";
  opened_at?: string | null;
  closed_at?: string | null;
  opening_cash?: number;
  closing_cash?: number;
  expected_cash?: number;
  cash_variance?: number;
  sales_summary: {
    total_transactions: number;
    total_sales: number;
    overdraft_sales: number;
    refund_total: number;
  };
  item_variance: {
    daily_menu_item: string;
    dish: string;
    prepared_portions: number;
    sold_portions: number;
    balance_portions: number;
    negative_overrun: number;
    status: string;
    revenue_ils: number;
    member_price: number;
    employee_price: number;
    guest_price: number;
  }[];
}

export interface KitchenReconciliationItem {
  dish: string;
  dish_name: string;
  prepared_portions: number;
  sold_portions: number;
  leftover_portions: number;
  waste_portions: number;
  variance_portions: number;
}

export interface DeleteResult {
  deleted: boolean;
  deactivated: boolean;
  name: string;
}

export interface Session {
  user: string;
  roles: string[];
}
