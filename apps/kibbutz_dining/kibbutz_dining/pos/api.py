import frappe
from frappe import _


TIER_MULTIPLIERS = {
    "Member": 1.0,
    "Employee": 2.0,
    "Guest": 3.0,
}


@frappe.whitelist(allow_guest=True)
def list_diners(search: str = None, diner_type: str = None):
    """
    Return active diners for the POS identify screen.
    Supports filtering by diner_type (Member/Employee/Guest) and a search term
    that matches badge_id or diner_name. Tier multiplier is computed server-side.
    Target: < 150ms.
    """
    params = []
    conditions = ["is_active = 1"]

    if diner_type:
        conditions.append("diner_type = %s")
        params.append(diner_type)

    if search and search.strip():
        term = f"%{search.strip()}%"
        conditions.append("(badge_id LIKE %s OR diner_name LIKE %s)")
        params.extend([term, term])

    where_clause = " AND ".join(conditions)
    rows = frappe.db.sql(
        f"""
            SELECT name, badge_id, diner_name, diner_type, is_active
            FROM `tabDiner`
            WHERE {where_clause}
            ORDER BY diner_name ASC, badge_id ASC
            LIMIT 200
        """,
        tuple(params),
        as_dict=True,
    )

    for r in rows:
        r["tier_multiplier"] = TIER_MULTIPLIERS.get(r.diner_type, 1.0)

    return rows


@frappe.whitelist(allow_guest=True)
def lookup_diner(badge_id: str):
    """
    Lookup a diner by badge_id. Returns diner info or None.
    Target: < 150ms RFID lookup.
    """
    if not badge_id:
        return None

    cached = frappe.cache.get_value(f"diner:{badge_id}")
    if cached:
        return cached

    d = frappe.db.get_value(
        "Diner",
        {"badge_id": badge_id, "is_active": 1},
        ["name", "badge_id", "diner_name", "diner_type", "tier_multiplier"],
        as_dict=True
    )

    if d:
        result = {
            "name": d.name,
            "badge_id": d.badge_id,
            "diner_name": d.diner_name,
            "diner_type": d.diner_type,
            "tier_multiplier": d.tier_multiplier,
        }
        frappe.cache.set_value(f"diner:{badge_id}", result, expires_in_sec=300)
        return result

    return None


@frappe.whitelist(allow_guest=True)
def get_today_menu():
    """
    Returns today's DailyMenu with items for the current shift.
    Falls back to any menu today, then most recent published menu.
    """
    today = frappe.utils.today()
    now_hour = frappe.utils.now_datetime().hour
    current_shift = "Lunch" if 6 <= now_hour < 15 else "Dinner"

    menu_name = frappe.db.get_value(
        "Daily Menu",
        {"menu_date": today, "shift": current_shift, "status": ("in", ["Draft", "Published"])},
        "name",
    )

    if not menu_name:
        menu_name = frappe.db.get_value(
            "Daily Menu",
            {"menu_date": today, "status": ("in", ["Draft", "Published"])},
            "name",
            order_by="modified desc",
        )

    if not menu_name:
        menu_name = frappe.db.get_value(
            "Daily Menu",
            {"status": "Published"},
            "name",
            order_by="menu_date desc"
        )

    if not menu_name:
        return None

    menu = frappe.get_doc("Daily Menu", menu_name)
    return {
        "name": menu.name,
        "menu_date": menu.menu_date,
        "shift": menu.shift,
        "status": menu.status,
        "items": [
            {
                "name": i.name,
                "dish": i.dish,
                "calculated_base_cost": i.calculated_base_cost,
                "member_price": i.member_price,
                "employee_price": i.employee_price,
                "guest_price": i.guest_price,
                "prepared_portions": i.prepared_portions,
                "sold_portions": i.sold_portions,
                "balance_portions": i.balance_portions,
                "status": i.status,
                "sort_order": i.sort_order,
            }
            for i in menu.items
        ],
    }


@frappe.whitelist(allow_guest=True)
def get_diner_types():
    return [
        {"value": "Member", "label": "חבר", "multiplier": 1.0},
        {"value": "Employee", "label": "עובד", "multiplier": 2.0},
        {"value": "Guest", "label": "אורח", "multiplier": 3.0},
    ]


@frappe.whitelist(allow_guest=True)
def checkout(idempotency_key, badge_id=None, identification_method="Guest", items=None):
    from kibbutz_dining.pos.doctype.sale.sale import checkout as atomic_checkout
    return atomic_checkout(idempotency_key, badge_id, identification_method, items)
