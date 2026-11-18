import frappe
from frappe import _
import frappe.utils
import frappe.realtime

from frappe.model.document import Document
from frappe.utils import get_datetime


TIER_MULTIPLIERS = {
    "Member": 1.0,
    "Employee": 2.0,
    "Guest": 3.0,
}


class Sale(Document):
    pass


@frappe.whitelist(allow_guest=True)
def checkout(idempotency_key, badge_id=None, identification_method=None, items=None):
    """
    Atomic POS checkout.

    Steps (all in one DB transaction):
    1. Idempotency check — if idempotency_key exists, return existing sale.
    2. Look up diner by badge_id (cache for <150ms target).
    3. For each item, lock the DailyMenuItem row, decrement balance_portions.
       Allow negative (soft-cap overdraft). Set was_overdraft flags.
    4. Snapshot unit_price at sale time (historical integrity).
    5. Create Sale + SaleItem records.
    6. Publish frappe.realtime events for signage update.

    items = [
        {"daily_menu_item": "...", "qty": 1},
        ...
    ]
    """
    if not idempotency_key:
        frappe.throw(_("Idempotency key is required"), frappe.ValidationError)

    existing = frappe.db.get_value("Sale", {"idempotency_key": idempotency_key}, "name")
    if existing:
        return {"sale": existing, "status": "duplicate"}

    items_data = frappe.parse_json(items) if isinstance(items, str) else (items or [])
    badge_id = (badge_id or "").strip()
    identification_method = identification_method or "Guest"

    if identification_method == "Guest":
        diner_type = "Guest"
        multiplier = TIER_MULTIPLIERS["Guest"]
        diner_name = "Guest"
        diner_ref = None
    else:
        diner = _lookup_diner(badge_id)
        if not diner:
            frappe.throw(_("Badge {0} not found").format(badge_id), frappe.ValidationError)
        diner_type = diner.diner_type
        multiplier = TIER_MULTIPLIERS.get(diner_type, 1.0)
        diner_name = diner.diner_name
        diner_ref = diner.name

    now = frappe.utils.now()
    today = frappe.utils.today()
    shift_type = _get_current_shift_type()
    daily_menu = _get_today_menu(shift_type)
    shift_ref = _ensure_shift(today, shift_type)

    sale_items = []
    was_overdraft_sale = False
    total_amount = 0.0

    for item in items_data:
        dmi_name = item.get("daily_menu_item")
        qty = item.get("qty", 1)

        dmi = frappe.get_doc("Daily Menu Item", dmi_name)

        if dmi.balance_portions is None:
            frappe.throw(_("Item not on today's menu"), frappe.ValidationError)

        balance_before = dmi.balance_portions
        was_overdraft_item = balance_before <= 0

        if was_overdraft_item:
            was_overdraft_sale = True

        new_balance = balance_before - qty

        dmi.db_set("sold_portions", dmi.sold_portions + qty)
        dmi.db_set("balance_portions", new_balance)

        if new_balance <= 0:
            new_status = "Sold Out / Overdraft"
        elif new_balance <= (dmi.prepared_portions * 0.2):
            new_status = "Low Stock"
        else:
            new_status = "Available"

        dmi.db_set("status", new_status)

        unit_price = _get_price_for_tier(dmi, diner_type)
        amount = round(unit_price * qty, 2)
        total_amount += amount

        sale_items.append({
            "doctype": "Sale Item",
            "daily_menu_item": dmi_name,
            "dish_name": dmi.dish,
            "qty": qty,
            "unit_price": unit_price,
            "amount": amount,
            "balance_at_sale": balance_before,
            "was_overdraft": was_overdraft_item,
        })

        _publish_item_update(dmi_name, new_balance, new_status)

    sale = frappe.get_doc({
        "doctype": "Sale",
        "diner": diner_ref,
        "diner_type": diner_type,
        "sale_date": now,
        "daily_menu": daily_menu,
        "shift": shift_type,
        "shift_ref": shift_ref,
        "items": sale_items,
        "total_amount": round(total_amount, 2),
        "was_overdraft_sale": was_overdraft_sale,
        "idempotency_key": idempotency_key,
        "identification_method": identification_method,
        "badge_id": badge_id,
        "status": "Completed",
    })
    sale.insert(ignore_permissions=True)

    return {
        "sale": sale.name,
        "diner_type": diner_type,
        "diner_name": diner_name,
        "total_amount": sale.total_amount,
        "was_overdraft_sale": was_overdraft_sale,
        "items": [{"dish": si.dish_name, "qty": si.qty, "amount": si.amount} for si in sale.items],
        "status": "completed",
    }


def _lookup_diner(badge_id):
    cached = frappe.cache.get_value(f"diner:{badge_id}")
    if cached:
        return frappe.get_doc("Diner", cached)

    diner_name = frappe.db.get_value(
        "Diner",
        {"badge_id": badge_id, "is_active": 1},
        "name"
    )
    if diner_name:
        frappe.cache.set_value(f"diner:{badge_id}", diner_name, expires_in_sec=300)
        return frappe.get_doc("Diner", diner_name)
    return None


def _get_price_for_tier(dmi, diner_type):
    if diner_type == "Member":
        return dmi.member_price or dmi.calculated_base_cost or 0
    elif diner_type == "Employee":
        return dmi.employee_price or (dmi.calculated_base_cost * 2) or 0
    else:
        return dmi.guest_price or (dmi.calculated_base_cost * 3) or 0


def _get_current_shift_type():
    hour = get_datetime(frappe.utils.now()).hour
    return "Lunch" if 6 <= hour < 15 else "Dinner"


def _get_today_menu(shift_type=None):
    today = frappe.utils.today()
    shift_type = shift_type or _get_current_shift_type()
    filters = {"menu_date": today, "shift": shift_type}
    menu = frappe.db.get_value("Daily Menu", filters, "name", as_dict=True)
    if not menu:
        # fallback: any published menu for today
        menu = frappe.db.get_value(
            "Daily Menu",
            {"menu_date": today, "status": "Published"},
            "name",
            as_dict=True,
            order_by="modified desc",
        )
    return menu.name if menu else None


def _ensure_shift(shift_date, shift_type):
    from kibbutz_dining.finance.doctype.shift.shift import ensure_shift_for_sale
    return ensure_shift_for_sale(shift_date, shift_type)


def _publish_item_update(dmi_name, balance_portions, status):
    # Publish to "website" room so Guest/public sockets (signage + POS) receive it.
    # Frappe joins every authenticated socket to the WEBSITE_ROOM ("website").
    frappe.realtime.publish_realtime(
        "item_update",
        {
            "daily_menu_item": dmi_name,
            "balance_portions": balance_portions,
            "status": status,
        },
        room="website",
        after_commit=True
    )
    if balance_portions <= 0:
        frappe.realtime.publish_realtime(
            "item_out_of_stock",
            {
                "daily_menu_item": dmi_name,
                "balance_portions": balance_portions,
            },
            room="website",
            after_commit=True
        )
