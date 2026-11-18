import frappe
from frappe import _
from frappe.auth import LoginManager

from kibbutz_dining.finance.doctype.shift.shift import (
    open_shift as _open_shift,
    close_shift as _close_shift,
    get_current_shift as _get_current_shift,
    get_shift_report as _get_shift_report,
)
from kibbutz_dining.finance.api import (
    list_shifts as _list_shifts,
    validate_shift_export as _validate_shift_export,
    export_shift as _export_shift,
    save_kitchen_reconciliation as _save_kitchen_reconciliation,
)
from kibbutz_dining.menu.doctype.menu_item.menu_item import recalc_base_cost


TIER_MULTIPLIERS = {
    "Member": 1.0,
    "Employee": 2.0,
    "Guest": 3.0,
}


def _check_manager():
    """Ensure current user is a Dining Manager or System Manager."""
    roles = frappe.get_roles(frappe.session.user)
    if "Dining Manager" not in roles and "System Manager" not in roles:
        raise frappe.PermissionError


def _serialize_diner(d):
    return {
        "name": d.name,
        "badge_id": d.badge_id,
        "diner_name": d.diner_name,
        "diner_type": d.diner_type,
        "employee_id": d.employee_id,
        "maala_member_id": getattr(d, "maala_member_id", None) or d.badge_id,
        "cost_center": getattr(d, "cost_center", None),
        "billing_notes": getattr(d, "billing_notes", None),
        "is_active": d.is_active,
        "tier_multiplier": TIER_MULTIPLIERS.get(d.diner_type, 1.0),
    }


@frappe.whitelist(allow_guest=True)
def login(usr, pwd):
    """Authenticate and start a Frappe session. Returns user + roles."""
    lm = LoginManager()
    lm.authenticate(usr, pwd)
    lm.post_login()
    return get_session()


@frappe.whitelist()
def get_session():
    """Return current user and roles."""
    user = frappe.session.user
    return {
        "user": user,
        "roles": frappe.get_roles(user),
    }


@frappe.whitelist()
def logout():
    """Logout current user."""
    frappe.local.login_manager.logout()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────
# Diners
# ─────────────────────────────────────────────────────────────

@frappe.whitelist()
def list_diners():
    _check_manager()
    rows = frappe.db.get_all(
        "Diner",
        fields=["name", "badge_id", "diner_name", "diner_type", "employee_id", "maala_member_id", "cost_center", "billing_notes", "is_active"],
        order_by="modified desc",
    )
    return [_serialize_diner(r) for r in rows]


@frappe.whitelist()
def create_diner(badge_id, diner_name, diner_type, employee_id=None, maala_member_id=None, cost_center=None, billing_notes=None, is_active=1):
    _check_manager()
    if not badge_id:
        frappe.throw(_("Badge ID is required"))
    if frappe.db.exists("Diner", {"badge_id": badge_id}):
        frappe.throw(_("Badge ID {0} already exists").format(badge_id))
    if diner_type not in TIER_MULTIPLIERS:
        frappe.throw(_("Invalid diner type: {0}").format(diner_type))

    doc = frappe.get_doc({
        "doctype": "Diner",
        "badge_id": badge_id,
        "diner_name": diner_name,
        "diner_type": diner_type,
        "employee_id": employee_id,
        "maala_member_id": maala_member_id or badge_id,
        "cost_center": cost_center,
        "billing_notes": billing_notes,
        "is_active": is_active,
        "tier_multiplier": TIER_MULTIPLIERS[diner_type],
    })
    doc.insert(ignore_permissions=True)
    return _serialize_diner(doc)


@frappe.whitelist()
def update_diner(name, badge_id=None, diner_name=None, diner_type=None, employee_id=None, maala_member_id=None, cost_center=None, billing_notes=None, is_active=None):
    _check_manager()
    doc = frappe.get_doc("Diner", name)
    if badge_id is not None and badge_id != doc.badge_id:
        if frappe.db.exists("Diner", {"badge_id": badge_id, "name": ("!=", name)}):
            frappe.throw(_("Badge ID {0} already exists").format(badge_id))
        frappe.rename_doc("Diner", doc.name, badge_id, force=True)
        doc = frappe.get_doc("Diner", badge_id)
    if diner_name is not None:
        doc.diner_name = diner_name
    if diner_type is not None:
        if diner_type not in TIER_MULTIPLIERS:
            frappe.throw(_("Invalid diner type: {0}").format(diner_type))
        doc.diner_type = diner_type
        doc.tier_multiplier = TIER_MULTIPLIERS[diner_type]
    if employee_id is not None:
        doc.employee_id = employee_id
    if maala_member_id is not None:
        doc.maala_member_id = maala_member_id
    if cost_center is not None:
        doc.cost_center = cost_center
    if billing_notes is not None:
        doc.billing_notes = billing_notes
    if is_active is not None:
        doc.is_active = is_active
    doc.save(ignore_permissions=True)
    return _serialize_diner(doc)


