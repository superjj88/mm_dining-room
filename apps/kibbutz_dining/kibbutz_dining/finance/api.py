import frappe
from frappe import _
import json
import csv
import io
from datetime import datetime

from kibbutz_dining.finance.doctype.shift.shift import (
    open_shift as _open_shift,
    close_shift as _close_shift,
    get_current_shift as _get_current_shift,
    get_shift_report as _get_shift_report,
)


@frappe.whitelist(allow_guest=True)
def open_shift(shift_date=None, shift_type="Lunch", opening_cash=0.0):
    return _open_shift(shift_date, shift_type, opening_cash)


@frappe.whitelist(allow_guest=True)
def close_shift(shift=None, closing_cash=0.0, notes=""):
    return _close_shift(shift, closing_cash, notes)


@frappe.whitelist(allow_guest=True)
def get_current_shift():
    return _get_current_shift()


@frappe.whitelist(allow_guest=True)
def get_shift_report(shift):
    return _get_shift_report(shift)


@frappe.whitelist(allow_guest=True)
def list_shifts(limit=50):
    """List recent shifts with summary fields for admin portal."""
    rows = frappe.db.get_all(
        "Shift",
        fields=[
            "name", "shift_date", "shift_type", "status",
            "opening_cash", "closing_cash", "expected_cash", "cash_variance",
            "total_sales", "total_transactions", "overdraft_sales",
            "opened_at", "closed_at", "variance_report"
        ],
        order_by="shift_date desc, creation desc",
        limit=limit,
    )
    for r in rows:
        r["shift_date"] = str(r["shift_date"])
        r["opened_at"] = str(r["opened_at"]) if r.get("opened_at") else None
        r["closed_at"] = str(r["closed_at"]) if r.get("closed_at") else None
    return rows


@frappe.whitelist(allow_guest=True)
def validate_shift_export(shift):
    """Validate shift sales before sending to Maala / ERP."""
    doc = frappe.get_doc("Shift", shift)
    lines = _get_sale_lines(doc.name)

    errors = []
    warnings = []
    missing_maala_diners = set()

    unique_sales = set(line["sale_id"] for line in lines)
    total_transactions = len(unique_sales)
    total_items = sum(line["qty"] for line in lines)
    total_amount = round(sum(line["amount"] for line in lines), 2)
    member_amount = round(sum(line["amount"] for line in lines if line["diner_type"] == "Member"), 2)
    employee_amount = round(sum(line["amount"] for line in lines if line["diner_type"] == "Employee"), 2)
    guest_amount = round(sum(line["amount"] for line in lines if line["diner_type"] == "Guest"), 2)
    cash_amount = round(sum(line["amount"] for line in lines if line["payment_method"] == "Cash"), 2)
    credit_amount = round(sum(line["amount"] for line in lines if line["payment_method"] == "Credit Card"), 2)

    for line in lines:
        if line["diner_type"] in ("Member", "Employee"):
            mid = (line.get("maala_member_id") or "").strip()
            if not mid:
                missing_maala_diners.add(f"{line.get('diner_name', 'ללא שם')} ({line.get('badge_id', '—')})")

    if missing_maala_diners:
        sample_missing = ", ".join(sorted(list(missing_maala_diners))[:3])
        errors.append(f"נמצאו {len(missing_maala_diners)} סועדים ללא מספר תקציב/חבר במעלה: {sample_missing}")

    if total_transactions == 0:
        warnings.append("אין עסקאות שהושלמו במשמרת זו")

    if doc.status == "Open":
        warnings.append("המשמרת עדיין פתוחה — מומלץ לסגור את המשמרת לפני שידור דוח סופי למעלה")

    if doc.cash_variance and abs(float(doc.cash_variance)) > 0.01:
        warnings.append(f"קיים הפרש קופה של ₪{float(doc.cash_variance):.2f} במשמרת זו")

    return {
        "valid": len(errors) == 0,
        "shift": doc.name,
        "errors": errors,
        "warnings": warnings,
        "missing_maala_diners": sorted(list(missing_maala_diners)),
        "hash_totals": {
            "total_transactions": total_transactions,
            "total_items": total_items,
            "total_amount": total_amount,
            "member_amount": member_amount,
            "employee_amount": employee_amount,
            "guest_amount": guest_amount,
            "cash_amount": cash_amount,
            "credit_amount": credit_amount,
            "missing_ids_count": len(missing_maala_diners),
        }
    }


@frappe.whitelist(allow_guest=True)
def save_kitchen_reconciliation(shift, items):
    """Save leftover and waste portions for kitchen end-of-shift reconciliation."""
    if isinstance(items, str):
        items = json.loads(items)

    doc = frappe.get_doc("Shift", shift)
    reconciled_data = {
        "saved_at": frappe.utils.now(),
        "user": frappe.session.user,
        "items": items,
    }
    doc.variance_report = json.dumps(reconciled_data, ensure_ascii=False)
    doc.save(ignore_permissions=True)
    return {"ok": True, "shift": doc.name}


