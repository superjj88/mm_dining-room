"""
Sample data loader for the Kibbutz Dining platform.

Loads a complete, functional demo system:
  - ~55 raw items (ingredients) with ILS prices + price history
  - 20 dishes with full recipes; food cost is computed by the existing
    cost-propagation engine (MenuItem recalc_base_cost)
  - 20 diners (14 Members + 6 Employees) with 4-5 digit badge IDs
  - Published daily menus for today + N days (Lunch & Dinner)
  - Optionally a demo sales run + shift reconciliation

Run from the bench:
    bench --site development.localhost execute kibbutz_dining.sample_data.seed_sample_system
    bench --site development.localhost execute kibbutz_dining.sample_data.seed_sample_system --kwargs "{'reset': 1, 'days_ahead': 2}"
    bench --site development.localhost execute kibbutz_dining.sample_data.verify_sample_data
    bench --site development.localhost execute kibbutz_dining.sample_data.run_demo_checks

Data lives in CSV files under sample_data/ so real data can be dropped in later:
    raw_items.csv  -> item_name,item_code,uom,current_rate,category,supplier
    menu_items.csv -> item_name,item_name_en,category,yield_portions,preparation_method,ingredients
                      ingredients = "raw_item:qty:uom:wastage%; raw_item:qty:uom:wastage%"
    diners.csv     -> diner_name,badge_id,diner_type,employee_id

Recipes are defined per single portion (yield_portions = 1), so
calculated_base_cost equals the cost of one dish.
"""

import csv
import os
import re

import frappe
from frappe.utils import add_days, now, today

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_DIR, "sample_data")

TIER_MULTIPLIERS = {"Member": 1.0, "Employee": 2.0, "Guest": 3.0}

# Portions prepared per dish by category
PORTIONS_BY_CATEGORY = {
    "Soup": 30,
    "Salad": 18,
    "Main Course": 25,
    "Side Dish": 20,
    "Dessert": 12,
    "Beverage": 25,
}

# Which categories appear in each shift's menu
SHIFT_CATEGORIES = {
    "Lunch": ["Soup", "Salad", "Main Course", "Side Dish"],
    "Dinner": ["Soup", "Salad", "Main Course", "Dessert"],
}

REQUIRED_UOMS = ["kg", "Litre", "Nos", "Dozen", "Pack"]

# Sample suppliers keyed by ingredient category (names as shown in the UI).
CATEGORY_SUPPLIERS = {
    "Produce": "ירקות הגליל",
    "Protein": "אטליז הצפון",
    "Dairy": "מחלבת הגליל",
    "Grains": "מאפיית הדגן",
    "Oils & Fats": "ספק מזון כללי",
    "Spices": "ספק מזון כללי",
    "Beverages": "ספק מזון כללי",
    "Other": "ספק מזון כללי",
}
SUPPLIER_GROUP = "ספקי חדר אוכל"

# Order matters: delete dependents before the documents they reference.
CLEANUP_ORDER = [
    "Sale",
    "Shift Log",
    "Shift",
    "Daily Menu",
    "Menu Item",
    "Raw Item Price History",
    "Raw Item",
    "Supplier",
    "Diner",
]


# ─────────────────────────────────────────────────────────────
# CSV helpers
# ─────────────────────────────────────────────────────────────

def _read_csv(filename):
    path = os.path.join(DATA_DIR, filename)
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _parse_ingredients(spec):
    rows = []
    for part in (spec or "").split(";"):
        part = part.strip()
        if not part:
            continue
        raw_item, qty, uom, wastage = part.split(":")
        rows.append({
            "raw_item": raw_item,
            "qty": float(qty),
            "uom": uom,
            "wastage_percent": float(wastage or 0),
        })
    return rows


# ─────────────────────────────────────────────────────────────
# Reset / setup
# ─────────────────────────────────────────────────────────────

def _cleanup():
    """Delete every record in the demo doctypes, in dependency order."""
    deleted = {}
    for doctype in CLEANUP_ORDER:
        names = frappe.get_all(doctype, pluck="name")
        count = 0
        for name in names:
            try:
                frappe.delete_doc(
                    doctype, name, force=True, ignore_permissions=True,
                    delete_permanently=True,
                )
                count += 1
            except Exception as exc:  # never let one bad row stop the reset
                frappe.log_error(f"sample_data cleanup {doctype} {name}: {exc}")
        deleted[doctype] = count
    frappe.db.commit()
    return deleted