@frappe.whitelist()
def delete_diner(name):
    """Delete a diner, or deactivate if they have sales history."""
    _check_manager()
    if not frappe.db.exists("Diner", name):
        frappe.throw(_("Diner {0} not found").format(name))
    if frappe.db.exists("Sale", {"diner": name}):
        doc = frappe.get_doc("Diner", name)
        doc.is_active = 0
        doc.save(ignore_permissions=True)
        return {"deleted": False, "deactivated": True, "name": name}
    frappe.delete_doc("Diner", name, force=True, ignore_permissions=True)
    return {"deleted": True, "deactivated": False, "name": name}


# ─────────────────────────────────────────────────────────────
# Procurement (Raw Items)
# ─────────────────────────────────────────────────────────────

def _raw_item_usage(name):
    """Return (in_history, in_recipes) usage flags for a Raw Item."""
    in_history = bool(frappe.db.exists("Raw Item Price History", {"raw_item": name}))
    in_recipes = bool(frappe.db.exists("Menu Item Ingredient", {"raw_item": name}))
    return in_history, in_recipes


def _supplier_labels(supplier_ids):
    ids = [s for s in supplier_ids if s]
    if not ids:
        return {}
    rows = frappe.get_all(
        "Supplier", filters={"name": ("in", ids)}, fields=["name", "supplier_name"]
    )
    return {r.name: r.supplier_name for r in rows}


@frappe.whitelist()
def list_raw_items():
    _check_manager()
    rows = frappe.db.get_all(
        "Raw Item",
        fields=["name", "item_name", "uom", "current_rate", "category", "supplier", "is_active"],
        order_by="item_name asc",
    )
    # Latest price update per raw item (date + rate)
    history = frappe.db.sql(
        """
        SELECT p.raw_item,
               p.purchase_date AS last_price_update,
               p.rate_per_uom AS last_rate
        FROM `tabRaw Item Price History` p
        JOIN (
            SELECT raw_item, MAX(creation) AS max_creation
            FROM `tabRaw Item Price History`
            GROUP BY raw_item
        ) latest ON latest.raw_item = p.raw_item AND latest.max_creation = p.creation
        """,
        as_dict=True,
    )
    latest = {h.raw_item: h for h in history}
    suppliers = _supplier_labels([r.supplier for r in rows])
    for r in rows:
        h = latest.get(r.name)
        r["last_price_update"] = h.last_price_update if h else None
        r["last_rate"] = h.last_rate if h else None
        r["supplier_name"] = suppliers.get(r.supplier)
    return rows


@frappe.whitelist()
def update_raw_rate(raw_item, rate_per_uom, note=""):
    _check_manager()
    if not frappe.db.exists("Raw Item", raw_item):
        frappe.throw(_("Raw Item {0} not found").format(raw_item))
    rate = float(rate_per_uom)
    uom = frappe.db.get_value("Raw Item", raw_item, "uom") or "Kg"
    doc = frappe.get_doc({
        "doctype": "Raw Item Price History",
        "raw_item": raw_item,
        "rate_per_uom": rate,
        "uom": uom,
        "purchase_date": frappe.utils.today(),
        "notes": note,
    })
    doc.insert(ignore_permissions=True)
    return {"price_history": doc.name, "raw_item": raw_item, "rate_per_uom": rate}


@frappe.whitelist()
def create_raw_item(item_name, uom, current_rate=0.0, category="Other", supplier=None):
    _check_manager()
    if frappe.db.exists("Raw Item", {"item_name": item_name}):
        frappe.throw(_("Raw Item {0} already exists").format(item_name))
    doc = frappe.get_doc({
        "doctype": "Raw Item",
        "item_name": item_name,
        "uom": uom,
        "current_rate": current_rate,
        "category": category,
        "supplier": supplier or None,
        "is_active": 1,
    })
    doc.insert(ignore_permissions=True)
    return {
        "name": doc.name,
        "item_name": doc.item_name,
        "uom": doc.uom,
        "current_rate": doc.current_rate,
        "supplier": doc.supplier,
    }


