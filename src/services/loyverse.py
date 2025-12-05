from pathlib import Path

import requests

from config.constants import IMAGE_DIR


class LoyverseService:
    def __init__(self, loyverse_client, store_id, categories, gazebo_map):
        self.client = loyverse_client
        self.store_id = store_id
        self.categories = categories
        self.gazebo_map = gazebo_map

    def get_items(self, **kwargs):
        return self.client.get("items", params=kwargs)

    def get_item(self, item_id):
        return self.client.get(f"items/{item_id}")

    def get_receipts(self, **kwargs):
        return self.client.get("receipts", params=kwargs)

    def get_card_payments(self, receipts=None):
        # Dictionary to store daily totals
        receipts = receipts if receipts else self.get_receipts()
        daily_totals = {}

        # Go through each receipt
        for receipt in receipts["receipts"]:
            # Get the date from receipt_date (converting from ISO format to just the date)
            date = receipt["receipt_date"].split("T")[0]

            # Go through each payment in the receipt
            for payment in receipt["payments"]:
                # Check if it's a card payment
                if payment["type"] == "NONINTEGRATEDCARD":
                    # Add the payment amount to the daily total
                    if date in daily_totals:
                        daily_totals[date] += payment["money_amount"]
                    else:
                        daily_totals[date] = payment["money_amount"]

        # Convert to list of dictionaries in the required format
        result = [
            {"date": date, "amount": amount} for date, amount in daily_totals.items()
        ]

        return result

    def get_cash_payments(self, receipts=None):
        # Dictionary to store daily totals
        receipts = receipts if receipts else self.get_receipts()
        daily_totals = {}

        # Go through each receipt
        for receipt in receipts["receipts"]:
            # Get the date from receipt_date (converting from ISO format to just the date)
            date = receipt["receipt_date"].split("T")[0]

            # Go through each payment in the receipt
            for payment in receipt["payments"]:
                # Check if it's a card payment
                if payment["type"] == "CASH":
                    # Add the payment amount to the daily total
                    if date in daily_totals:
                        daily_totals[date] += payment["money_amount"]
                    else:
                        daily_totals[date] = payment["money_amount"]

        # Convert to list of dictionaries in the required format
        result = [
            {"date": date, "amount": amount} for date, amount in daily_totals.items()
        ]

        return result

    def clear_items(self, category_ids):
        items = self.get_items()["items"]
        delete_item_ids = [
            item["id"] for item in items if item["category_id"] in category_ids
        ]
        for item_id in delete_item_ids:
            self.client.delete(f"items/{item_id}")

    def reset_inventory(self):
        inventory_map = [
            {"variant_id": vid, "store_id": self.store_id, "stock_after": 1}
            for vid in self.gazebo_map.values()
        ]
        self.update_inventory(inventory_map)

    def update_inventory(self, inventory_map):
        self.client.post("inventory", {"inventory_levels": inventory_map})

    def get_inventory(self, variant_ids):
        variant_ids_query = ",".join(variant_ids)
        return self.client.get(f"inventory?variant_ids={variant_ids_query}")

    def create_item(self, item):
        return self.client.post("items", item)

    def upload_item_image(self, item_id, image_path):
        url = f"{self.client.base_url}items/{item_id}/image"
        image_headers = {
            key: value
            for key, value in self.client.headers.items()
            if key != "Content-Type"
        }
        with Path.open(Path(image_path), "rb") as image_file:
            requests.post(
                url,
                headers=image_headers,
                data=image_file,
                timeout=(30, 60),
            )

    def is_online_item(self, item, keyname):
        return (
            item[keyname] is not None
            and " x " in item[keyname]
            and "~" not in item[keyname]
            and item[keyname][-1].isdigit()
        )

    def get_online_item_ids(self, data):
        return {
            line_item["item_id"]
            for receipts in data["receipts"]
            for line_item in receipts["line_items"]
            if self.is_online_item(line_item, "variant_name")
        }

    def update_item_order_counts(self, item, inventory):
        inventory_counts = {
            level["variant_id"]: level["in_stock"]
            for level in inventory["inventory_levels"]
        }

        updated_variants = []

        for variant in item["variants"]:
            option1_value = variant["option1_value"]
            variant_id = variant["variant_id"]

            if self.is_online_item(variant, "option1_value"):
                has_double_spaces = "  x  " in option1_value
                separator = " x " if has_double_spaces else "  x  "
                order_id, ticket_count = option1_value.split(
                    "  x  " if has_double_spaces else " x "
                )
                ticket_count = inventory_counts.get(variant_id, ticket_count)
                option1_value = f"{order_id}{separator}{ticket_count}"
            else:
                option1_value = (
                    option1_value.replace("~~~", "~~")
                    if "~~~" in option1_value
                    else option1_value.replace("~~", "~~~")
                )

            updated_variants.append(
                {
                    "variant_id": variant_id,
                    "item_id": item["id"],
                    "option1_value": option1_value,
                    "default_pricing_type": "FIXED",
                    "default_price": 0,
                }
            )

        updated_item = {
            "id": item["id"],
            "item_name": item["item_name"],
            "category_id": item["category_id"],
            "track_stock": item["track_stock"],
            "option1_name": item["option1_name"],
            "variants": updated_variants,
        }

        self.create_item(updated_item)

    def add_loyverse_item_keys(self, items):
        root_keys = {
            "category_id": "6d089f1a-f067-4d10-871c-f2a4724e4c2b",
            "track_stock": True,
            "option1_name": "Order Details",
        }

        variant_keys = {"default_pricing_type": "FIXED", "default_price": 0}
        return [
            {
                **root_keys,
                **item,
                "variants": [
                    {**variant_keys, **variant} for variant in item["variants"]
                ],
            }
            for item in items
        ]

    def add_loyverse_group_keys(self, items):
        """Add Loyverse-specific keys for group booking items - no option fields for simple items"""
        return [
            {
                "category_id": self.categories["groups"],
                "track_stock": False,
                **item,
            }
            for item in items
        ]

    def process_item_with_inventory(self, item: dict, image_path: str = None) -> dict:
        """
        Create item, upload image, and update inventory in one operation.

        Args:
            item: Item dict with variants
            image_path: Path to product image (defaults to online item image if None)

        Returns:
            Created item dictionary
        """
        # Use default online image if none provided
        if image_path is None:
            image_path = IMAGE_DIR / "product_image_online.png"

        # Create item
        created_item = self.create_item(item)

        # Upload product image
        self.upload_item_image(created_item["id"], image_path)

        # Return created item for further processing
        return created_item
