import { useEffect, useState } from "react";
import {
  listDailyMenus,
  getDailyMenu,
  createDailyMenu,
  addDailyMenuItem,
  removeDailyMenuItem,
  updateDailyMenuItem,
  publishDailyMenu,
  deleteDailyMenu,
  listMenuItems,
} from "../api/admin";
import type { DailyMenu, DailyMenuItem, MenuItem } from "../types";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

const SHIFT_LABEL = (s: string) => (s === "Lunch" ? "צהריים" : "ערב");

function itemStatusClass(s: string) {
  if (s === "Available") return "status-published";
  if (s === "Low Stock") return "status-draft";
  return "status-closed";
}

function DishRow({
  item,
  editable,
  onSave,
  onRemove,
}: {
  item: DailyMenuItem;
  editable: boolean;
  onSave: (patch: {
    prepared_portions?: number;
    member_price?: number;
    employee_price?: number;
    guest_price?: number;
  }) => Promise<void>;
  onRemove: () => void;
}) {
  const [prepared, setPrepared] = useState(String(item.prepared_portions));
  const [member, setMember] = useState(item.member_price.toFixed(2));
  const [employee, setEmployee] = useState(item.employee_price.toFixed(2));
  const [guest, setGuest] = useState(item.guest_price.toFixed(2));
  const [saving, setSaving] = useState(false);

  const dirty =
    prepared !== String(item.prepared_portions) ||
    member !== item.member_price.toFixed(2) ||
    employee !== item.employee_price.toFixed(2) ||
    guest !== item.guest_price.toFixed(2);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        prepared_portions: parseInt(prepared || "0", 10),
        member_price: parseFloat(member || "0"),
        employee_price: parseFloat(employee || "0"),
        guest_price: parseFloat(guest || "0"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{item.dish}</div>
        <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          עלות בסיס ₪{item.calculated_base_cost.toFixed(2)} · נמכרו {item.sold_portions} · נותרו{" "}
          {item.balance_portions}
        </div>
      </td>
      <td>
        {editable ? (
          <input
            type="number"
            min={item.sold_portions}
            value={prepared}
            onChange={(e) => setPrepared(e.target.value)}
            dir="ltr"
            style={{ width: "5rem" }}
          />
        ) : (
          item.prepared_portions
        )}
      </td>
      <td>
        {editable ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={member}
            onChange={(e) => setMember(e.target.value)}
            dir="ltr"
            style={{ width: "5.5rem" }}
          />
        ) : (
          `₪${item.member_price.toFixed(2)}`
        )}
      </td>
      <td>
        {editable ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={employee}
            onChange={(e) => setEmployee(e.target.value)}
            dir="ltr"
            style={{ width: "5.5rem" }}
          />
        ) : (
          `₪${item.employee_price.toFixed(2)}`
        )}
      </td>
      <td>
        {editable ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={guest}
            onChange={(e) => setGuest(e.target.value)}
            dir="ltr"
            style={{ width: "5.5rem" }}
          />
        ) : (
          `₪${item.guest_price.toFixed(2)}`
        )}
      </td>
      <td>
        <span className={`status-badge ${itemStatusClass(item.status)}`}>{item.status}</span>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {editable && (
          <button className="btn-primary btn-small" disabled={!dirty || saving} onClick={save}>
            {saving ? "..." : "שמור"}
          </button>
        )}{" "}
        {editable && (
          <button className="btn-danger btn-small" onClick={onRemove}>
            הסר
          </button>
        )}
      </td>
    </tr>
  );
}

