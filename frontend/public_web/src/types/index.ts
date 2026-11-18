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

export interface RealtimeItemUpdate {
  daily_menu_item: string;
  balance_portions: number;
  status: string;
}
