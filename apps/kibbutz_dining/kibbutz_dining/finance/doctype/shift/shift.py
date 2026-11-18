import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now, today, getdate, get_datetime


class Shift(Document):
    def validate(self):
        self._compute_cash_variance()

    def before_insert(self):
        if not self.opened_by:
            self.opened_by = frappe.session.user
        if not self.opened_at:
            self.opened_at = now()
        if self.status != "Open":
            self.status = "Open"
        if not self.daily_menu:
            self.daily_menu = _resolve_daily_menu(self.shift_date, self.shift_type)

    def _compute_cash_variance(self):
        opening = self.opening_cash or 0.0
        closing = self.closing_cash or 0.0
        self.expected_cash = opening + (self.total_sales or 0.0)
        self.cash_variance = round(closing - self.expected_cash, 2)


@frappe.whitelist(allow_guest=True)
def open_shift(shift_date=None, shift_type="Lunch", opening_cash=0.0):
    """Open a shift for the given date/type. Idempotent if already open."""
    shift_date = shift_date or today()
    name = f"{shift_date}-{shift_type}"

    if frappe.db.exists("Shift", name):
        shift = frappe.get_doc("Shift", name)
        if shift.status == "Closed":
            frappe.throw(_("Shift {0} is already closed").format(name))
        return {"shift": shift.name, "status": shift.status, "created": False}

    daily_menu = _resolve_daily_menu(shift_date, shift_type)
    shift = frappe.get_doc({
        "doctype": "Shift",
        "shift_date": shift_date,
        "shift_type": shift_type,
        "opening_cash": opening_cash,
        "daily_menu": daily_menu,
        "status": "Open",
    })
    shift.insert(ignore_permissions=True)
    _add_shift_log(shift.name, "Open", f"Shift opened with {opening_cash} ILS")
    return {"shift": shift.name, "status": shift.status, "created": True}


@frappe.whitelist(allow_guest=True)
def close_shift(shift=None, closing_cash=0.0, notes=""):
    """Close the shift, compute totals/variance, and lock further sales."""
    if not shift:
        shift = _get_current_open_shift()
    if not shift:
        frappe.throw(_("No open shift found"), frappe.DoesNotExistError)

    doc = frappe.get_doc("Shift", shift)
    if doc.status == "Closed":
        frappe.throw(_("Shift {0} is already closed").format(doc.name))

    summary = _summarize_shift_sales(doc.name)
    doc.closing_cash = closing_cash
    doc.total_sales = summary["total_sales"]
    doc.total_transactions = summary["total_transactions"]
    doc.overdraft_sales = summary["overdraft_sales"]
    doc.refund_total = summary["refund_total"]
    doc.closed_at = now()
    doc.closed_by = frappe.session.user
    doc.status = "Closed"
    doc.variance_report = notes or doc.variance_report
    doc._compute_cash_variance()
    doc.save(ignore_permissions=True)

    _add_shift_log(doc.name, "Close", f"Shift closed. Cash: {closing_cash}, Expected: {doc.expected_cash}, Variance: {doc.cash_variance}")

    return {
        "shift": doc.name,
        "status": doc.status,
        "total_sales": doc.total_sales,
        "total_transactions": doc.total_transactions,
        "overdraft_sales": doc.overdraft_sales,
        "opening_cash": doc.opening_cash,
        "closing_cash": doc.closing_cash,
        "expected_cash": doc.expected_cash,
        "cash_variance": doc.cash_variance,
    }


@frappe.whitelist(allow_guest=True)
def get_current_shift():
    """Return the currently open shift for today, if any."""
    name = _get_current_open_shift()
    if not name:
        return None
    return frappe.get_doc("Shift", name).as_dict()


@frappe.whitelist(allow_guest=True)
def get_shift_report(shift):
    """Full shift report with sales totals and item-level variance."""
    doc = frappe.get_doc("Shift", shift)
    summary = _summarize_shift_sales(doc.name)
    variance = _variance_by_item(doc.daily_menu, doc.shift_date, doc.shift_type)

    return {
        "shift": doc.name,
        "shift_date": str(doc.shift_date),
        "shift_type": doc.shift_type,
        "status": doc.status,
        "opened_at": str(doc.opened_at) if doc.opened_at else None,
        "closed_at": str(doc.closed_at) if doc.closed_at else None,
        "opening_cash": doc.opening_cash,
        "closing_cash": doc.closing_cash,
        "expected_cash": doc.expected_cash,
        "cash_variance": doc.cash_variance,
        "sales_summary": summary,
        "item_variance": variance,
    }


