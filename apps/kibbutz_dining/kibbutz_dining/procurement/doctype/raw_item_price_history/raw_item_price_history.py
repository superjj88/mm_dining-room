import frappe
from frappe.model.document import Document


class RawItemPriceHistory(Document):
    pass


def on_price_change(doc, method):
    """
    Called after RawItemPriceHistory insert/update.
    Propagates price change to all MenuItems and active DailyMenuItems.
    """
    if not doc.raw_item or not doc.rate_per_uom:
        return

    frappe.db.set_value(
        "Raw Item", doc.raw_item,
        {"current_rate": doc.rate_per_uom},
        update_modified=False
    )

    _propagate_to_menu_items(doc.raw_item)


def _propagate_to_menu_items(raw_item_name):
    """Recalculate costs for all MenuItems using this raw_item."""
    menu_items = frappe.db.sql("""
        SELECT DISTINCT mi.name
        FROM `tabMenu Item` mi
        JOIN `tabMenu Item Ingredient` mii ON mii.parent = mi.name
        WHERE mii.raw_item = %s AND mi.is_active = 1
    """, (raw_item_name,), as_dict=1)

    for mi in menu_items:
        _recalc_single_menu_item(mi.name)


def _recalc_single_menu_item(menu_item_name):
    doc = frappe.get_doc("Menu Item", menu_item_name)
    total_ingredient_cost = 0.0

    for ing in doc.ingredients:
        raw = frappe.get_cached_doc("Raw Item", ing.raw_item)
        qty_with_waste = ing.qty * (1 + (ing.wastage_percent or 0) / 100)
        ing_cost = qty_with_waste * (raw.current_rate or 0)
        ing.db_set("cost", round(ing_cost, 2))
        total_ingredient_cost += ing_cost

    yield_portions = getattr(doc, "yield_portions", 1) or 1
    packaging_cost = float(getattr(doc, "packaging_cost", 0.0) or 0.0)
    base_cost = (total_ingredient_cost / max(int(yield_portions), 1)) + packaging_cost

    frappe.db.set_value(
        "Menu Item", menu_item_name,
        {"calculated_base_cost": round(base_cost, 2), "last_cost_update": frappe.utils.now()},
        update_modified=False
    )

    _propagate_to_daily_menu_items(menu_item_name, base_cost)


def _propagate_to_daily_menu_items(menu_item_name, base_cost):
    today = frappe.utils.today()
    daily_items = frappe.db.sql("""
        SELECT dmi.name, dm.shift FROM `tabDaily Menu Item` dmi
        JOIN `tabDaily Menu` dm ON dm.name = dmi.parent
        WHERE dmi.dish = %s AND dm.menu_date = %s
          AND dm.status IN ('Draft', 'Published')
    """, (menu_item_name, today), as_dict=1)

    for dmi in daily_items:
        # Shift-locked pricing invariant:
        # If the shift is Open and already has completed sales, freeze prices until next shift
        shift_name = f"{today}-{dmi.shift}"
        shift_locked = False
        if frappe.db.exists("Shift", shift_name):
            shift_doc = frappe.get_doc("Shift", shift_name)
            if shift_doc.status == "Open" and (shift_doc.total_sales or 0) > 0:
                shift_locked = True

        if not shift_locked:
            frappe.db.set_value("Daily Menu Item", dmi.name, {
                "calculated_base_cost": round(base_cost, 2),
                "member_price": round(base_cost * 1.0, 2),
                "employee_price": round(base_cost * 2.0, 2),
                "guest_price": round(base_cost * 3.0, 2),
            }, update_modified=False)