def _ensure_uoms():
    for uom in REQUIRED_UOMS:
        if not frappe.db.exists("UOM", uom):
            try:
                doc = frappe.get_doc({"doctype": "UOM", "uom_name": uom})
                doc.insert(ignore_permissions=True)
            except Exception as exc:
                frappe.log_error(f"sample_data UOM {uom}: {exc}")
    frappe.db.commit()


def _ensure_suppliers():
    """Create the sample Supplier Group + suppliers, return name->id map."""
    if not frappe.db.exists("Supplier Group", SUPPLIER_GROUP):
        try:
            frappe.get_doc({
                "doctype": "Supplier Group",
                "supplier_group_name": SUPPLIER_GROUP,
                "is_group": 0,
            }).insert(ignore_permissions=True)
        except Exception as exc:
            frappe.log_error(f"sample_data Supplier Group {SUPPLIER_GROUP}: {exc}")

    for supplier_name in sorted(set(CATEGORY_SUPPLIERS.values())):
        if frappe.db.exists("Supplier", {"supplier_name": supplier_name}):
            continue
        try:
            frappe.get_doc({
                "doctype": "Supplier",
                "supplier_name": supplier_name,
                "supplier_type": "Company",
                "supplier_group": SUPPLIER_GROUP,
            }).insert(ignore_permissions=True)
        except Exception as exc:
            frappe.log_error(f"sample_data Supplier {supplier_name}: {exc}")
    frappe.db.commit()

    return {
        row.supplier_name: row.name
        for row in frappe.get_all("Supplier", fields=["name", "supplier_name"])
        if row.supplier_name
    }


# ─────────────────────────────────────────────────────────────
# Creators
# ─────────────────────────────────────────────────────────────

def _create_raw_items():
    created = 0
    supplier_map = _ensure_suppliers()
    for row in _read_csv("raw_items.csv"):
        name = row["item_name"]
        if frappe.db.exists("Raw Item", name):
            continue
        rate = float(row["current_rate"])
        doc = frappe.get_doc({
            "doctype": "Raw Item",
            "item_name": name,
            "item_code": row["item_code"],
            "uom": row["uom"],
            "current_rate": rate,
            "category": row["category"],
            "supplier": supplier_map.get(row.get("supplier")),
            "is_active": 1,
        })
        doc.insert(ignore_permissions=True)

        # Seed price history (also drives cost propagation via hooks)
        ph = frappe.get_doc({
            "doctype": "Raw Item Price History",
            "raw_item": name,
            "purchase_date": today(),
            "rate_per_uom": rate,
            "uom": row["uom"],
            "quantity": 1,
            "total_amount": rate,
            "notes": "Initial sample price",
        })
        ph.insert(ignore_permissions=True)
        created += 1
    frappe.db.commit()
    return created


def _create_menu_items():
    from kibbutz_dining.menu.doctype.menu_item.menu_item import recalc_base_cost

    created = 0
    for row in _read_csv("menu_items.csv"):
        name = row["item_name"]
        if frappe.db.exists("Menu Item", name):
            continue
        doc = frappe.get_doc({
            "doctype": "Menu Item",
            "item_name": name,
            "item_name_en": row["item_name_en"],
            "category": row["category"],
            "yield_portions": int(row["yield_portions"]),
            "preparation_method": row["preparation_method"],
            "is_active": 1,
            "ingredients": _parse_ingredients(row["ingredients"]),
        })
        doc.insert(ignore_permissions=True)
        recalc_base_cost(doc)
        doc.reload()
        created += 1
    frappe.db.commit()
    return created


def _create_diners():
    created = 0
    for row in _read_csv("diners.csv"):
        badge = str(row["badge_id"]).strip()
        if frappe.db.exists("Diner", badge):
            continue
        diner_type = row["diner_type"]
        doc = frappe.get_doc({
            "doctype": "Diner",
            "badge_id": badge,
            "diner_name": row["diner_name"],
            "diner_type": diner_type,
            "employee_id": (row.get("employee_id") or None),
            "maala_member_id": (row.get("maala_member_id") or badge),
            "cost_center": (row.get("cost_center") or None),
            "is_active": 1,
            "tier_multiplier": TIER_MULTIPLIERS.get(diner_type, 1.0),
        })
        doc.insert(ignore_permissions=True)
        created += 1
    frappe.db.commit()
    return created