@frappe.whitelist(allow_guest=True)
def export_shift(shift, format="csv"):
    """Export shift data for Kibbutz accounting systems.

    Supported formats:
    - csv: generic line-item CSV
    - json: generic structured JSON
    - inbar: Inbar-compatible CSV
    - maala: Ma'ala-compatible line-item CSV
    - maala_summary: Ma'ala-compatible aggregated member CSV
    - boss: Boss-compatible CSV
    """
    doc = frappe.get_doc("Shift", shift)
    sale_lines = _get_sale_lines(doc.name)

    if format == "json":
        data = {
            "shift": doc.name,
            "shift_date": str(doc.shift_date),
            "shift_type": doc.shift_type,
            "total_sales": float(doc.total_sales or 0),
            "total_transactions": int(doc.total_transactions or 0),
            "opening_cash": float(doc.opening_cash or 0),
            "closing_cash": float(doc.closing_cash or 0),
            "cash_variance": float(doc.cash_variance or 0),
            "sales": sale_lines,
        }
        return {"filename": f"{doc.name}.json", "content": json.dumps(data, ensure_ascii=False, indent=2), "mimetype": "application/json"}

    if format == "csv":
        return _to_csv(sale_lines, doc.name)

    if format == "inbar":
        return _to_inbar(sale_lines, doc)

    if format == "maala":
        return _to_maala(sale_lines, doc)

    if format == "maala_summary":
        return _to_maala_summary(sale_lines, doc)

    if format == "boss":
        return _to_boss(sale_lines, doc)

    frappe.throw(_("Unsupported export format: {0}").format(format), frappe.ValidationError)


def _get_sale_lines(shift_name):
    rows = frappe.db.sql(
        """
        SELECT
            s.name AS sale_id,
            s.sale_date,
            s.diner,
            s.diner_type,
            s.badge_id,
            s.total_amount,
            s.was_overdraft_sale,
            s.payment_method,
            s.identification_method,
            d.diner_name,
            d.maala_member_id,
            d.cost_center,
            d.employee_id,
            si.daily_menu_item,
            si.dish_name,
            si.qty,
            si.unit_price,
            si.amount,
            si.balance_at_sale,
            si.was_overdraft
        FROM tabSale s
        JOIN `tabSale Item` si ON si.parent = s.name
        LEFT JOIN `tabDiner` d ON d.name = s.diner
        WHERE s.shift_ref = %s AND s.status = 'Completed'
        ORDER BY s.sale_date, s.name
        """,
        (shift_name,),
        as_dict=True,
    )

    lines = []
    for r in rows:
        lines.append({
            "sale_id": r.sale_id,
            "timestamp": r.sale_date.isoformat() if isinstance(r.sale_date, datetime) else str(r.sale_date),
            "diner_type": r.diner_type,
            "badge_id": r.badge_id,
            "diner_name": r.diner_name or r.diner_type,
            "maala_member_id": r.maala_member_id or r.badge_id or "",
            "cost_center": r.cost_center or "",
            "employee_id": r.employee_id or "",
            "payment_method": r.payment_method or "Cash",
            "identification_method": r.identification_method,
            "daily_menu_item": r.daily_menu_item,
            "dish_name": r.dish_name,
            "qty": int(r.qty or 0),
            "unit_price": float(r.unit_price or 0),
            "amount": float(r.amount or 0),
            "was_overdraft": 1 if r.was_overdraft else 0,
            "sale_overdraft": 1 if r.was_overdraft_sale else 0,
            "balance_at_sale": int(r.balance_at_sale or 0),
        })
    return lines


def _to_csv(lines, shift_name):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "sale_id", "timestamp", "diner_type", "badge_id", "maala_member_id", "diner_name",
        "payment_method", "identification_method", "daily_menu_item", "dish_name",
        "qty", "unit_price", "amount", "was_overdraft", "balance_at_sale"
    ])
    for line in lines:
        writer.writerow([
            line["sale_id"], line["timestamp"], line["diner_type"], line.get("badge_id"),
            line.get("maala_member_id"), line.get("diner_name"), line["payment_method"],
            line["identification_method"], line["daily_menu_item"], line["dish_name"],
            line["qty"], line["unit_price"], line["amount"],
            line["was_overdraft"], line["balance_at_sale"]
        ])
    return {"filename": f"{shift_name}.csv", "content": output.getvalue(), "mimetype": "text/csv"}


