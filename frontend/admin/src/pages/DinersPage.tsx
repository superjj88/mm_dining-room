import { useEffect, useMemo, useState } from "react";
import { listDiners, createDiner, updateDiner, deleteDiner } from "../api/admin";
import type { Diner, DinerTypeValue } from "../types";

const EMPTY_FORM: Omit<Diner, "name" | "tier_multiplier"> = {
  badge_id: "",
  diner_name: "",
  diner_type: "Member",
  employee_id: "",
  maala_member_id: "",
  cost_center: "",
  billing_notes: "",
  is_active: 1,
};

export default function DinersPage() {
  const [diners, setDiners] = useState<Diner[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setDiners(await listDiners());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return diners;
    return diners.filter(
      (d) =>
        d.diner_name.toLowerCase().includes(q) ||
        d.badge_id.toLowerCase().includes(q) ||
        (d.maala_member_id || "").toLowerCase().includes(q) ||
        (d.cost_center || "").toLowerCase().includes(q) ||
        (d.employee_id || "").toLowerCase().includes(q)
    );
  }, [diners, search]);

  const reset = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
  };

  const onEdit = (d: Diner) => {
    setEditing(d.name);
    setForm({
      badge_id: d.badge_id,
      diner_name: d.diner_name,
      diner_type: d.diner_type,
      employee_id: d.employee_id || "",
      maala_member_id: d.maala_member_id || d.badge_id,
      cost_center: d.cost_center || "",
      billing_notes: d.billing_notes || "",
      is_active: d.is_active,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      if (editing) {
        await updateDiner(editing, form);
        setMessage("הסועד עודכן בהצלחה");
      } else {
        await createDiner(form);
        setMessage("הסועד נוסף בהצלחה");
      }
      reset();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  const handleDelete = async (d: Diner) => {
    if (!window.confirm(`למחוק את "${d.diner_name}" (${d.badge_id})?`)) return;
    setError(null);
    setMessage(null);
    try {
      const res = await deleteDiner(d.name);
      if (res.deactivated) {
        setMessage(`לסועד "${d.diner_name}" קיימת היסטוריית מכירות — הוא הושבת ולא נמחק`);
      } else {
        setMessage(`הסועד "${d.diner_name}" נמחק`);
      }
      if (editing === d.name) reset();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה");
    }
  };

  return (
    <div className="page">
      <h2>ניהול סועדים</h2>

      <form className="form-grid" onSubmit={handleSubmit}>
        <div className="form-field">
          <label>מספר כרטיס / תעודה</label>
          <input
            value={form.badge_id}
            onChange={(e) => setForm({ ...form, badge_id: e.target.value })}
            required
            dir="ltr"
          />
        </div>
        <div className="form-field">
          <label>שם מלא</label>
          <input
            value={form.diner_name}
            onChange={(e) => setForm({ ...form, diner_name: e.target.value })}
            required
          />
        </div>
        <div className="form-field">
          <label>סוג סועד</label>
          <select
            value={form.diner_type}
            onChange={(e) => setForm({ ...form, diner_type: e.target.value as DinerTypeValue })}
          >
            <option value="Member">חבר</option>
            <option value="Employee">עובד</option>
            <option value="Guest">אורח</option>
          </select>
        </div>
        <div className="form-field">
          <label>מספר עובד (אופציונלי)</label>
          <input
            value={form.employee_id}
            onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            dir="ltr"
          />
        </div>
        <div className="form-field">
          <label>קוד תקציב / חבר (מעלה)</label>
          <input
            value={form.maala_member_id}
            placeholder={form.badge_id || "למשל 20130"}
            onChange={(e) => setForm({ ...form, maala_member_id: e.target.value })}
            dir="ltr"
          />
        </div>
        <div className="form-field">
          <label>ענף / מחלקה (לשכירים)</label>
          <input
            value={form.cost_center}
            placeholder="למשל חקלאות, מוסך..."
            onChange={(e) => setForm({ ...form, cost_center: e.target.value })}
          />
        </div>
        <div className="form-field">
          <label>פעיל</label>
          <select
            value={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: Number(e.target.value) as 0 | 1 })}
          >
            <option value={1}>כן</option>
            <option value={0}>לא</option>
          </select>
        </div>
        <div className="form-actions">
          <button className="btn-primary" type="submit">
            {editing ? "עדכן" : "הוסף"}
          </button>
          {editing && (
            <button className="btn-secondary" type="button" onClick={reset}>
              ביטול
            </button>
          )}
        </div>
      </form>

      {message && <div className="success-msg">{message}</div>}
      {error && <div className="error-msg">{error}</div>}

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="חיפוש לפי שם, כרטיס, קוד מעלה או ענף..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn-secondary btn-small" onClick={load} disabled={loading}>
          רענן
        </button>
      </div>

      {loading && diners.length === 0 ? (
        <div className="loading">טוען...</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>כרטיס</th>
              <th>שם</th>
              <th>סוג</th>
              <th>קוד מעלה</th>
              <th>ענף</th>
              <th>מכפיל</th>
              <th>פעיל</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.name} className={d.is_active ? "" : "inactive"}>
                <td dir="ltr">{d.badge_id}</td>
                <td>{d.diner_name}</td>
                <td>{d.diner_type === "Member" ? "חבר" : d.diner_type === "Employee" ? "עובד" : "אורח"}</td>
                <td dir="ltr">{d.maala_member_id || d.badge_id}</td>
                <td>{d.cost_center || "—"}</td>
                <td>×{d.tier_multiplier}</td>
                <td>{d.is_active ? "כן" : "לא"}</td>
                <td>
                  <button className="btn-secondary btn-small" onClick={() => onEdit(d)}>
                    ערוך
                  </button>{" "}
                  <button className="btn-danger btn-small" onClick={() => handleDelete(d)}>
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
