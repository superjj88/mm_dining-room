import frappe
from frappe.model.document import Document


class MenuItem(Document):
    pass


def validate(doc, method):
    recalc_base_cost(doc)


def recalc_base_cost(doc):
    total_cost = 0.0
    for ing in doc.ingredients:
        raw = frappe.get_doc("Raw Item", ing.raw_item)
        qty_with_waste = ing.qty * (1 + (ing.wastage_percent or 0) / 100)
        ing_cost = qty_with_waste * (raw.current_rate or 0)
        ing.db_set("cost", round(ing_cost, 2))
        total_cost += ing_cost

    yield_portions = getattr(doc, "yield_portions", 1) or 1
    packaging_cost = float(getattr(doc, "packaging_cost", 0.0) or 0.0)
    base_cost = (total_cost / max(int(yield_portions), 1)) + packaging_cost

    doc.db_set("calculated_base_cost", round(base_cost, 2))
    doc.db_set("last_cost_update", frappe.utils.now())
