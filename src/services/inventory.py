from collections import defaultdict
from typing import TYPE_CHECKING

from src.models.group_booking import GroupBooking

if TYPE_CHECKING:
    from src.services.loyverse import LoyverseService
    from src.services.quicket import QuicketService


class InventoryService:
    def __init__(
        self,
        quicket_service: "QuicketService",
        loyverse_service: "LoyverseService",
    ):
        self.quicket_service = quicket_service
        self.loyverse_service = loyverse_service

    def create_items_from_quicket_tickets(self, quicket_tickets):
        # Group tickets by purchaser email
        email_groups = defaultdict(list)
        for quicket_ticket in quicket_tickets:
            email = quicket_ticket["TicketInformation"]["Purchaser Email"]
            email_groups[email].append(quicket_ticket)

        items = []

        for tickets in email_groups.values():
            # Get ticket purchaser
            first_name, surname, cellphone = self.quicket_service.get_ticket_purchaser(
                tickets
            ).values()

            # Count visitor tickets by OrderId
            visitor_counts = defaultdict(int)
            non_visitor_types = set()

            for ticket in tickets:
                ticket_type = ticket["TicketInformation"]["Ticket Type"]
                order_id = ticket["OrderId"]

                if "visitor" in ticket_type.lower():
                    visitor_counts[order_id] += 1
                else:
                    non_visitor_types.add(ticket_type)

            # Create the output structure
            entry = {"item_name": f"{first_name} {surname}", "variants": []}

            # Add visitor ticket counts
            for order_id, count in visitor_counts.items():
                entry["variants"].append({"option1_value": f"{order_id} x {count}"})

            # Add non-visitor ticket types
            for ticket_type in sorted(non_visitor_types):
                entry["variants"].append({"option1_value": f"~~ {ticket_type} ~~"})

            # Add mobile number
            entry["variants"].append({"option1_value": f"~~ {cellphone} ~~"})

            items.append(entry)

        return self.loyverse_service.add_loyverse_item_keys(items)

    def build_orders_inventory_map(self, created_item: dict) -> list[dict]:
        """
        Build inventory map for order counts from a created Loyverse item.

        Args:
            created_item: The item returned from Loyverse API after creation

        Returns:
            List of inventory level updates for order variants
        """
        return [
            {
                "variant_id": variant["variant_id"],
                "store_id": self.loyverse_service.store_id,
                "stock_after": int(variant["option1_value"].split(" x ")[1]),
            }
            for variant in created_item["variants"]
            if "~" not in variant["option1_value"]  # Skip non-order variants
        ]

    def create_items_from_group_bookings(self, group_bookings: list[GroupBooking]):
        """
        Create Loyverse items from group bookings.
        Simple items need one variant with barcode/SKU/price.

        Args:
            group_bookings: List of group booking dictionaries from database

        Returns:
            List of formatted items ready for Loyverse API
        """
        items = []

        for booking in group_bookings:
            # Simple item requires one variant with barcode/SKU/price
            entry = {
                "item_name": booking.group_name,
                "variants": [
                    {
                        "sku": booking.barcode,
                        "barcode": booking.barcode,
                        "default_pricing_type": "FIXED",
                        "default_price": 0,
                    }
                ],
            }

            items.append(entry)

        return self.loyverse_service.add_loyverse_group_keys(items)