def _build_daily_menus(days_ahead=2):
    """Create published Lunch & Dinner menus for today + days_ahead days."""
    created = 0
    menu_items = frappe.get_all(
        "Menu Item",
        fields=["name", "item_name", "category", "calculated_base_cost"],
        filters={"is_active": 1},
    )

    for offset in range(days_ahead + 1):
        menu_date = add_days(today(), offset)
        for shift in ("Lunch", "Dinner"):
            name = f"{menu_date}-{shift}"
            if frappe.db.exists("Daily Menu", name):
                continue

            dishes = [m for m in menu_items if m.category in SHIFT_CATEGORIES[shift]]
            # rotate so menus differ day to day
            if dishes:
                k = offset % len(dishes)
                dishes = dishes[k:] + dishes[:k]

            menu = frappe.get_doc({
                "doctype": "Daily Menu",
                "menu_date": menu_date,
                "shift": shift,
                "status": "Published",
                "published_at": now(),
                "items": [],
            })
            demo_sold_out_done = False
            demo_low_stock_done = False
            for i, dish in enumerate(dishes):
                base = float(dish.calculated_base_cost or 0)
                prepared = PORTIONS_BY_CATEGORY.get(dish.category, 20)
                sold = 0
                balance = prepared
                status = "Available"

                # Demo states on today's menus only: one sold-out main + one low-stock salad
                if offset == 0 and not demo_sold_out_done and dish.category == "Main Course":
                    sold, balance, status = prepared, 0, "Sold Out / Overdraft"
                    demo_sold_out_done = True
                elif offset == 0 and not demo_low_stock_done and dish.category == "Salad":
                    sold, balance, status = prepared - 3, 3, "Low Stock"
                    demo_low_stock_done = True

                menu.append("items", {
                    "dish": dish.item_name,
                    "calculated_base_cost": round(base, 2),
                    "member_price": round(base * 1.0, 2),
                    "employee_price": round(base * 2.0, 2),
                    "guest_price": round(base * 3.0, 2),
                    "prepared_portions": prepared,
                    "sold_portions": sold,
                    "balance_portions": balance,
                    "status": status,
                    "sort_order": i,
                })

            menu.insert(ignore_permissions=True)
            created += 1
    frappe.db.commit()
    return created


# ─────────────────────────────────────────────────────────────
# Entry points
# ─────────────────────────────────────────────────────────────

@frappe.whitelist()
def seed_sample_system(reset=True, days_ahead=2):
    """Load the complete sample system. reset=True wipes demo doctypes first."""
    if isinstance(reset, str):
        reset = reset.lower() in ("1", "true", "yes")
    days_ahead = int(days_ahead)

    frappe.set_user("Administrator")
    summary = {}
    if reset:
        summary["deleted"] = _cleanup()
    _ensure_uoms()
    summary["raw_items_created"] = _create_raw_items()
    summary["menu_items_created"] = _create_menu_items()
    summary["diners_created"] = _create_diners()
    summary["daily_menus_created"] = _build_daily_menus(days_ahead)
    summary["counts"] = {
        "raw_items": frappe.db.count("Raw Item"),
        "suppliers": frappe.db.count("Supplier"),
        "menu_items": frappe.db.count("Menu Item"),
        "diners": frappe.db.count("Diner"),
        "daily_menus": frappe.db.count("Daily Menu"),
    }
    frappe.db.commit()
    return summary