@frappe.whitelist()
def update_raw_item(name, supplier=None, category=None, is_active=None, uom=None):
    _check_manager()
    doc = frappe.get_doc("Raw Item", name)
    if supplier is not None:
        doc.supplier = supplier or None
    if category is not None:
        doc.category = category
    if is_active is not None:
        doc.is_active = int(is_active)
    if uom is not None:
        doc.uom = uom
    doc.save(ignore_permissions=True)
    return {
        "name": doc.name,
        "item_name": doc.item_name,
        "supplier": doc.supplier,
        "category": doc.category,
        "is_active": doc.is_active,
    }


@frappe.whitelist()
def delete_raw_item(name):
    """Delete a raw item, or deactivate it if referenced by history/recipes."""
    _check_manager()
    if not frappe.db.exists("Raw Item", name):
        frappe.throw(_("Raw Item {0} not found").format(name))
    in_history, in_recipes = _raw_item_usage(name)
    if in_history or in_recipes:
        doc = frappe.get_doc("Raw Item", name)
        doc.is_active = 0
        doc.save(ignore_permissions=True)
        return {"deleted": False, "deactivated": True, "name": name}
    frappe.delete_doc("Raw Item", name, force=True, ignore_permissions=True)
    return {"deleted": True, "deactivated": False, "name": name}


@frappe.whitelist()
def list_suppliers():
    _check_manager()
    return frappe.get_all(
        "Supplier",
        filters={"disabled": 0},
        fields=["name", "supplier_name", "supplier_group"],
        order_by="supplier_name asc",
    )


# ─────────────────────────────────────────────────────────────
# Recipes / Menu Items
# ─────────────────────────────────────────────────────────────

def _serialize_ingredient(ing):
    return {
        "raw_item_name": ing.raw_item,
        "raw_item_label": frappe.db.get_value("Raw Item", ing.raw_item, "item_name") if ing.raw_item else None,
        "qty": ing.qty,
        "uom": ing.uom,
        "wastage_percent": ing.wastage_percent or 0,
        "cost": ing.cost or 0,
    }


def _serialize_menu_item(doc):
    return {
        "name": doc.name,
        "dish_name": doc.item_name,
        "is_active": doc.is_active,
        "calculated_base_cost": doc.calculated_base_cost or 0,
        "category": doc.category,
        "yield_portions": doc.yield_portions,
        "packaging_cost": getattr(doc, "packaging_cost", 0.0) or 0.0,
        "last_cost_update": doc.last_cost_update,
        "ingredients": [_serialize_ingredient(i) for i in doc.ingredients],
    }


def _menu_item_usage(name):
    """A Menu Item is 'used' once it appears on any daily menu."""
    return bool(frappe.db.exists("Daily Menu Item", {"dish": name}))


@frappe.whitelist()
def delete_menu_item(name):
    """Delete a dish, or deactivate it if it was ever placed on a daily menu."""
    _check_manager()
    if not frappe.db.exists("Menu Item", name):
        frappe.throw(_("Menu Item {0} not found").format(name))
    if _menu_item_usage(name):
        doc = frappe.get_doc("Menu Item", name)
        doc.is_active = 0
        doc.save(ignore_permissions=True)
        return {"deleted": False, "deactivated": True, "name": name}
    frappe.delete_doc("Menu Item", name, force=True, ignore_permissions=True)
    return {"deleted": True, "deactivated": False, "name": name}


@frappe.whitelist()
def list_menu_items():
    _check_manager()
    docs = frappe.get_all("Menu Item", fields=["name"], order_by="item_name asc")
    return [_serialize_menu_item(frappe.get_doc("Menu Item", d.name)) for d in docs]


def _build_ingredient_rows(ingredients):
    rows = []
    for ing in ingredients:
        raw_item = ing.get("raw_item_name") or ing.get("raw_item")
        if not raw_item:
            continue
        if not frappe.db.exists("Raw Item", raw_item):
            frappe.throw(_("Raw Item {0} not found").format(raw_item))
        uom = ing.get("uom") or frappe.db.get_value("Raw Item", raw_item, "uom") or "Kg"
        rows.append({
            "raw_item": raw_item,
            "qty": float(ing.get("qty", 0)),
            "uom": uom,
            "wastage_percent": float(ing.get("wastage_percent", 0) or 0),
        })
    return rows


@frappe.whitelist()
def create_menu_item(dish_name, is_active=1, ingredients=None, category="Main Course", yield_portions=1, packaging_cost=0.0):
    _check_manager()
    if frappe.db.exists("Menu Item", {"item_name": dish_name}):
        frappe.throw(_("Menu Item {0} already exists").format(dish_name))
    ingredients = ingredients or []
    doc = frappe.get_doc({
        "doctype": "Menu Item",
        "item_name": dish_name,
        "is_active": is_active,
        "category": category,
        "yield_portions": yield_portions,
        "packaging_cost": float(packaging_cost or 0.0),
        "ingredients": _build_ingredient_rows(ingredients),
    })
    doc.insert(ignore_permissions=True)
    recalc_base_cost(doc)
    doc.reload()
    return _serialize_menu_item(doc)


