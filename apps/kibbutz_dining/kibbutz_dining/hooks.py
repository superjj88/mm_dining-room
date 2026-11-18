from frappe import _

app_title = _("Kibbutz Dining")
app_publisher = _("Dining Hall")
app_description = _("Kibbutz Dining Hall Management Platform")
app_icon = "fa fa-utensils"
app_color = "green"
app_email = "dev@local"
app_license = "MIT"
app_depends_on = ["erpnext"]

doc_events = {
    "Raw Item Price History": {
        "after_insert": "kibbutz_dining.procurement.doctype.raw_item_price_history.raw_item_price_history.on_price_change",
        "on_update": "kibbutz_dining.procurement.doctype.raw_item_price_history.raw_item_price_history.on_price_change",
    },
}
