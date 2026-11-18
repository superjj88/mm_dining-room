import { useEffect, useState } from "react";
import {
  listShifts,
  getShiftReport,
  validateShiftExport,
  exportShift,
  openShift,
  closeShift,
  saveKitchenReconciliation,
} from "../api/admin";
import type {
  Shift,
  ShiftReport,
  ExportValidation,
  KitchenReconciliationItem,
} from "../types";

function formatILS(n?: number) {
  return `₪${(n ?? 0).toFixed(2)}`;
}

function downloadFile(content: string, filename: string, mimetype = "text/csv; charset=utf-8") {
  const blob = new Blob([content], { type: mimetype });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedShiftName, setSelectedShiftName] = useState<string | null>(null);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [validation, setValidation] = useState<ExportValidation | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New Shift Modal / Form
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [newShiftDate, setNewShiftDate] = useState(new Date().toISOString().split("T")[0]);
  const [newShiftType, setNewShiftType] = useState<"Lunch" | "Dinner">("Lunch");
  const [newShiftCash, setNewShiftCash] = useState<number>(0);

  // Close Shift Form
  const [closingCash, setClosingCash] = useState<number>(0);
  const [closeNotes, setCloseNotes] = useState("");

  // Kitchen reconciliation
  const [kitchenItems, setKitchenItems] = useState<KitchenReconciliationItem[]>([]);
  const [savingKitchen, setSavingKitchen] = useState(false);

  const loadShifts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listShifts();
      setShifts(data);
      if (data.length > 0 && !selectedShiftName) {
        setSelectedShiftName(data[0].name);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה בטעינת משמרות");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShifts();
  }, []);

  const selectShift = async (shiftName: string) => {
    setSelectedShiftName(shiftName);
    setLoadingReport(true);
    setValidation(null);
    setError(null);
    try {
      const [rep, val] = await Promise.all([
        getShiftReport(shiftName),
        validateShiftExport(shiftName),
      ]);
      setReport(rep);
      setValidation(val);

      // Initialize kitchen items from report variance
      const existingItems: KitchenReconciliationItem[] = [];
      const itemVariance = rep?.item_variance || [];

      // Check if previous saved variance exists in shift
      let savedVarianceItems: Record<string, { leftovers?: number; waste?: number }> = {};
      const currentShiftObj = shifts.find((s) => s.name === shiftName);
      if (currentShiftObj?.variance_report) {
        try {
          const parsed = JSON.parse(currentShiftObj.variance_report);
          if (parsed && Array.isArray(parsed.items)) {
            for (const it of parsed.items) {
              savedVarianceItems[it.dish] = {
                leftovers: it.leftover_portions,
                waste: it.waste_portions,
              };
            }
          }
        } catch {
          // variance_report is simple string notes
        }
      }

      for (const iv of itemVariance) {
        const saved = savedVarianceItems[iv.dish] || {};
        const leftover = saved.leftovers ?? 0;
        const waste = saved.waste ?? 0;
        const prepared = iv.prepared_portions || 0;
        const sold = iv.sold_portions || 0;
        existingItems.push({
          dish: iv.dish,
          dish_name: iv.dish,
          prepared_portions: prepared,
          sold_portions: sold,
          leftover_portions: leftover,
          waste_portions: waste,
          variance_portions: prepared - (sold + leftover + waste),
        });
      }
      setKitchenItems(existingItems);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה בטעינת דוח משמרת");
    } finally {
      setLoadingReport(false);
    }
  };

  useEffect(() => {
    if (selectedShiftName) {
      selectShift(selectedShiftName);
    }
  }, [selectedShiftName]);

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await openShift(newShiftDate, newShiftType, newShiftCash);
      setMessage(`משמרת ${res.shift} נפתחה בהצלחה`);
      setShowOpenModal(false);
      await loadShifts();
      setSelectedShiftName(res.shift);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה בפתיחת משמרת");
    }
  };

  const handleCloseShift = async () => {
    if (!selectedShiftName) return;
    if (!window.confirm(`האם לסגור את המשמרת "${selectedShiftName}" עם ספירת מזומן של ₪${closingCash}?`)) return;
    setError(null);
    setMessage(null);
    try {
      await closeShift(selectedShiftName, closingCash, closeNotes);
      setMessage(`משמרת ${selectedShiftName} נסגרה בהצלחה`);
      await loadShifts();
      if (selectedShiftName) await selectShift(selectedShiftName);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה בסגירת משמרת");
    }
  };

  const handleExport = async (format: string) => {
    if (!selectedShiftName) return;
    setError(null);
    try {
      const fileData = await exportShift(selectedShiftName, format);
      downloadFile(fileData.content, fileData.filename, fileData.mimetype);
      setMessage(`הקובץ ${fileData.filename} הורד בהצלחה`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה בהורדת קובץ");
    }
  };

  const handleKitchenChange = (index: number, field: "leftover_portions" | "waste_portions", val: number) => {
    setKitchenItems((prev) => {
      const copy = [...prev];
      const item = { ...copy[index], [field]: Math.max(0, val) };
      item.variance_portions = item.prepared_portions - (item.sold_portions + item.leftover_portions + item.waste_portions);
      copy[index] = item;
      return copy;
    });
  };

  const handleSaveKitchen = async () => {
    if (!selectedShiftName) return;
    setSavingKitchen(true);
    setError(null);
    setMessage(null);
    try {
      await saveKitchenReconciliation(selectedShiftName, kitchenItems);
      setMessage("בקרת פחת ועודפי מטבח נשמרה בהצלחה");
      await selectShift(selectedShiftName);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה בשמירת בקרת מטבח");
    } finally {
      setSavingKitchen(false);
    }
  };

  const selectedShift = shifts.find((s) => s.name === selectedShiftName);

  return (
    <div className="page" dir="rtl">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
        <h2>ניהול משמרות וייצוא לתוכנת "מעלה"</h2>
        <button className="btn-primary" onClick={() => setShowOpenModal(true)}>
          ➕ פתח משמרת חדשה
        </button>
      </div>

      {message && <div className="success-msg">{message}</div>}
      {error && <div className="error-msg">{error}</div>}

      {/* Modal פתיחת משמרת */}
      {showOpenModal && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000
        }}>
          <div style={{
            background: "var(--surface)",
            padding: "var(--space-6)",
            borderRadius: "var(--radius-lg)",
            width: "400px",
            boxShadow: "var(--shadow-lg)"
          }}>
            <h3>פתיחת משמרת חדשה</h3>
            <form onSubmit={handleOpenShift}>
              <div className="form-field" style={{ marginBottom: "var(--space-3)" }}>
                <label>תאריך משמרת</label>
                <input
                  type="date"
                  value={newShiftDate}
                  onChange={(e) => setNewShiftDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-field" style={{ marginBottom: "var(--space-3)" }}>
                <label>סוג משמרת</label>
                <select value={newShiftType} onChange={(e) => setNewShiftType(e.target.value as "Lunch" | "Dinner")}>
                  <option value="Lunch">צהריים (Lunch)</option>
                  <option value="Dinner">ערב (Dinner)</option>
                </select>
              </div>
              <div className="form-field" style={{ marginBottom: "var(--space-4)" }}>
                <label>מזומן פתיחה בקופה (₪)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newShiftCash}
                  onChange={(e) => setNewShiftCash(Number(e.target.value))}
                />
              </div>
              <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
                <button type="button" className="btn-secondary" onClick={() => setShowOpenModal(false)}>
                  ביטול
                </button>
                <button type="submit" className="btn-primary">
                  אישור ופתיחה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Grid: Shift List on Right, Detail on Left */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "var(--space-6)" }}>
        {/* Shifts List Sidebar */}
        <div>
          <div className="toolbar" style={{ marginBottom: "var(--space-3)" }}>
            <span style={{ fontWeight: 600 }}>היסטוריית משמרות</span>
            <button className="btn-secondary btn-small" onClick={loadShifts} disabled={loading}>
              רענן
            </button>
          </div>

          {loading && shifts.length === 0 ? (
            <div className="loading">טוען משמרות...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: "70vh", overflowY: "auto" }}>
              {shifts.map((s) => (
                <div
                  key={s.name}
                  onClick={() => setSelectedShiftName(s.name)}
                  style={{
                    padding: "var(--space-3)",
                    borderRadius: "var(--radius-md)",
                    border: s.name === selectedShiftName ? "2px solid var(--accent)" : "1px solid var(--border)",
                    background: s.name === selectedShiftName ? "var(--accent-soft)" : "var(--surface)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                        background: s.status === "Open" ? "#dcfce7" : "#f1f5f9",
                        color: s.status === "Open" ? "#166534" : "#475569",
                        fontWeight: 600,
                      }}
                    >
                      {s.status === "Open" ? "פתוחה" : "סגורה"}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "var(--space-1)" }}>
                    מכירות: {formatILS(s.total_sales)} · {s.total_transactions || 0} עסקאות
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Selected Shift Detail & Export Hub */}
        <div>
          {selectedShift ? (
            <div>
              {/* Shift Overview Banner */}
              <div
                style={{
                  background: "var(--surface)",
                  padding: "var(--space-5)",
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border)",
                  marginBottom: "var(--space-5)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
                  <div>
                    <h3 style={{ margin: 0 }}>
                      משמרת: {selectedShift.name} ({selectedShift.shift_type === "Lunch" ? "צהריים" : "ערב"})
                    </h3>
                    <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "4px" }}>
                      תאריך: {selectedShift.shift_date} · סטטוס:{" "}
                      <strong style={{ color: selectedShift.status === "Open" ? "#16a34a" : "#475569" }}>
                        {selectedShift.status === "Open" ? "🟢 פתוחה למכירות" : "🔒 סגורה"}
                      </strong>
                    </div>
                  </div>

                  {/* Close Shift Controls */}
                  {selectedShift.status === "Open" && (
                    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="ספירת מזומן (₪)"
                        style={{ width: "130px" }}
                        value={closingCash || ""}
                        onChange={(e) => setClosingCash(Number(e.target.value))}
                      />
                      <input
                        type="text"
                        placeholder="הערות סגירה..."
                        style={{ width: "130px" }}
                        value={closeNotes}
                        onChange={(e) => setCloseNotes(e.target.value)}
                      />
                      <button className="btn-danger btn-small" onClick={handleCloseShift}>
                        🔒 סגור משמרת
                      </button>
                    </div>
                  )}
                </div>

                {loadingReport && <div className="loading" style={{ margin: "var(--space-2) 0" }}>טוען נתוני משמרת...</div>}

                {/* Metrics Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
                  <div style={{ background: "var(--surface-alt)", padding: "var(--space-3)", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>סך מכירות</div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                      {formatILS(report?.sales_summary?.total_sales ?? selectedShift.total_sales)}
                    </div>
                  </div>
                  <div style={{ background: "var(--surface-alt)", padding: "var(--space-3)", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>מספר עסקאות</div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                      {report?.sales_summary?.total_transactions ?? selectedShift.total_transactions ?? 0}
                    </div>
                  </div>
                  <div style={{ background: "var(--surface-alt)", padding: "var(--space-3)", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>עסקאות Overdraft</div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: (report?.sales_summary?.overdraft_sales ?? selectedShift.overdraft_sales ?? 0) > 0 ? "#ea580c" : "inherit" }}>
                      {report?.sales_summary?.overdraft_sales ?? selectedShift.overdraft_sales ?? 0}
                    </div>
                  </div>
                  <div style={{ background: "var(--surface-alt)", padding: "var(--space-3)", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>מזומן פתיחה</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{formatILS(selectedShift.opening_cash)}</div>
                  </div>
                  <div style={{ background: "var(--surface-alt)", padding: "var(--space-3)", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>מזומן סגירה</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{formatILS(selectedShift.closing_cash)}</div>
                  </div>
                  <div style={{ background: "var(--surface-alt)", padding: "var(--space-3)", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>הפרש קופה</div>
                    <div style={{
                      fontSize: "1.1rem",
                      fontWeight: 700,
                      color: (selectedShift.cash_variance || 0) < 0 ? "#dc2626" : (selectedShift.cash_variance || 0) > 0 ? "#16a34a" : "inherit"
                    }}>
                      {formatILS(selectedShift.cash_variance)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Maala Integration & Export Section */}
              <div
                style={{
                  background: "var(--surface)",
                  padding: "var(--space-5)",
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border)",
                  marginBottom: "var(--space-5)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
                  <h4 style={{ margin: 0 }}>📊 ייצוא נתונים לתוכנת "מעלה" והנהלת חשבונות</h4>
                  {validation && (
                    <span
                      style={{
                        padding: "4px 12px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        background: validation.valid ? "#dcfce7" : "#fee2e2",
                        color: validation.valid ? "#15803d" : "#b91c1c",
                      }}
                    >
                      {validation.valid ? "✅ נתונים תקינים לשידור" : "⚠️ דרוש תיקון לפני שידור"}
                    </span>
                  )}
                </div>

                {/* Validation warnings / errors */}
                {validation && validation.errors.length > 0 && (
                  <div className="error-msg" style={{ marginBottom: "var(--space-3)" }}>
                    <strong>שגיאות הפוסלות קליטה במעלה:</strong>
                    <ul style={{ margin: "4px 0 0 16px" }}>
                      {validation.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {validation && validation.warnings.length > 0 && (
                  <div style={{ background: "#fef3c7", color: "#92400e", padding: "var(--space-3)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-3)" }}>
                    <strong>לתשומת לב:</strong>
                    <ul style={{ margin: "4px 0 0 16px" }}>
                      {validation.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Hash Totals Audit Box */}
                {validation && (
                  <div
                    style={{
                      background: "var(--surface-alt)",
                      padding: "var(--space-3)",
                      borderRadius: "var(--radius-md)",
                      marginBottom: "var(--space-4)",
                      fontSize: "0.875rem",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>דוח ביקורת בקרה (Audit Hash Totals):</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-2)" }}>
                      <div>סה"כ עסקאות: <strong>{validation.hash_totals.total_transactions}</strong></div>
                      <div>סה"כ מנות שנרשמו: <strong>{validation.hash_totals.total_items}</strong></div>
                      <div>חיוב תקציב חברים: <strong>{formatILS(validation.hash_totals.member_amount)}</strong></div>
                      <div>חיוב ענפי שכירים: <strong>{formatILS(validation.hash_totals.employee_amount)}</strong></div>
                      <div>חיוב אורחים: <strong>{formatILS(validation.hash_totals.guest_amount)}</strong></div>
                      <div>סה"כ שקלים לשידור: <strong>{formatILS(validation.hash_totals.total_amount)}</strong></div>
                    </div>
                  </div>
                )}

                {/* Download Actions */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
                  <button className="btn-primary" onClick={() => handleExport("maala")}>
                    📥 מעלה — פירוט תנועות (CSV)
                  </button>
                  <button className="btn-primary" onClick={() => handleExport("maala_summary")}>
                    📑 מעלה — סעיף מרוכז לחברים (CSV)
                  </button>
                  <button className="btn-secondary" onClick={() => handleExport("inbar")}>
                    📄 ענבר (Inbar)
                  </button>
                  <button className="btn-secondary" onClick={() => handleExport("csv")}>
                    📊 CSV גולמי
                  </button>
                </div>
              </div>

              {/* Kitchen Reconciliation Section (שיפור 2) */}
              <div
                style={{
                  background: "var(--surface)",
                  padding: "var(--space-5)",
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
                  <div>
                    <h4 style={{ margin: 0 }}>👨‍🍳 בקרת מטבח, פחת ועודפים בסוף משמרת</h4>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "2px" }}>
                      הזן את כמות המנות שנותרו (למחר) והפחת שנזרק לחישוב מדויק של נצילות המנות
                    </div>
                  </div>
                  <button className="btn-primary btn-small" onClick={handleSaveKitchen} disabled={savingKitchen}>
                    {savingKitchen ? "שומר..." : "💾 שמור בקרת פחת"}
                  </button>
                </div>

                {kitchenItems.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    אין נתוני מנות בתפריט של משמרת זו
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>שם מנה</th>
                        <th>הוכנו</th>
                        <th>נמכרו</th>
                        <th>עודפים (למחר)</th>
                        <th>פחת (נזרק)</th>
                        <th>הפרש לא מוסבר</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kitchenItems.map((item, idx) => (
                        <tr key={item.dish}>
                          <td><strong>{item.dish_name}</strong></td>
                          <td>{item.prepared_portions}</td>
                          <td>{item.sold_portions}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              style={{ width: "80px", padding: "4px" }}
                              value={item.leftover_portions}
                              onChange={(e) => handleKitchenChange(idx, "leftover_portions", Number(e.target.value))}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              style={{ width: "80px", padding: "4px" }}
                              value={item.waste_portions}
                              onChange={(e) => handleKitchenChange(idx, "waste_portions", Number(e.target.value))}
                            />
                          </td>
                          <td style={{
                            fontWeight: 700,
                            color: item.variance_portions !== 0 ? (item.variance_portions < 0 ? "#dc2626" : "#2563eb") : "#16a34a"
                          }}>
                            {item.variance_portions > 0 ? `+${item.variance_portions}` : item.variance_portions}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "var(--space-8)", color: "var(--text-muted)" }}>
              בחר משמרת מהרשימה לצפייה בפרטים וייצוא דוחות
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