@frappe.whitelist()
def update_menu_item(name, dish_name=None, is_active=None, ingredients=None, category=None, yield_portions=None, packaging_cost=None):
    _check_manager()
    doc = frappe.get_doc("Menu Item", name)
    if dish_name is not None and dish_name != doc.item_name:
        if frappe.db.exists("Menu Item", {"item_name": dish_name, "name": ("!=", name)}):
            frappe.throw(_("Menu Item {0} already exists").format(dish_name))
        frappe.rename_doc("Menu Item", doc.name, dish_name, force=True)
        doc = frappe.get_doc("Menu Item", dish_name)
    if is_active is not None:
        doc.is_active = is_active
    if category is not None:
        doc.category = category
    if yield_portions is not None:
        doc.yield_portions = yield_portions
    if packaging_cost is not None:
        doc.packaging_cost = float(packaging_cost or 0.0)
    if ingredients is not None:
        doc.set("ingredients", [])
        for row in _build_ingredient_rows(ingredients):
            doc.append("ingredients", row)
    doc.save(ignore_permissions=True)
    recalc_base_cost(doc)
    doc.reload()
    return _serialize_menu_item(doc)


# ─────────────────────────────────────────────────────────────
# Daily Menus
# ─────────────────────────────────────────────────────────────

def _menu_item_status(balance, prepared):
    if balance <= 0:
        return "Sold Out / Overdraft"
    if prepared and balance <= prepared * 0.2:
        return "Low Stock"
    return "Available"


@frappe.whitelist()
def list_daily_menus():
    _check_manager()
    rows = frappe.db.get_all(
        "Daily Menu",
        fields=["name", "menu_date", "shift", "status"],
        order_by="menu_date desc, shift asc",
    )
    counts = frappe.db.sql(
        "SELECT parent, COUNT(*) AS c FROM `tabDaily Menu Item` GROUP BY parent",
        as_dict=True,
    )
    count_map = {c.parent: c.c for c in counts}
    for r in rows:
        r["item_count"] = count_map.get(r.name, 0)
    return rows


@frappe.whitelist()
def get_daily_menu(name):
    _check_manager()
    doc = frappe.get_doc("Daily Menu", name)
    return {
        "name": doc.name,
        "menu_date": doc.menu_date,
        "shift": doc.shift,
        "status": doc.status,
        "items": [{
            "name": i.name,
            "dish": i.dish,
            "calculated_base_cost": i.calculated_base_cost or 0,
            "member_price": i.member_price or 0,
            "employee_price": i.employee_price or 0,
            "guest_price": i.guest_price or 0,
            "prepared_portions": i.prepared_portions or 0,
            "sold_portions": i.sold_portions or 0,
            "balance_portions": i.balance_portions or 0,
            "status": i.status,
            "sort_order": i.sort_order or 0,
        } for i in doc.items],
    }


@frappe.whitelist()
def create_daily_menu(menu_date, shift):
    _check_manager()
    if shift not in ("Lunch", "Dinner"):
        frappe.throw(_("Shift must be Lunch or Dinner"))
    name = f"{menu_date}-{shift}"
    if frappe.db.exists("Daily Menu", name):
        frappe.throw(_("Daily Menu {0} already exists").format(name))
    doc = frappe.get_doc({
        "doctype": "Daily Menu",
        "menu_date": menu_date,
        "shift": shift,
        "status": "Draft",
    })
    doc.insert(ignore_permissions=True)
    return {"name": doc.name, "menu_date": doc.menu_date, "shift": doc.shift, "status": doc.status}


@frappe.whitelist()
def add_daily_menu_item(parent, dish, prepared_portions, sort_order=0):
    _check_manager()
    menu = frappe.get_doc("Daily Menu", parent)
    if menu.status == "Closed":
        frappe.throw(_("Cannot edit a closed daily menu"))
    if not frappe.db.exists("Menu Item", dish):
        frappe.throw(_("Menu Item {0} not found").format(dish))

    base_cost = frappe.db.get_value("Menu Item", dish, "calculated_base_cost") or 0
    menu.append("items", {
        "dish": dish,
        "calculated_base_cost": base_cost,
        "member_price": round(base_cost * 1.0, 2),
        "employee_price": round(base_cost * 2.0, 2),
        "guest_price": round(base_cost * 3.0, 2),
        "prepared_portions": int(prepared_portions),
        "sold_portions": 0,
        "balance_portions": int(prepared_portions),
        "status": "Available",
        "sort_order": int(sort_order),
    })
    menu.save(ignore_permissions=True)
    menu.reload()
    return get_daily_menu(menu.name)


