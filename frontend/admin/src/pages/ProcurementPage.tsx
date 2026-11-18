import { useEffect, useMemo, useState } from "react";
import { listRawItems, updateRawRate, createRawItem, deleteRawItem, listSuppliers } from "../api/admin";
import type { RawItem, Supplier } from "../types";

const CATEGORIES = [
  { value: "Protein", label: "חלבון" },
  { value: "Dairy", label: "חלב" },
  { value: "Produce", label: "ירקות ופירות" },
  { value: "Grains", label: "דגנים" },
  { value: "Oils & Fats", label: "שמנים ושומנים" },
  { value: "Spices", label: "תבלינים" },
  { value: "Beverages", label: "משקאות" },
  { value: "Other", label: "אחר" },
];

export default function ProcurementPage() {
  const [items, setItems] = useState<RawItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUom, setNewUom] = useState("Kg");
  const [newCategory, setNewCategory] = useState("Other");
  const [newSupplier, setNewSupplier] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [raw, sup] = await Promise.all([listRawItems(), listSuppliers()]);
      setItems(raw);
      setSuppliers(sup);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.item_name.toLowerCase().includes(q) ||
        (i.supplier_name || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const updateRate = async (name: string) => {
    setError(null);
    setMessage(null);
    const rate = parseFloat(rates[name] || "");
    if (Number.isNaN(rate) || rate < 0) {
      setError("יש להזין מחיר תקין");
      return;
    }
    try {
      await updateRawRate(name, rate, notes[name] || "");
      setRates((prev) => ({ ...prev, [name]: "" }));
      setNotes((prev) => ({ ...prev, [name]: "" }));
      setMessage("המחיר עודכן בהצלחה");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await createRawItem({
        item_name: newName,
        uom: newUom,
        category: newCategory,
        supplier: newSupplier || undefined,
      });
      setNewName("");
      setNewUom("Kg");
      setNewCategory("Other");
      setNewSupplier("");
      setFormOpen(false);
      setMessage("פריט חדש נוסף בהצלחה");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const handleDelete = async (i: RawItem) => {
    if (!window.confirm(`למחוק את "${i.item_name}"?`)) return;
    setError(null);
    setMessage(null);
    try {
      const res = await deleteRawItem(i.name);
      if (res.deactivated) {
        setMessage(`"${i.item_name}" נמצא בשימוש בהיסטוריית מחירים או במתכונים — הושבת ולא נמחק`);
      } else {
        setMessage(`"${i.item_name}" נמחק`);
      }
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const categoryLabel = (v?: string) => CATEGORIES.find((c) => c.value === v)?.label || v || "—";

  return (
    <div className="page">
      <h2>רכש ומחירי חומרי גלם</h2>

      <div className="toolbar">
        <button className="btn-primary" onClick={() => setFormOpen((v) => !v)}>
          {formOpen ? "סגור טופס" : "חומר גלם חדש"}
        </button>
      </div>

      {formOpen && (
        <form className="form-grid" onSubmit={addItem} style={{ marginBottom: "1rem" }}>
          <div className="form-field">
            <label>שם חומר גלם</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </div>
          <div className="form-field">
            <label>יחידת מידה</label>
            <input value={newUom} onChange={(e) => setNewUom(e.target.value)} required dir="ltr" />
          </div>
          <div className="form-field">
            <label>קטגוריה</label>
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>ספק</label>
            <select value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)}>
              <option value="">— ללא ספק —</option>
              {suppliers.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.supplier_name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-actions">
            <button className="btn-primary" type="submit">
              הוסף חומר גלם
            </button>
          </div>
        </form>
      )}

      {message && <div className="success-msg">{message}</div>}
      {error && <div className="error-msg">{error}</div>}

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="חיפוש חומר גלם או ספק..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn-secondary btn-small" onClick={load} disabled={loading}>
          רענן
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="loading">טוען...</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>שם</th>
              <th>קטגוריה</th>
              <th>ספק</th>
              <th>יחידה</th>
              <th>מחיר נוכחי (₪)</th>
              <th>עדכון מחיר אחרון</th>
              <th>מחיר חדש</th>
              <th>הערה</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={i.name} className={i.is_active ? "" : "inactive"}>
                <td>{i.item_name}</td>
                <td>{categoryLabel(i.category)}</td>
                <td>{i.supplier_name || "—"}</td>
                <td>{i.uom}</td>
                <td>₪{Number(i.current_rate || 0).toFixed(2)}</td>
                <td dir="ltr">
                  {i.last_price_update
                    ? `${i.last_price_update}${i.last_rate != null ? ` (₪${Number(i.last_rate).toFixed(2)})` : ""}`
                    : "—"}
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="מחיר חדש"
                    value={rates[i.name] || ""}
                    onChange={(e) => setRates({ ...rates, [i.name]: e.target.value })}
                    dir="ltr"
                  />
                </td>
                <td>
                  <input
                    placeholder="הערה"
                    value={notes[i.name] || ""}
                    onChange={(e) => setNotes({ ...notes, [i.name]: e.target.value })}
                  />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-primary btn-small" onClick={() => updateRate(i.name)}>
                    עדכן
                  </button>{" "}
                  <button className="btn-danger btn-small" onClick={() => handleDelete(i)}>
                    מחק
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
