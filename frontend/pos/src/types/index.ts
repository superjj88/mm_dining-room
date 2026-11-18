export interface DinerType {
  name: string;
  badge_id: string;
  diner_name: string;
  diner_type: "Member" | "Employee" | "Guest";
  tier_multiplier: number;
  is_active?: 0 | 1;
}

export type DinerListItem = DinerType;

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
  status: "Available" | "Low Stock" | "Sold Out / Overdraft";
  sort_order: number;
}

export interface DailyMenu {
  name: string;
  menu_date: string;
  shift: "Lunch" | "Dinner";
  status: "Draft" | "Published" | "Closed";
  items: DailyMenuItem[];
}

export interface CartItem {
  daily_menu_item: string;
  dish_name: string;
  qty: number;
  unit_price: number;
  amount: number;
}

export interface CheckoutResult {
  sale: string;
  diner_type: string;
  diner_name: string;
  total_amount: number;
  was_overdraft_sale: boolean;
  items: { dish: string; qty: number; amount: number }[];
  status: "completed" | "duplicate" | "queued_offline";
}

export interface QueuedSale {
  idempotency_key: string;
  badge_id: string;
  identification_method: string;
  items: CartItem[];
  created_at: string;
  total_amount: number;
  diner_name: string;
  diner_type: string;
}

export interface RealtimeItemUpdate {
  daily_menu_item: string;
  balance_portions: number;
  status: string;
}

export interface ShiftInfo {
  name: string;
  shift_date: string;
  shift_type: "Lunch" | "Dinner";
  status: "Open" | "Closed";
  opening_cash?: number;
  closing_cash?: number;
  cash_variance?: number;
  total_sales?: number;
  total_transactions?: number;
}