def _to_inbar(lines, doc):
    """Inbar-style batch: one line per sale with aggregated total."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["date", "shift", "reference", "member_id", "diner_type", "total", "payment_method", "description"])
    
    sales = {}
    for line in lines:
        sid = line["sale_id"]
        if sid not in sales:
            sales[sid] = {
                "diner_type": line["diner_type"],
                "member_id": line.get("maala_member_id") or line.get("badge_id") or "",
                "total": 0.0,
                "payment_method": line["payment_method"],
            }
        sales[sid]["total"] += line["amount"]

    for sid, s in sales.items():
        writer.writerow([
            str(doc.shift_date),
            doc.shift_type,
            sid,
            s["member_id"],
            s["diner_type"],
            round(s["total"], 2),
            s["payment_method"],
            "Dining hall sale"
        ])
    return {"filename": f"{doc.name}_inbar.csv", "content": output.getvalue(), "mimetype": "text/csv"}


def _to_maala(lines, doc):
    """Ma'ala-style batch: line-item detail with Hebrew descriptions & member budget IDs."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "תאריך",
        "שעה",
        "קוד תקציב/חבר במעלה",
        "שם סועד",
        "סוג לקוח",
        "ענף חדר אוכל",
        "ענף סועד/מחלקה",
        "אסמכתא/עסקה",
        "מנה",
        "כמות",
        "מחיר יחידה",
        "סכום לתשלום",
        "שיטת תשלום",
        "קוד תנועה במעלה",
    ])
    for line in lines:
        d_type = line["diner_type"]
        trx_code = "50-חיוב תקציב אישי" if d_type == "Member" else ("60-חיוב ענף" if d_type == "Employee" else "10-קופת אורחים")
        dining_branch = "310"
        diner_branch = line.get("cost_center") or ("חברים" if d_type == "Member" else "כללי")
        member_id = line.get("maala_member_id") or line.get("badge_id") or ("אורח" if d_type == "Guest" else "")
        time_part = line["timestamp"].split("T")[1][:5] if "T" in line["timestamp"] else ""

        writer.writerow([
            str(doc.shift_date),
            time_part,
            member_id,
            line.get("diner_name") or d_type,
            "חבר" if d_type == "Member" else ("עובד" if d_type == "Employee" else "אורח"),
            dining_branch,
            diner_branch,
            line["sale_id"],
            line["dish_name"],
            line["qty"],
            line["unit_price"],
            line["amount"],
            line["payment_method"],
            trx_code,
        ])
    return {"filename": f"{doc.name}_maala_detail.csv", "content": output.getvalue(), "mimetype": "text/csv; charset=utf-8"}


def _to_maala_summary(lines, doc):
    """Ma'ala-style batch: aggregated journal entry per member/employee."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "תאריך",
        "קוד תקציב/חבר במעלה",
        "שם סועד",
        "סוג לקוח",
        "ענף סועד/מחלקה",
        "ענף חדר אוכל",
        "מספר עסקאות",
        "סך מנות",
        "סכום כולל לתשלום",
        "קוד תנועה במעלה",
        "אסמכתא",
    ])

    grouped = {}
    for line in lines:
        d_type = line["diner_type"]
        member_id = line.get("maala_member_id") or line.get("badge_id") or ("אורח" if d_type == "Guest" else "")
        cost_center = line.get("cost_center") or ("חברים" if d_type == "Member" else "כללי")
        name = line.get("diner_name") or d_type
        key = (member_id, d_type, cost_center, name)

        if key not in grouped:
            grouped[key] = {
                "transactions": set(),
                "items_count": 0,
                "total_amount": 0.0,
            }
        grouped[key]["transactions"].add(line["sale_id"])
        grouped[key]["items_count"] += line["qty"]
        grouped[key]["total_amount"] += line["amount"]

    for (member_id, d_type, cost_center, name), data in sorted(grouped.items(), key=lambda x: str(x[0][0])):
        trx_code = "50-חיוב תקציב אישי" if d_type == "Member" else ("60-חיוב ענף" if d_type == "Employee" else "10-קופת אורחים")
        writer.writerow([
            str(doc.shift_date),
            member_id,
            name,
            "חבר" if d_type == "Member" else ("עובד" if d_type == "Employee" else "אורח"),
            cost_center,
            "310",
            len(data["transactions"]),
            data["items_count"],
            round(data["total_amount"], 2),
            trx_code,
            doc.name,
        ])
    return {"filename": f"{doc.name}_maala_summary.csv", "content": output.getvalue(), "mimetype": "text/csv; charset=utf-8"}


def _to_boss(lines, doc):
    """Boss-style batch: summary per diner type."""
    totals = {}
    counts = {}
    for line in lines:
        d_type = line["diner_type"]
        totals[d_type] = totals.get(d_type, 0.0) + line["amount"]
        counts[d_type] = counts.get(d_type, 0) + 1

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["date", "shift", "diner_type", "total_amount", "transaction_count"])
    for diner_type, total in totals.items():
        writer.writerow([str(doc.shift_date), doc.shift_type, diner_type, round(total, 2), counts.get(diner_type, 0)])
    return {"filename": f"{doc.name}_boss.csv", "content": output.getvalue(), "mimetype": "text/csv"}
