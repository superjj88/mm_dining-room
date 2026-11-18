import { useState, useCallback, useEffect } from "react";
import { usePublicWebSocket } from "./hooks/useSocket";
import { getTodayMenu } from "./api/frappe";
import type { DailyMenu, DailyMenuItem, RealtimeItemUpdate } from "./types";

function formatILS(n: number) {
  return `₪${n.toFixed(0)}`;
}

function StatusBadge({ item }: { item: DailyMenuItem }) {
  if (item.balance_portions <= 0) {
    return <span className="badge sold-out">אזל</span>;
  }
  if (item.status === "Low Stock" || item.balance_portions <= item.prepared_portions * 0.2) {
    return <span className="badge low">מעט נשאר</span>;
  }
  return <span className="badge available">זמין</span>;
}

function DishRow({ item }: { item: DailyMenuItem }) {
  const isSoldOut = item.balance_portions <= 0;

  return (
    <li className={`dish-row ${isSoldOut ? "sold-out" : ""}`}>
      <div className="dish-main">
        <div className="dish-title-line">
          <h3 className="dish-name">{item.dish}</h3>
          <StatusBadge item={item} />
        </div>

        {isSoldOut && (
          <div className="sold-out-banner">אזל מהמלאי</div>
        )}

        <div className="prices">
          <div className="price price-primary">
            <span className="price-label">חבר</span>
            <span className="price-value">{formatILS(item.member_price)}</span>
          </div>
          <div className="price price-secondary">
            <span className="price-label">עובד</span>
            <span className="price-value">{formatILS(item.employee_price)}</span>
          </div>
          <div className="price price-secondary">
            <span className="price-label">אורח</span>
            <span className="price-value">{formatILS(item.guest_price)}</span>
          </div>
        </div>

        <div className="balance-line">
          <span>נותרו {item.balance_portions} מנות מתוך {item.prepared_portions}</span>
        </div>
      </div>
    </li>
  );
}

export default function App() {
  const [menu, setMenu] = useState<DailyMenu | null>(null);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

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
    setLastUpdate(new Date());
  }, []);

  const socketRef = usePublicWebSocket(handleRealtime);

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
    setLastUpdate(new Date());
  }, []);

  useEffect(() => {
    loadMenu();
    const interval = setInterval(loadMenu, 30_000);
    return () => clearInterval(interval);
  }, [loadMenu]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  const updateStr = lastUpdate
    ? lastUpdate.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

  return (
    <div className="portal-root">
      <header className="portal-header">
        <div className="header-title">
          <h1>תפריט חדר אוכל</h1>
          <span className="header-subtitle">לצפיית חברים מהבית</span>
        </div>
        <div className="header-meta">
          <span>{dateStr}</span>
          <span>{timeStr}</span>
          <span className="shift">{menu?.shift === "Lunch" ? "צהריים" : menu?.shift === "Dinner" ? "ערב" : "—"}</span>
          <div className={`connection-dot ${connected ? "connected" : "disconnected"}`} title={connected ? "מחובר" : "מנותק"} />
        </div>
      </header>

      {!loaded ? (
        <div className="empty-state">טוען תפריט...</div>
      ) : !menu || menu.items.length === 0 ? (
        <div className="empty-state">אין תפריט זמין כרגע</div>
      ) : (
        <>
          <ul className="dish-list">
            {menu.items
              .slice()
              .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
              .map((item) => (
                <DishRow key={item.name} item={item} />
              ))}
          </ul>
          {updateStr && (
            <div className="update-footer">עודכן לאחרונה: {updateStr}</div>
          )}
        </>
      )}
    </div>
  );
}