def _get_current_open_shift():
    """Best-effort current shift: open shift for today, current shift type."""
    now_dt = get_datetime(now())
    shift_type = "Lunch" if 6 <= now_dt.hour < 15 else "Dinner"
    name = f"{today()}-{shift_type}"
    if frappe.db.exists("Shift", name) and frappe.db.get_value("Shift", name, "status") == "Open":
        return name
    # fallback: any open shift for today
    return frappe.db.get_value(
        "Shift",
        {"shift_date": today(), "status": "Open"},
        "name",
        order_by="opened_at desc",
    )


def _resolve_daily_menu(shift_date, shift_type):
    return frappe.db.get_value(
        "Daily Menu",
        {"menu_date": shift_date, "shift": shift_type, "status": "Published"},
        "name",
    )


def _summarize_shift_sales(shift_name):
    result = frappe.db.sql(
        """
        SELECT
            COUNT(*) AS total_transactions,
            COALESCE(SUM(total_amount), 0) AS total_sales,
            SUM(CASE WHEN was_overdraft_sale = 1 THEN 1 ELSE 0 END) AS overdraft_sales,
            COALESCE(SUM(CASE WHEN status = 'Refunded' THEN total_amount ELSE 0 END), 0) AS refund_total
        FROM tabSale
        WHERE shift_ref = %s AND status != 'Cancelled'
        """,
        (shift_name,),
        as_dict=True,
    )[0]

    # Ensure Decimal/float conversion
    return {
        "total_transactions": int(result.total_transactions or 0),
        "total_sales": float(result.total_sales or 0),
        "overdraft_sales": int(result.overdraft_sales or 0),
        "refund_total": float(result.refund_total or 0),
    }


def _variance_by_item(daily_menu, shift_date, shift_type):
    """Compare prepared vs sold portions for each daily menu item."""
    if not daily_menu:
        return []

    items = frappe.get_all(
        "Daily Menu Item",
        filters={"parent": daily_menu, "parenttype": "Daily Menu", "parentfield": "items"},
        fields=[
            "name", "dish", "prepared_portions", "sold_portions",
            "balance_portions", "member_price", "employee_price", "guest_price",
            "calculated_base_cost", "status"
        ],
        order_by="idx asc",
    )

    # Revenue per item from completed sales
    revenue = {}
    rows = frappe.db.sql(
        """
        SELECT si.daily_menu_item, si.dish_name,
               SUM(si.qty) AS qty_sold,
               SUM(si.amount) AS revenue
        FROM `tabSale Item` si
        JOIN tabSale s ON s.name = si.parent
        WHERE s.daily_menu = %s AND s.status = 'Completed'
        GROUP BY si.daily_menu_item, si.dish_name
        """,
        (daily_menu,),
        as_dict=True,
    )
    for r in rows:
        revenue[r.daily_menu_item] = {
            "qty_sold": int(r.qty_sold or 0),
            "revenue": float(r.revenue or 0),
        }

    report = []
    for it in items:
        sold = int(it.sold_portions or 0)
        prepared = int(it.prepared_portions or 0)
        balance = int(it.balance_portions or 0)
        rev = revenue.get(it.name, {"qty_sold": 0, "revenue": 0.0})
        report.append({
            "daily_menu_item": it.name,
            "dish": it.dish_name or it.dish,
            "prepared_portions": prepared,
            "sold_portions": sold,
            "balance_portions": balance,
            "negative_overrun": max(0, -balance),
            "status": it.status,
            "revenue_ils": rev["revenue"],
            "member_price": float(it.member_price or 0),
            "employee_price": float(it.employee_price or 0),
            "guest_price": float(it.guest_price or 0),
        })
    return report


def _add_shift_log(shift_name, log_type, description, amount=None):
    shift = frappe.get_doc("Shift", shift_name)
    shift.append("logs", {
        "log_type": log_type,
        "description": description,
        "amount": amount,
        "user": frappe.session.user,
    })
    shift.save(ignore_permissions=True)


def ensure_shift_for_sale(shift_date, shift_type):
    """Called by POS checkout to auto-open a shift if one does not exist."""
    name = f"{shift_date}-{shift_type}"
    if frappe.db.exists("Shift", name):
        status = frappe.db.get_value("Shift", name, "status")
        if status == "Closed":
            # Inviolable rule: never block a sale. Re-open? Or just return closed shift?
            # For financial integrity we attach to closed shift but don't prevent sale.
            return name
        return name

    # Auto-open with zero opening cash
    result = open_shift(shift_date, shift_type, opening_cash=0.0)
    return result["shift"]
