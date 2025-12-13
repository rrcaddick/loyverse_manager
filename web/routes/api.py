from flask import Blueprint, jsonify

from config.constants import CATEGORIES, GAZEBO_MAP, LOYVERSE_STORE_ID
from config.settings import LOYVERSE_API_KEY
from src.clients.loyverse import LoyverseClient
from src.services.loyverse import LoyverseService
from web.utils.formatters import format_date, format_time

api_bp = Blueprint("api", __name__)


@api_bp.route("/groups", methods=["GET"])
def get_group_data():
    """Get group visitor data from receipts"""

    loyverse_client = LoyverseClient(LOYVERSE_API_KEY)

    loyverse_service = LoyverseService(
        loyverse_client, LOYVERSE_STORE_ID, CATEGORIES, GAZEBO_MAP
    )

    receipts = loyverse_service.get_receipts(
        created_at_min="2025-10-01T00:00:00.000Z", limit=250
    )

    def get_group_name(line_item):
        return (
            "Online Tickets"
            if loyverse_service.is_online_item(line_item, "variant_name")
            else line_item["item_name"].title()
        )

    groups = [
        {
            "date": format_date(receipt["created_at"]),
            "time": format_time(receipt["created_at"]),
            "group": line_item["item_name"].title(),
            "driver": receipt.get("note", "Not Captured"),
            "vehicle_reg": receipt.get("order", "N/A").upper()
            if receipt.get("order")
            else "N/A",
            "visitors": line_item["quantity"],
        }
        for receipt in receipts["receipts"]
        for line_item in receipt["line_items"]
        if line_item["variant_id"] != "428b62a9-284c-4c7a-95f3-0154aa5b0026"
        and line_item["item_name"]
        not in ["Gazebo", "Group Payment", "Re-Entry", "Visitor"]
        and get_group_name(line_item) != "Online Tickets"
    ]

    return jsonify({"groups": groups})
