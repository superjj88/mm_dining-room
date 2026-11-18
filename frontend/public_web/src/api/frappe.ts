import type { DailyMenu } from "../types";

const API_BASE = "http://development.localhost:8000/api/method";

async function fetchJSON(method: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/${method}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.exception) throw new Error(data.exception);
  return (data as { message: unknown }).message ?? data;
}

export async function getTodayMenu(): Promise<DailyMenu | null> {
  try {
    return await fetchJSON("kibbutz_dining.pos.api.get_today_menu") as DailyMenu;
  } catch {
    return null;
  }
}