@frappe.whitelist()
def verify_sample_data():
    """Assert the sample system satisfies the platform invariants."""
    errors = []
    warnings = []

    menu_items = frappe.get_all(
        "Menu Item",
        fields=["name", "item_name", "category", "calculated_base_cost"],
    )
    if len(menu_items) != 20:
        errors.append(f"expected 20 menu items, found {len(menu_items)}")
    for mi in menu_items:
        base = float(mi.calculated_base_cost or 0)
        if base <= 0:
            errors.append(f"dish '{mi.item_name}' has non-positive cost {base}")
        ings = frappe.get_all(
            "Menu Item Ingredient", filters={"parent": mi.name}, pluck="name"
        )
        if len(ings) < 2:
            errors.append(f"dish '{mi.item_name}' has fewer than 2 ingredients")

    diners = frappe.get_all("Diner", fields=["badge_id", "diner_name", "diner_type"])
    for d in diners:
        if not re.fullmatch(r"\d{4,7}", str(d.badge_id or "")):
            errors.append(f"diner '{d.diner_name}' badge '{d.badge_id}' is not 4-7 digits")
    members = [d for d in diners if d.diner_type == "Member"]
    employees = [d for d in diners if d.diner_type == "Employee"]
    if len(diners) != 20:
        errors.append(f"expected 20 diners, found {len(diners)}")
    if (len(members), len(employees)) != (14, 6):
        warnings.append(f"diner mix is {len(members)} members / {len(employees)} employees")

    menus = frappe.get_all("Daily Menu", fields=["name"])
    if len(menus) < 6:
        errors.append(f"expected at least 6 daily menus, found {len(menus)}")
    for menu in frappe.get_all("Daily Menu", fields=["name"]):
        for item in frappe.get_doc("Daily Menu", menu.name).items:
            base = float(item.calculated_base_cost or 0)
            if abs((item.member_price or 0) - round(base * 1.0, 2)) > 0.01:
                errors.append(f"{menu.name}/{item.dish}: member_price != 1x cost")
            if abs((item.employee_price or 0) - round(base * 2.0, 2)) > 0.01:
                errors.append(f"{menu.name}/{item.dish}: employee_price != 2x cost")
            if abs((item.guest_price or 0) - round(base * 3.0, 2)) > 0.01:
                errors.append(f"{menu.name}/{item.dish}: guest_price != 3x cost")

    without_supplier = frappe.db.count("Raw Item", {"supplier": ("is", "not set")})
    if without_supplier:
        warnings.append(f"{without_supplier} raw items have no supplier")

    result = {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "counts": {
            "raw_items": frappe.db.count("Raw Item"),
            "suppliers": frappe.db.count("Supplier"),
            "menu_items": len(menu_items),
            "diners": len(diners),
            "daily_menus": len(menus),
        },
    }
    return result


@frappe.whitelist()
def run_demo_checks():
    """Run member/employee/guest checkouts + one overdraft sale. Mutates balances."""
    from kibbutz_dining.pos.doctype.sale.sale import checkout, _get_current_shift_type

    frappe.set_user("Administrator")
    shift = _get_current_shift_type()
    menu_name = f"{today()}-{shift}"
    if not frappe.db.exists("Daily Menu", menu_name):
        menu_name = frappe.db.get_value(
            "Daily Menu", {"menu_date": today()}, "name", order_by="modified desc"
        )
    if not menu_name:
        return {"ok": False, "error": "no daily menu for today"}

    menu = frappe.get_doc("Daily Menu", menu_name)
    available = [i for i in menu.items if (i.balance_portions or 0) > 0][:3]
    sold_out = [i for i in menu.items if (i.balance_portions or 0) <= 0]

    results = {"menu": menu_name, "shift": shift}
    stamps = now().replace(" ", "-").replace(":", "")

    def _items(rows):
        return [{"daily_menu_item": r.name, "qty": 1} for r in rows]

    if len(available) >= 2:
        results["member"] = checkout(
            idempotency_key=f"DEMO-M-{stamps}",
            badge_id="20130",
            identification_method="RFID",
            items=_items(available[:2]),
        )
    if len(available) >= 1:
        results["employee"] = checkout(
            idempotency_key=f"DEMO-E-{stamps}",
            badge_id="30100",
            identification_method="RFID",
            items=_items(available[:1]),
        )
        results["guest"] = checkout(
            idempotency_key=f"DEMO-G-{stamps}",
            identification_method="Guest",
            items=_items(available[:1]),
        )
    if sold_out:
        results["overdraft"] = checkout(
            idempotency_key=f"DEMO-O-{stamps}",
            badge_id="20130",
            identification_method="RFID",
            items=_items(sold_out[:1]),
        )
    frappe.db.commit()
    return results
