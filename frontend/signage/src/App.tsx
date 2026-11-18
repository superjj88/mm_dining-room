import { useState, useCallback, useEffect } from "react";
import { useSignageSocket } from "./hooks/useSocket";
import { getTodayMenu } from "./api/frappe";
import type { DailyMenu, DailyMenuItem, RealtimeItemUpdate } from "./types";

function formatILS(n: number) {
  return `₪${n.toFixed(0)}`;
}

function DishCard({ item }: { item: DailyMenuItem }) {
  const isSoldOut = item.balance_portions <= 0;
  const isLow = item.status === "Low Stock" || (item.balance_portions > 0 && item.balance_portions <= (item.prepared_portions * 0.2));

  const cardClass = isSoldOut ? "sold-out" : isLow ? "low-stock" : "available";
  const balanceClass = item.balance_portions <= 0 ? "zero" : isLow ? "low" : "positive";

  return (
    <div className={`dish-card ${cardClass}`}>
      <div className="dish-status-bar" />
      <div className="dish-name">{item.dish}</div>
      {isSoldOut && (
        <div className="sold-out-banner">אזל מהמלאי</div>
      )}
      <div className="prices">
        <div className="price price-member">
          <span className="price-label">חבר</span>
          <span className="price-value">{formatILS(item.member_price)}</span>
        </div>
        <div className="price price-employee">
          <span className="price-label">עובד</span>
          <span className="price-value">{formatILS(item.employee_price)}</span>
        </div>
        <div className="price price-guest">
          <span className="price-label">אורח</span>
          <span className="price-value">{formatILS(item.guest_price)}</span>
        </div>
      </div>
      <div className="balance-indicator">
        <span className={`balance-num ${balanceClass}`}>{item.balance_portions}</span>
        <span>מנות נשארו</span>
      </div>
    </div>
  );
}

export default function App() {
  const [menu, setMenu] = useState<DailyMenu | null>(null);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleRealtime = useCallback((update: RealtimeItemUpdate) => {
    setMenu((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((item) =>
          item.name === update.daily_menu_item
            ? { ...item, balance_portions: update.balance_portions, status: update.status as DailyMenuItem["status"] }
            : item
        ),
      };
    });
  }, []);

  const socketRef = useSignageSocket(handleRealtime);

  useEffect(() => {
    if (socketRef.current) {
      socketRef.current.on("connect", () => setConnected(true));
      socketRef.current.on("disconnect", () => setConnected(false));
    }
  }, [socketRef]);

  const loadMenu = useCallback(async () => {
    const m = await getTodayMenu();
    setMenu(m);
    setLoaded(true);
  }, []);

  useEffect(() => {
    loadMenu();
    const interval = setInterval(loadMenu, 30_000);
    return () => clearInterval(interval);
  }, [loadMenu]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="signage-root">
      <header className="signage-header">
        <h1>🍽️ תפריט חדר אוכל</h1>
        <div className="header-meta">
          <span>{dateStr}</span>
          <span>{timeStr}</span>
          <span>{menu?.shift || "—"}</span>
          <div className={`connection-dot ${connected ? "connected" : "disconnected"}`} title={connected ? "מחובר" : "מנותק"} />
        </div>
      </header>

      {!loaded ? (
        <div className="empty-state">
          <div>טוען תפריט...</div>
        </div>
      ) : !menu || menu.items.length === 0 ? (
        <div className="empty-state">
          <div>📋 אין תפריט זמין כרגע</div>
        </div>
      ) : (
        <div className="menu-grid">
          {menu.items
            .slice()
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            .map((item) => (
              <DishCard key={item.name} item={item} />
            ))}
        </div>
      )}
    </div>
  );
}