export default function DailyMenuPage() {
  const [menus, setMenus] = useState<DailyMenu[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeMenu, setActiveMenu] = useState<DailyMenu | null>(null);
  const [newDate, setNewDate] = useState(todayStr());
  const [newShift, setNewShift] = useState<"Lunch" | "Dinner">("Lunch");
  const [selectedDish, setSelectedDish] = useState("");
  const [portions, setPortions] = useState("100");
  const [sortOrder, setSortOrder] = useState("0");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMenus = async () => {
    setLoading(true);
    try {
      setMenus(await listDailyMenus());
    } finally {
      setLoading(false);
    }
  };

  const loadMenuItems = async () => {
    setMenuItems(await listMenuItems());
  };

  useEffect(() => {
    loadMenus();
    loadMenuItems();
  }, []);

  const openBuilder = async (name: string) => {
    setError(null);
    try {
      setActiveMenu(await getDailyMenu(name));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await createDailyMenu(newDate, newShift);
      setMessage("תפריט יומי נוצר בהצלחה");
      await loadMenus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMenu || !selectedDish) return;
    setError(null);
    setMessage(null);
    try {
      const updated = await addDailyMenuItem(
        activeMenu.name,
        selectedDish,
        parseInt(portions || "0", 10),
        parseInt(sortOrder || "0", 10)
      );
      setActiveMenu(updated);
      setSelectedDish("");
      setPortions("100");
      setSortOrder(String((updated.items?.length || 0) + 1));
      setMessage("מנה נוספה לתפריט");
      await loadMenus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const removeItem = async (itemName: string) => {
    if (!activeMenu) return;
    setError(null);
    setMessage(null);
    try {
      const updated = await removeDailyMenuItem(activeMenu.name, itemName);
      setActiveMenu(updated);
      await loadMenus();
      setMessage("המנה הוסרה מהתפריט");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const saveItem = async (
    itemName: string,
    patch: {
      prepared_portions?: number;
      member_price?: number;
      employee_price?: number;
      guest_price?: number;
    }
  ) => {
    if (!activeMenu) return;
    setError(null);
    setMessage(null);
    try {
      const updated = await updateDailyMenuItem(activeMenu.name, itemName, patch);
      setActiveMenu(updated);
      await loadMenus();
      setMessage("המנה עודכנה");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const handleDeleteMenu = async (m: DailyMenu) => {
    if (!window.confirm(`למחוק את התפריט ${m.menu_date} — ${SHIFT_LABEL(m.shift)}?`)) return;
    setError(null);
    setMessage(null);
    try {
      await deleteDailyMenu(m.name);
      setMessage("התפריט נמחק");
      if (activeMenu?.name === m.name) setActiveMenu(null);
      await loadMenus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const publish = async () => {
    if (!activeMenu) return;
    setError(null);
    setMessage(null);
    try {
      await publishDailyMenu(activeMenu.name);
      const updated = await getDailyMenu(activeMenu.name);
      setActiveMenu(updated);
      await loadMenus();
      setMessage("התפריט פורסם בהצלחה");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const statusClass = (s: string) => {
    if (s === "Published") return "status-published";
    if (s === "Closed") return "status-closed";
    return "status-draft";
  };

  const statusLabel = (s: string) => {
    if (s === "Published") return "פורסם";
    if (s === "Closed") return "סגור";
    return "טיוטה";
  };

  const activeItems = activeMenu?.items || [];
  const activeEditable = activeMenu?.status !== "Closed";

  return (
    <div className="page">
      <h2>תפריט יומי</h2>

      {message && <div className="success-msg">{message}</div>}
      {error && <div className="error-msg">{error}</div>}

      <form className="form-grid" onSubmit={create}>
        <div className="form-field">
          <label>תאריך</label>
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} required dir="ltr" />
        </div>
        <div className="form-field">
          <label>משמרת</label>
          <select value={newShift} onChange={(e) => setNewShift(e.target.value as "Lunch" | "Dinner")}>
            <option value="Lunch">צהריים</option>
            <option value="Dinner">ערב</option>
          </select>
        </div>
        <div className="form-actions">
          <button className="btn-primary" type="submit">
            צור תפריט יומי
          </button>
        </div>
      </form>

      {loading && menus.length === 0 ? (
        <div className="loading">טוען...</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>משמרת</th>
              <th>סטטוס</th>
              <th>מנות</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {menus.map((m) => (
              <tr key={m.name}>
                <td dir="ltr">{m.menu_date}</td>
                <td>{SHIFT_LABEL(m.shift)}</td>
                <td>
                  <span className={`status-badge ${statusClass(m.status)}`}>{statusLabel(m.status)}</span>
                </td>
                <td>{m.item_count ?? m.items?.length ?? 0}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-secondary btn-small" onClick={() => openBuilder(m.name)}>
                    ערוך
                  </button>{" "}
                  <button className="btn-danger btn-small" onClick={() => handleDeleteMenu(m)}>
                    מחק
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {activeMenu && (
        <div className="modal-backdrop" onClick={() => setActiveMenu(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>
                תפריט {activeMenu.menu_date} — {SHIFT_LABEL(activeMenu.shift)}
              </h3>
              <span className={`status-badge ${statusClass(activeMenu.status)}`}>{statusLabel(activeMenu.status)}</span>
            </div>

            {error && <div className="error-msg">{error}</div>}
            {message && <div className="success-msg">{message}</div>}

            {activeEditable && (
              <div className="hint" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                ניתן לעדכן מנות מוכנות ומחירים ידנית. השינויים יישמרו עד לעדכון מחיר חומר גלם (שיחזיר את מחירי
                השכבות ×1/×2/×3).
              </div>
            )}

            <div className="builder-grid">
              <div>
                <h4 style={{ color: "var(--muted)", marginBottom: "0.75rem" }}>מנות בתפריט</h4>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>מנה</th>
                      <th>מנות מוכנות</th>
                      <th>חבר</th>
                      <th>עובד</th>
                      <th>אורח</th>
                      <th>מצב</th>
                      <th>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeItems.map((item: DailyMenuItem) => (
                      <DishRow
                        key={item.name}
                        item={item}
                        editable={activeEditable}
                        onSave={(patch) => saveItem(item.name, patch)}
                        onRemove={() => removeItem(item.name)}
                      />
                    ))}
                    {activeItems.length === 0 && (
                      <tr>
                        <td colSpan={7}>אין מנות בתפריט</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {activeMenu.status === "Draft" && (
                  <div style={{ marginTop: "1rem" }}>
                    <button className="btn-primary" onClick={publish} disabled={activeItems.length === 0}>
                      פרסם תפריט
                    </button>
                  </div>
                )}
              </div>

              {activeEditable && (
                <form className="add-panel" onSubmit={addItem}>
                  <h4>הוסף מנה</h4>
                  <div className="form-field">
                    <label>מנה</label>
                    <select value={selectedDish} onChange={(e) => setSelectedDish(e.target.value)} required>
                      <option value="">בחר מתכון...</option>
                      {menuItems.map((mi) => (
                        <option key={mi.name} value={mi.name}>
                          {mi.dish_name} (₪{mi.calculated_base_cost.toFixed(2)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>מנות מוכנות</label>
                    <input
                      type="number"
                      min="0"
                      value={portions}
                      onChange={(e) => setPortions(e.target.value)}
                      required
                      dir="ltr"
                    />
                  </div>
                  <div className="form-field">
                    <label>סדר הצגה</label>
                    <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} dir="ltr" />
                  </div>
                  <button className="btn-primary" type="submit">
                    הוסף לתפריט
                  </button>
                </form>
              )}
            </div>

            <div>
              <button className="btn-secondary" onClick={() => setActiveMenu(null)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