@frappe.whitelist()
def remove_daily_menu_item(parent, item_name):
    _check_manager()
    menu = frappe.get_doc("Daily Menu", parent)
    if menu.status == "Closed":
        frappe.throw(_("Cannot edit a closed daily menu"))
    for row in menu.items:
        if row.name == item_name:
            menu.remove(row)
            break
    menu.save(ignore_permissions=True)
    return get_daily_menu(menu.name)


@frappe.whitelist()
def publish_daily_menu(name):
    _check_manager()
    doc = frappe.get_doc("Daily Menu", name)
    if len(doc.items) == 0:
        frappe.throw(_("Cannot publish an empty menu"))
    doc.status = "Published"
    doc.published_at = frappe.utils.now()
    doc.save(ignore_permissions=True)
    return {"name": doc.name, "status": doc.status}


@frappe.whitelist()
def update_daily_menu_item(parent, item_name, prepared_portions=None,
                           member_price=None, employee_price=None, guest_price=None):
    """Edit a dish's prices and/or prepared portions on a daily menu.

    Manual prices persist until the next raw-price propagation re-applies the
    tier formula to that day's menu. A Closed menu cannot be edited.
    """
    _check_manager()
    menu = frappe.get_doc("Daily Menu", parent)
    if menu.status == "Closed":
        frappe.throw(_("Cannot edit a closed daily menu"))

    target = None
    for row in menu.items:
        if row.name == item_name:
            target = row
            break
    if target is None:
        frappe.throw(_("Menu item {0} not found on menu").format(item_name))

    if prepared_portions is not None:
        prepared = int(prepared_portions)
        if prepared < (target.sold_portions or 0):
            frappe.throw(
                _("Prepared portions ({0}) cannot be less than already sold ({1})").format(
                    prepared, target.sold_portions
                )
            )
        target.prepared_portions = prepared
        target.balance_portions = prepared - (target.sold_portions or 0)
        target.status = _menu_item_status(target.balance_portions, prepared)

    if member_price is not None:
        target.member_price = round(float(member_price), 2)
    if employee_price is not None:
        target.employee_price = round(float(employee_price), 2)
    if guest_price is not None:
        target.guest_price = round(float(guest_price), 2)

    menu.save(ignore_permissions=True)
    menu.reload()
    return get_daily_menu(menu.name)


@frappe.whitelist()
def delete_daily_menu(name):
    """Delete a daily menu. Blocked if it has sales or is closed."""
    _check_manager()
    if not frappe.db.exists("Daily Menu", name):
        frappe.throw(_("Daily Menu {0} not found").format(name))
    doc = frappe.get_doc("Daily Menu", name)
    if doc.status == "Closed":
        frappe.throw(_("Cannot delete a closed daily menu"))
    if frappe.db.exists("Sale", {"daily_menu": name}):
        frappe.throw(_("Cannot delete '{0}': it already has sales recorded").format(name))
    frappe.delete_doc("Daily Menu", name, force=True, ignore_permissions=True)
    return {"deleted": True, "name": name}


# ─────────────────────────────────────────────────────────────
# Shifts (wrap finance functions)
# ─────────────────────────────────────────────────────────────

@frappe.whitelist()
def open_shift(shift_date=None, shift_type="Lunch", opening_cash=0.0):
    _check_manager()
    return _open_shift(shift_date, shift_type, opening_cash)


@frappe.whitelist()
def close_shift(shift=None, closing_cash=0.0, notes=""):
    _check_manager()
    return _close_shift(shift, closing_cash, notes)


@frappe.whitelist()
def get_current_shift():
    _check_manager()
    return _get_current_shift()


@frappe.whitelist()
def get_shift_report(shift):
    _check_manager()
    return _get_shift_report(shift)


@frappe.whitelist()
def list_shifts(limit=50):
    _check_manager()
    return _list_shifts(limit=limit)


@frappe.whitelist()
def validate_shift_export(shift):
    _check_manager()
    return _validate_shift_export(shift)


@frappe.whitelist()
def export_shift(shift, format="maala"):
    _check_manager()
    return _export_shift(shift, format=format)


@frappe.whitelist()
def save_kitchen_reconciliation(shift, items):
    _check_manager()
    return _save_kitchen_reconciliation(shift, items)

