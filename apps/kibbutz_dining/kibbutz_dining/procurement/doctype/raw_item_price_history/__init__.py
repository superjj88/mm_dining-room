import frappe


def on_price_change(doc, method):
    """
    Called after RawItemPriceHistory insert/update.
    Recalculates base cost for all MenuItem recipes that use this raw_item,
    then propagates to all active DailyMenuItem entries.
    """
    if not doc.raw_item or not doc.rate_per_uom:
        return

    raw_item = frappe.get_doc("Raw Item", doc.raw_item)
    raw_item.current_rate = doc.rate_per_uom
    raw_item.db_set("current_rate", doc.rate_per_uom)
    raw_item.db_set("last_cost_update", frappe.utils.now())

    recalc_menu_item_costs(doc.raw_item)


def recalc_menu_item_costs(raw_item_name):
    """
    Find all MenuItem recipes that contain raw_item_name,
    recalculate their base cost, then update all active DailyMenuItems.
    """
    menu_items = frappe.db.sql("""
        SELECT DISTINCT mi.name
        FROM `tabMenu Item` mi
        JOIN `tabMenu Item Ingredient` mii ON mii.parent = mi.name
        WHERE mii.raw_item = %s
          AND mi.is_active = 1
    """, (raw_item_name,), as_dict=True)

    for mi in menu_items:
        recalc_single_menu_item(mi.name)


def recalc_single_menu_item(menu_item_name):
    """
    Recalculate base cost for a single MenuItem from its ingredients.
    """
    doc = frappe.get_doc("Menu Item", menu_item_name)
    total_cost = 0.0

    for ing in doc.ingredients:
        raw = frappe.get_cached_doc("Raw Item", ing.raw_item)
        qty_with_waste = ing.qty * (1 + (ing.wastage_percent or 0) / 100)
        ing_cost = qty_with_waste * (raw.current_rate or 0)
        ing.db_set("cost", round(ing_cost, 2))
        total_cost += ing_cost

    doc.db_set("calculated_base_cost", round(total_cost, 2))
    doc.db_set("last_cost_update", frappe.utils.now())

    propagate_to_daily_menu_items(doc.name, total_cost)


def propagate_to_daily_menu_items(menu_item_name, base_cost):
    """
    Update tier prices on all active DailyMenuItems for today
    that reference this MenuItem.
    """
    today = frappe.utils.today()

    daily_items = frappe.db.sql("""
        SELECT dmi.name
        FROM `tabDaily Menu Item` dmi
        JOIN `tabDaily Menu` dm ON dm.name = dmi.parent
        WHERE dmi.dish = %s
          AND dm.menu_date = %s
          AND dm.status IN ('Draft', 'Published')
    """, (menu_item_name, today), as_dict=True)

    tier_fields = {
        "member_price": 1.0,
        "employee_price": 2.0,
        "guest_price": 3.0,
    }

    for dmi in daily_items:
        updates = {}
        for field, multiplier in tier_fields.items():
            updates[field] = round(base_cost * multiplier, 2)
        frappe.db.set_value("Daily Menu Item", dmi.name, updates, update_modified=False)
