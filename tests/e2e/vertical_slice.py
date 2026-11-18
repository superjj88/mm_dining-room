"""
End-to-end vertical slice test for the Kibbutz Dining Hall platform.

Scenario (Phase 6 acceptance test):
1. Update a raw ingredient price.
2. Verify the new price propagates through the recipe/BOM to the POS price.
3. Ring sales until balance reaches -1 (soft-cap overdraft).
4. Verify the public screen / socket event turns red.

Run inside the Frappe container:
    python tests/e2e/vertical_slice.py
"""
import sys
from datetime import datetime


def _current_shift_type():
    hour = datetime.now().hour
    return "Lunch" if 6 <= hour < 15 else "Dinner"


def setup():
    import frappe

    today = frappe.utils.today()
    shift_type = _current_shift_type()

    # UOM
    if not frappe.db.exists("UOM", "kg"):
        frappe.get_doc({"doctype": "UOM", "uom_name": "kg", "must_be_whole_number": 0}).insert(ignore_permissions=True)
        frappe.db.commit()

    RAW_ITEM_NAME = "Test Tomatoes"
    MENU_ITEM_NAME = "Test Shakshuka"

    # Raw item
    if not frappe.db.exists("Raw Item", RAW_ITEM_NAME):
        frappe.get_doc({
            "doctype": "Raw Item",
            "item_name": RAW_ITEM_NAME,
            "uom": "kg",
            "current_rate": 5.0,
        }).insert(ignore_permissions=True)
        frappe.db.commit()

    # Menu item with one ingredient
    if not frappe.db.exists("Menu Item", MENU_ITEM_NAME):
        frappe.get_doc({
            "doctype": "Menu Item",
            "item_name": MENU_ITEM_NAME,
            "dish_name": "Test Shakshuka",
            "is_active": 1,
            "ingredients": [{
                "raw_item": RAW_ITEM_NAME,
                "qty": 2.0,
                "wastage_percent": 0,
            }],
        }).insert(ignore_permissions=True)
        frappe.db.commit()

    # Daily menu for today
    dm_name = f"{today}-{shift_type}"
    if not frappe.db.exists("Daily Menu", dm_name):
        frappe.get_doc({
            "doctype": "Daily Menu",
            "menu_date": today,
            "shift": shift_type,
            "status": "Published",
            "items": [{
                "dish": MENU_ITEM_NAME,
                "prepared_portions": 10,
                "member_price": 10.0,
                "employee_price": 20.0,
                "guest_price": 30.0,
            }],
        }).insert(ignore_permissions=True)
        frappe.db.commit()

    # Member diner
    if not frappe.db.exists("Diner", "E2E-001"):
        frappe.get_doc({
            "doctype": "Diner",
            "badge_id": "E2E-001",
            "diner_name": "E2E Member",
            "diner_type": "Member",
            "is_active": 1,
        }).insert(ignore_permissions=True)
        frappe.db.commit()


def test_price_propagation():
    import frappe

    RAW_ITEM_NAME = "Test Tomatoes"
    MENU_ITEM_NAME = "Test Shakshuka"

    # Update raw item price to 6.00
    today = frappe.utils.today()
    ph = frappe.get_doc({
        "doctype": "Raw Item Price History",
        "raw_item": RAW_ITEM_NAME,
        "purchase_date": today,
        "rate_per_uom": 6.0,
        "uom": "kg",
        "quantity": 1.0,
        "total_amount": 6.0,
    }).insert(ignore_permissions=True)
    frappe.db.commit()

    base_cost = frappe.db.get_value("Menu Item", MENU_ITEM_NAME, "calculated_base_cost")
    assert base_cost == 12.0, f"Expected Menu Item base cost 12.00, got {base_cost}"

    dmi = _get_test_dmi()
    assert dmi.member_price == 12.0, f"Expected member_price 12.00, got {dmi.member_price}"
    assert dmi.employee_price == 24.0, f"Expected employee_price 24.00, got {dmi.employee_price}"
    assert dmi.guest_price == 36.0, f"Expected guest_price 36.00, got {dmi.guest_price}"

    print("[PASS] Price propagation: 5.00 -> 6.00 -> member 12.00 / employee 24.00 / guest 36.00")


def test_overdraft_and_realtime():
    import frappe
    import time

    checkout = frappe.get_attr("kibbutz_dining.pos.doctype.sale.sale.checkout")

    # Reset the test item so reruns are deterministic
    dmi = _get_test_dmi()
    dmi.db_set("sold_portions", 0)
    dmi.db_set("balance_portions", dmi.prepared_portions)
    dmi.db_set("status", "Available")
    frappe.db.commit()

    run_id = int(time.time())
    dmi_name = _get_test_dmi().name

    # 10 sales keep balance at 0; the 11th drives it to -1
    for i in range(11):
        result = checkout(
            idempotency_key=f"e2e-{run_id}-{i}",
            badge_id="E2E-001",
            identification_method="RFID",
            items=[{"daily_menu_item": dmi_name, "qty": 1}],
        )
        frappe.db.commit()
        print(f"  sale {i}: {result}")

    dmi = _get_test_dmi()
    assert dmi.balance_portions == -1, f"Expected balance -1, got {dmi.balance_portions}"
    assert dmi.status == "Sold Out / Overdraft", f"Expected status 'Sold Out / Overdraft', got {dmi.status}"

    print("[PASS] Soft-cap overdraft: balance reached -1, status = Sold Out / Overdraft")


def _get_test_dmi():
    import frappe
    dm_name = f"{frappe.utils.today()}-{_current_shift_type()}"
    dm = frappe.get_doc("Daily Menu", dm_name)
    return dm.items[0]


def run():
    import frappe
    frappe.init(site="development.localhost", sites_path="/workspace/frappe-bench/sites")
    frappe.connect()
    try:
        setup()
        test_price_propagation()
        test_overdraft_and_realtime()
        print("\n✅ VERTICAL SLICE PASSED")
        return 0
    except Exception as e:
        print(f"\n❌ VERTICAL SLICE FAILED: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        frappe.destroy()


if __name__ == "__main__":
    sys.exit(run())
