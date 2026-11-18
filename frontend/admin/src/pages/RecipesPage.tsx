import { useEffect, useState } from "react";
import { listMenuItems, listRawItems, createMenuItem, updateMenuItem, deleteMenuItem } from "../api/admin";
import type { MenuItem, RawItem, Ingredient } from "../types";

export default function RecipesPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [rawItems, setRawItems] = useState<RawItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [dishName, setDishName] = useState("");
  const [isActive, setIsActive] = useState(1);
  const [category, setCategory] = useState("Main Course");
  const [yieldPortions, setYieldPortions] = useState(1);
  const [packagingCost, setPackagingCost] = useState(0);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [mi, ri] = await Promise.all([listMenuItems(), listRawItems()]);
      setItems(mi);
      setRawItems(ri);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setEditing(null);
    setDishName("");
    setIsActive(1);
    setCategory("Main Course");
    setYieldPortions(1);
    setPackagingCost(0);
    setIngredients([]);
    setFormOpen(false);
  };

  const startEdit = (item: MenuItem) => {
    setEditing(item.name);
    setDishName(item.dish_name);
    setIsActive(item.is_active);
    setCategory(item.category || "Main Course");
    setYieldPortions(item.yield_portions || 1);
    setPackagingCost(item.packaging_cost || 0);
    setIngredients(item.ingredients || []);
    setFormOpen(true);
  };

  const addIngredient = () => {
    setIngredients([...ingredients, { raw_item_name: "", qty: 0, uom: "Kg", wastage_percent: 0 }]);
  };

  const updateIngredient = (idx: number, field: keyof Ingredient, value: string | number) => {
    const next = ingredients.map((ing, i) =>
      i === idx ? { ...ing, [field]: value } : ing
    );
    setIngredients(next);
  };

  const removeIngredient = (idx: number) => {
    setIngredients(ingredients.filter((_, i) => i !== idx));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const payload = {
      dish_name: dishName,
      is_active: isActive,
      category,
      yield_portions: yieldPortions,
      packaging_cost: packagingCost,
      ingredients: ingredients.filter((i) => i.raw_item_name && i.qty > 0),
    };
    try {
      if (editing) {
        await updateMenuItem(editing, payload);
        setMessage("המתכון עודכן בהצלחה");
      } else {
        await createMenuItem(payload);
        setMessage("המתכון נוצר בהצלחה");
      }
      resetForm();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const handleDelete = async (item: MenuItem) => {
    if (!window.confirm(`למחוק את המתכון "${item.dish_name}"?`)) return;
    setError(null);
    setMessage(null);
    try {
      const res = await deleteMenuItem(item.name);
      if (res.deactivated) {
        setMessage(`"${item.dish_name}" הופיע בתפריט יומי — המתכון הושבת ולא נמחק`);
      } else {
        setMessage(`המתכון "${item.dish_name}" נמחק`);
      }
      if (editing === item.name) resetForm();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  return (
    <div className="page">
      <h2>מתכונים</h2>

      {message && <div className="success-msg">{message}</div>}
      {error && <div className="error-msg">{error}</div>}

      <div className="toolbar">
        <button className="btn-primary" onClick={() => setFormOpen(true)}>
          מתכון חדש
        </button>
        <button className="btn-secondary btn-small" onClick={load} disabled={loading}>
          רענן
        </button>
      </div>

      {formOpen && (
        <form className="form-grid" onSubmit={submit} style={{ marginBottom: "1rem" }}>
          <div className="form-field">
            <label>שם מנה</label>
            <input value={dishName} onChange={(e) => setDishName(e.target.value)} required />
          </div>
          <div className="form-field">
            <label>קטגוריה</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="Soup">מרק</option>
              <option value="Salad">סלט</option>
              <option value="Main Course">מנה עיקרית</option>
              <option value="Side Dish">תוספת</option>
              <option value="Dessert">קינוח</option>
              <option value="Beverage">שתייה</option>
            </select>
          </div>
          <div className="form-field">
            <label>תפוקת מנות (Yield)</label>
            <input
              type="number"
              min="1"
              value={yieldPortions}
              onChange={(e) => setYieldPortions(parseInt(e.target.value) || 1)}
              required
            />
          </div>
          <div className="form-field">
            <label>עלות אריזה / חד-פעמי למנה (₪)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={packagingCost}
              onChange={(e) => setPackagingCost(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="form-field">
            <label>פעיל</label>
            <select value={isActive} onChange={(e) => setIsActive(Number(e.target.value) as 0 | 1)}>
              <option value={1}>כן</option>
              <option value={0}>לא</option>
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <h4 style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>מרכיבים</h4>
            {ingredients.map((ing, idx) => (
              <div key={idx} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "center" }}>
                <select
                  value={ing.raw_item_name}
                  onChange={(e) => updateIngredient(idx, "raw_item_name", e.target.value)}
                  required
                  style={{ flex: 2 }}
                >
                  <option value="">בחר חומר גלם...</option>
                  {rawItems.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.item_name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="כמות"
                  value={ing.qty || ""}
                  onChange={(e) => updateIngredient(idx, "qty", parseFloat(e.target.value) || 0)}
                  required
                  dir="ltr"
                  style={{ flex: 1 }}
                />
                <input
                  placeholder="יח׳"
                  value={ing.uom || ""}
                  onChange={(e) => updateIngredient(idx, "uom", e.target.value)}
                  style={{ flex: 0.7 }}
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="בזבוז %"
                  value={ing.wastage_percent || ""}
                  onChange={(e) => updateIngredient(idx, "wastage_percent", parseFloat(e.target.value) || 0)}
                  dir="ltr"
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn-danger btn-small" onClick={() => removeIngredient(idx)}>
                  הסר
                </button>
              </div>
            ))}
            <button type="button" className="btn-secondary btn-small" onClick={addIngredient}>
              הוסף מרכיב
            </button>
          </div>
          <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
            <button className="btn-primary" type="submit">
              {editing ? "עדכן מתכון" : "שמור מתכון"}
            </button>
            <button className="btn-secondary" type="button" onClick={resetForm}>
              ביטול
            </button>
          </div>
        </form>
      )}

      {loading && items.length === 0 ? (
        <div className="loading">טוען...</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>שם מנה</th>
              <th>קטגוריה</th>
              <th>תפוקה</th>
              <th>עלות מנה (Food Cost)</th>
              <th>עלות אריזה</th>
              <th>מרכיבים</th>
              <th>עדכון אחרון</th>
              <th>פעיל</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.name} className={item.is_active ? "" : "inactive"}>
                <td>{item.dish_name}</td>
                <td>{item.category}</td>
                <td>{item.yield_portions || 1} מנות</td>
                <td><strong>₪{item.calculated_base_cost.toFixed(2)}</strong></td>
                <td>₪{(item.packaging_cost || 0).toFixed(2)}</td>
                <td>{item.ingredients.length}</td>
                <td dir="ltr">{item.last_cost_update ? item.last_cost_update.slice(0, 19) : "—"}</td>
                <td>{item.is_active ? "כן" : "לא"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-secondary btn-small" onClick={() => startEdit(item)}>
                    ערוך
                  </button>{" "}
                  <button className="btn-danger btn-small" onClick={() => handleDelete(item)}>
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
