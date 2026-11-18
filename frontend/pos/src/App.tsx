import { useState, useCallback, useRef, useEffect } from "react";
import { useRealtime, useKeyboardRFID } from "./hooks/useSocket";
import {
  getTodayMenu,
  lookupDiner,
  listDiners,
  checkout,
  getOfflineQueue,
  flushOfflineQueue,
  getCurrentShift,
  closeShift,
} from "./api/frappe";
import type {
  DailyMenu,
  DailyMenuItem,
  CartItem,
  DinerType,
  CheckoutResult,
  RealtimeItemUpdate,
  ShiftInfo,
} from "./types";

const TIER_LABELS: Record<string, string> = {
  Member: "חבר",
  Employee: "שכיר",
  Guest: "אורח",
};

const STATUS_COLORS: Record<string, string> = {
  Available: "#22c55e",
  "Low Stock": "#f59e0b",
  "Sold Out / Overdraft": "#ef4444",
};

function formatILS(n: number) {
  return `₪${n.toFixed(2)}`;
}

function generateIdemKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function App() {
  const [menu, setMenu] = useState<DailyMenu | null>(null);
  const [diner, setDiner] = useState<DinerType | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<CheckoutResult | null>(null);
  const [badgeInput, setBadgeInput] = useState("");
  const [guestMode, setGuestMode] = useState(false);
  const idemKeyRef = useRef(generateIdemKey());

  // Double-scan prevention ref
  const lastScanRef = useRef<{ badge: string; time: number }>({ badge: "", time: 0 });

  // Offline queue & online status
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueueCount, setOfflineQueueCount] = useState(getOfflineQueue().length);
  const [syncingQueue, setSyncingQueue] = useState(false);

  // Shift & Cashier Z-Report Modal
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [currentShift, setCurrentShift] = useState<ShiftInfo | null>(null);
  const [countedCash, setCountedCash] = useState<number>(0);
  const [shiftNotes, setShiftNotes] = useState("");
  const [closingShiftLoading, setClosingShiftLoading] = useState(false);

  // Diner list states
  const [activeTab, setActiveTab] = useState<"Member" | "Employee">("Member");
  const [searchQuery, setSearchQuery] = useState("");
  const [diners, setDiners] = useState<DinerType[]>([]);
  const [loadingDiners, setLoadingDiners] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Monitor network connectivity & auto-sync offline queue
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      await triggerSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Periodic queue check every 15s
    const syncInterval = setInterval(() => {
      if (navigator.onLine && getOfflineQueue().length > 0) {
        triggerSync();
      }
    }, 15000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(syncInterval);
    };
  }, []);

  const triggerSync = async () => {
    if (syncingQueue) return;
    setSyncingQueue(true);
    try {
      const res = await flushOfflineQueue();
      setOfflineQueueCount(res.remaining);
      if (res.synced > 0) {
        setLastSale({
          sale: `SYNCED-${res.synced}`,
          diner_type: "Sync",
          diner_name: `${res.synced} עסקאות סונכרנו בהצלחה`,
          total_amount: 0,
          was_overdraft_sale: false,
          items: [],
          status: "completed",
        });
      }
    } finally {
      setSyncingQueue(false);
    }
  };

  const handleRealtimeUpdate = useCallback((update: RealtimeItemUpdate) => {
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

  useRealtime(handleRealtimeUpdate);

  const handleBadge = useCallback(
    async (badgeId: string) => {
      const cleanBadge = badgeId.trim();
      if (!cleanBadge) return;

      // Double-scan protection guard (< 3 seconds on same badge)
      const now = Date.now();
      if (lastScanRef.current.badge === cleanBadge && now - lastScanRef.current.time < 3000) {
        setError("⚠️ שים לב: כרטיס נסרק זה עתה (מניעת סריקה כפולה)");
        return;
      }
      lastScanRef.current = { badge: cleanBadge, time: now };

      setError(null);
      setLoading(true);
      setGuestMode(false);
      idemKeyRef.current = generateIdemKey();
      const result = await lookupDiner(cleanBadge);
      setLoading(false);
      if (result) {
        setDiner(result);
        setBadgeInput("");
      } else {
        setError(`כרטיס ${cleanBadge} לא נמצא`);
      }
    },
    []
  );

  useKeyboardRFID(handleBadge);

  const loadMenu = useCallback(async () => {
    setLoading(true);
    const m = await getTodayMenu();
    setMenu(m);
    setLoading(false);
  }, []);

  // Load diners list with debounce
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingDiners(true);
      setListError(null);
      try {
        const rows = await listDiners(searchQuery, activeTab);
        if (!cancelled) setDiners(rows);
      } catch {
        if (!cancelled) setListError("שגיאה בטעינת רשימה");
      } finally {
        if (!cancelled) setLoadingDiners(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, activeTab]);

  const startAsGuest = async () => {
    setDiner({ name: "Guest", badge_id: "GUEST", diner_name: "אורח", diner_type: "Guest", tier_multiplier: 3.0 });
    setGuestMode(true);
    idemKeyRef.current = generateIdemKey();
    await loadMenu();
  };

  const addToCart = (item: DailyMenuItem) => {
    // Invariant 1: NEVER block on zero balance (Soft-Cap Overdraft allowed for all tiers)
    const priceField =
      diner?.diner_type === "Employee"
        ? "employee_price"
        : diner?.diner_type === "Guest"
        ? "guest_price"
        : "member_price";
    const unitPrice = (item[priceField as keyof DailyMenuItem] as number) || 0;
    setCart((prev) => {
      const existing = prev.find((c) => c.daily_menu_item === item.name);
      if (existing) {
        return prev.map((c) =>
          c.daily_menu_item === item.name ? { ...c, qty: c.qty + 1, amount: (c.qty + 1) * c.unit_price } : c
        );
      }
      return [
        ...prev,
        {
          daily_menu_item: item.name,
          dish_name: item.dish,
          qty: 1,
          unit_price: unitPrice,
          amount: unitPrice,
        },
      ];
    });
  };

  const removeFromCart = (dailyMenuItem: string) => {
    setCart((prev) => prev.filter((c) => c.daily_menu_item !== dailyMenuItem));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setError(null);
    setLoading(true);
    try {
      const result = await checkout(
        idemKeyRef.current,
        diner?.badge_id || "GUEST",
        diner?.diner_type === "Guest" ? "Guest" : "RFID",
        cart,
        { diner_name: diner?.diner_name, diner_type: diner?.diner_type }
      );
      setLastSale(result);
      setCart([]);
      setOfflineQueueCount(getOfflineQueue().length);
      idemKeyRef.current = generateIdemKey();
      await loadMenu();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "התשלום נכשל");
    } finally {
      setLoading(false);
    }
  };

  const clearDiner = () => {
    setDiner(null);
    setCart([]);
    setLastSale(null);
    setError(null);
  };

  const openShiftModal = async () => {
    const s = await getCurrentShift();
    setCurrentShift(s);
    setShowShiftModal(true);
  };

  const handleCloseShift = async () => {
    if (!currentShift) return;
    if (!window.confirm(`האם לסגור את המשמרת "${currentShift.name}" עם ספירת מזומן של ₪${countedCash}?`)) return;
    setClosingShiftLoading(true);
    try {
      await closeShift(currentShift.name, countedCash, shiftNotes);
      setShowShiftModal(false);
      alert(`משמרת ${currentShift.name} נסגרה בהצלחה. הופק דוח סוף יום.`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "שגיאה בסגירת משמרת");
    } finally {
      setClosingShiftLoading(false);
    }
  };

  const total = cart.reduce((sum, c) => sum + c.amount, 0);

  const getPriceForDiner = (item: DailyMenuItem): number => {
    if (!diner || guestMode) return item.guest_price || 0;
    if (diner.diner_type === "Member") return item.member_price || 0;
    if (diner.diner_type === "Employee") return item.employee_price || 0;
    return item.guest_price || 0;
  };

  return (
    <div className="pos-root" dir="rtl">
      {/* Top Status Bar: Connection & Offline Queue */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "6px 16px",
          background: isOnline ? "#f8fafc" : "#fff7ed",
          borderBottom: "1px solid var(--border)",
          fontSize: "0.85rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontWeight: 600 }}>
            {isOnline ? "🟢 מקוון (Online)" : "🟠 מצב לא מקוון (Offline)"}
          </span>
          {offlineQueueCount > 0 && (
            <span
              style={{
                background: "#ea580c",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: "12px",
                fontWeight: 600,
              }}
            >
              ⚠️ {offlineQueueCount} עסקאות ממתינות לסנכרון
            </span>
          )}
          {offlineQueueCount > 0 && isOnline && (
            <button
              className="btn-secondary btn-small"
              onClick={triggerSync}
              disabled={syncingQueue}
              style={{ padding: "2px 8px" }}
            >
              {syncingQueue ? "מסנכרן..." : "🔄 סנכרן כעת"}
            </button>
          )}
        </div>

        <button
          className="btn-secondary btn-small"
          onClick={openShiftModal}
          style={{ padding: "2px 10px" }}
        >
          🔒 סגירת קופה / דוח Z
        </button>
      </div>

      {/* Cashier Shift Close Modal */}
      {showShiftModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              padding: "var(--space-6)",
              borderRadius: "var(--radius-lg)",
              width: "420px",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <h3>🔒 סגירת משמרת / דוח קופה (Z-Report)</h3>
            {currentShift ? (
              <div>
                <p style={{ margin: "8px 0", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                  משמרת: <strong>{currentShift.name}</strong> ({currentShift.shift_type === "Lunch" ? "צהריים" : "ערב"})
                </p>
                <div style={{ background: "var(--surface-alt)", padding: "12px", borderRadius: "8px", margin: "12px 0" }}>
                  <div>סך מכירות: <strong>{formatILS(currentShift.total_sales || 0)}</strong></div>
                  <div>מספר עסקאות: <strong>{currentShift.total_transactions || 0}</strong></div>
                  <div>מזומן פתיחה: <strong>{formatILS(currentShift.opening_cash || 0)}</strong></div>
                </div>

                <div className="form-field" style={{ marginBottom: "12px" }}>
                  <label>ספירת מזומן פיזית בקופה (₪):</label>
                  <input
                    type="number"
                    step="0.01"
                    value={countedCash || ""}
                    onChange={(e) => setCountedCash(Number(e.target.value))}
                    placeholder="הזן סכום שנספר..."
                    autoFocus
                  />
                </div>

                <div className="form-field" style={{ marginBottom: "16px" }}>
                  <label>הערות קופאי לסגירה:</label>
                  <input
                    type="text"
                    value={shiftNotes}
                    onChange={(e) => setShiftNotes(e.target.value)}
                    placeholder="הערות לחוסר/עודף..."
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button className="btn-secondary" onClick={() => setShowShiftModal(false)}>
                    ביטול
                  </button>
                  <button className="btn-danger" onClick={handleCloseShift} disabled={closingShiftLoading}>
                    {closingShiftLoading ? "סוגר..." : "🔒 אשר וסגור משמרת"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p>אין משמרת פתוחה כעת.</p>
                <button className="btn-secondary" onClick={() => setShowShiftModal(false)}>
                  סגור
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!diner ? (
        <div className="identify-screen">
          <h1>🍽️ מערכת חדר אוכל</h1>
          <div className="identify-columns">
            <section className="identify-main">
              <h2>הזדהות</h2>

              {/* Tabs */}
              <div className="diner-tabs">
                <button
                  className={activeTab === "Member" ? "active" : ""}
                  onClick={() => setActiveTab("Member")}
                >
                  חברים
                </button>
                <button
                  className={activeTab === "Employee" ? "active" : ""}
                  onClick={() => setActiveTab("Employee")}
                >
                  שכירים
                </button>
              </div>

              {/* Search / filter */}
              <input
                className="badge-input diner-search"
                placeholder="חפש לפי שם או מספר"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />

              {/* Diner list */}
              <div className="diner-list">
                {loadingDiners ? (
                  <p className="empty-list">טוען רשימה...</p>
                ) : listError ? (
                  <p className="empty-list error">{listError}</p>
                ) : diners.length === 0 ? (
                  <p className="empty-list">לא נמצאו תוצאות</p>
                ) : (
                  diners.map((d) => (
                    <button
                      key={d.name}
                      className="diner-row"
                      onClick={() => handleBadge(d.badge_id)}
                    >
                      <span className="diner-row-name">{d.diner_name || d.badge_id}</span>
                      <span className="diner-row-badge">{d.badge_id}</span>
                      <span className="diner-row-tier">
                        {TIER_LABELS[d.diner_type]} ×{d.tier_multiplier.toFixed(0)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <aside className="identify-side">
              <div className="divider">או הזדהות ידנית</div>

              {/* Manual / RFID badge input */}
              <input
                className="badge-input"
                placeholder="מספר זהות / מספר כרטיס"
                value={badgeInput}
                onChange={(e) => setBadgeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBadge(badgeInput);
                }}
              />
              <button className="btn-primary" onClick={() => handleBadge(badgeInput)} disabled={loading}>
                {loading ? "מחפש..." : "אישור"}
              </button>

              <button className="btn-guest" onClick={startAsGuest}>
                🧑‍💼 המשך כאורח
              </button>
              <button className="btn-secondary" onClick={loadMenu} disabled={loading}>
                📋 צפה בתפריט
              </button>
              {error && <div className="error-msg">{error}</div>}
            </aside>
          </div>
        </div>
      ) : (
        <div className="pos-main">
          <header className="pos-header">
            <div className="diner-info">
              <span className="diner-badge">{TIER_LABELS[diner.diner_type] || diner.diner_type}</span>
              <span className="diner-name">{diner.diner_name}</span>
              {lastSale && (
                <span className="sale-flash">
                  {lastSale.status === "queued_offline" ? "💾 נשמר אופליין" : `✅ ${formatILS(lastSale.total_amount)}`}
                  {lastSale.was_overdraft_sale && " ⚠️"}
                </span>
              )}
            </div>
            <button className="btn-secondary" onClick={clearDiner}>
              🔄 החלף סועד
            </button>
          </header>

          <div className="pos-body">
            <div className="menu-grid">
              {menu?.items
                .slice()
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                .map((item) => {
                  const price = getPriceForDiner(item);
                  const color = STATUS_COLORS[item.status] || "#999";
                  const isSoldOut = item.balance_portions <= 0;
                  return (
                    <button
                      key={item.name}
                      className={`dish-card ${isSoldOut ? "overdraft-card" : ""}`}
                      onClick={() => addToCart(item)}
                    >
                      <div className="dish-status" style={{ background: color }} />
                      <div className="dish-name">{item.dish}</div>
                      <div className="dish-price">{price > 0 ? formatILS(price) : "—"}</div>
                      <div className="dish-balance" style={{ color: isSoldOut ? "#dc2626" : "inherit", fontWeight: isSoldOut ? 700 : 400 }}>
                        {item.balance_portions > 0 ? `${item.balance_portions} נשארו` : `חריגה (${item.balance_portions})`}
                      </div>
                    </button>
                  );
                })}
            </div>

            <div className="cart-panel">
              <h3>🛒 עגלה</h3>
              {cart.length === 0 ? (
                <p className="empty-cart">העגלה ריקה</p>
              ) : (
                <ul className="cart-items">
                  {cart.map((item) => (
                    <li key={item.daily_menu_item}>
                      <span>{item.dish_name}</span>
                      <span>×{item.qty}</span>
                      <span>{formatILS(item.amount)}</span>
                      <button onClick={() => removeFromCart(item.daily_menu_item)}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="cart-total">
                <span>סה״כ:</span>
                <span>{formatILS(total)}</span>
              </div>
              {guestMode && <div className="guest-notice">💳 אורח — תשלום מזומן / אשראי</div>}
              {error && <div className="error-msg">{error}</div>}
              <button
                className="btn-primary checkout-btn"
                onClick={handleCheckout}
                disabled={cart.length === 0 || loading}
              >
                {loading ? "מעבד..." : `💰 אישור ותשלום ${formatILS(total)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
