#!/usr/bin/env python3
"""Reset the throwaway Loyverse account so it looks like a real day at the gate.

    python -m scripts.seed_test_loyverse --api-key <throwaway key> [--visitor-price 1]

Deletes every item in that account, recreates the production catalogue (Visitor, Re-Entry,
Group Payment, Gazebo 1-7, with the same SKUs; Visitor at the price given so test sales cost
R1) and then loads fake online ticket orders and fake group bookings for today in exactly the
shape add_inventory builds them: one online item per purchaser with "<order> x <count>"
variants (stock = count) and "~~ note ~~" variants, one R0 group item per booking with an
EAN-13 barcode as SKU. Nothing touches this back office's database. Refuses to run against
the production merchant.
"""

import argparse
import sys

from config.constants import IMAGE_DIR
from src.clients.loyverse import LoyverseClient
from src.services.barcode import generate_barcode
from src.services.loyverse import LoyverseService

PROD_MERCHANT_ID = "cd674388-6979-4dba-b657-471653ce8199"
CATEGORY_NAMES = ["Public", "Group Payment", "Groups", "Online Tickets", "Gazeebos"]

ONLINE_ORDERS = [
    {"name": "Thandi Nkosi", "orders": {"51231": 2}, "notes": ["~~ 0825550101 ~~"]},
    {"name": "Pieter van Wyk", "orders": {"51238": 3, "51240": 1}, "notes": ["~~ Gazebo Hire ~~", "~~ 0835550177 ~~"]},
    {"name": "Aisha Petersen", "orders": {"51245": 4}, "notes": []},
    {"name": "johan.botha@example.test", "orders": {"51250": 1}, "notes": ["~~ 0715550199 ~~"]},
    {"name": "Nomvula Dlamini", "orders": {"51252": 6}, "notes": ["~~ 0605550120 ~~"]},
]
GROUPS = ["Sunnyside Primary", "Hope Church Youth", "Brooklands Creche"]


def fixed_items(categories, visitor_price):
    public, payment, gazebo = categories["Public"], categories["Group Payment"], categories["Gazeebos"]
    items = [
        {"item_name": "Visitor", "category_id": public, "track_stock": False,
         "variants": [{"sku": "10000", "default_pricing_type": "FIXED", "default_price": visitor_price}]},
        {"item_name": "Re-Entry", "category_id": public, "track_stock": False,
         "variants": [{"sku": "10001", "default_pricing_type": "FIXED", "default_price": 0}]},
        {"item_name": "Group Payment", "category_id": payment, "track_stock": False,
         "variants": [{"sku": "10037", "default_pricing_type": "VARIABLE"}]},
    ]
    for n in range(1, 8):
        items.append({"item_name": f"Gazebo {n}", "category_id": gazebo, "track_stock": True,
                      "variants": [{"sku": str(10141 + n), "default_pricing_type": "FIXED", "default_price": 350}]})
    return items


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api-key", required=True, help="the THROWAWAY account's API key")
    parser.add_argument("--visitor-price", type=float, default=1.0)
    args = parser.parse_args(argv)

    client = LoyverseClient(args.api_key)
    merchant = client.get("merchant", {})
    if merchant.get("id") == PROD_MERCHANT_ID:
        sys.exit("refusing: that key belongs to the production merchant")
    store_id = client.get("stores", {})["stores"][0]["id"]
    print(f"account: {merchant.get('business_name')} ({merchant.get('id')}), store {store_id}")

    # 1. clean slate
    items = client.get("items", {}).get("items") or []
    for item in items:
        client.delete(f"items/{item['id']}")
    print(f"deleted {len(items)} items")

    # 2. categories by name
    existing = {c["name"]: c["id"] for c in client.get("categories", {}).get("categories") or [] if not c.get("deleted_at")}
    categories = {}
    for name in CATEGORY_NAMES:
        categories[name] = existing.get(name) or client.post("categories", {"name": name})["id"]
    print("categories:", ", ".join(f"{n} {i[:8]}" for n, i in categories.items()))

    service = LoyverseService(client, store_id,
                              {"online_ticket": categories["Online Tickets"], "groups": categories["Groups"], "gazebo": categories["Gazeebos"]},
                              {})

    # 3. the production catalogue
    gazebo_levels = []
    for item in fixed_items(categories, args.visitor_price):
        created = service.create_item(item)
        if created.get("errors"):
            sys.exit(f"creating {item['item_name']} failed: {created['errors']}")
        if item["track_stock"]:
            gazebo_levels.append({"variant_id": created["variants"][0]["variant_id"], "store_id": store_id, "stock_after": 1})
        print(f"  item {created['item_name']!r} sku {created['variants'][0].get('sku')} price {created['variants'][0].get('default_price')}")
    service.update_inventory(gazebo_levels)

    # 4. online ticket orders, as add_inventory shapes them
    entries = []
    for order in ONLINE_ORDERS:
        variants = [{"option1_value": f"{order_id} x {count}"} for order_id, count in order["orders"].items()]
        variants += [{"option1_value": note} for note in order["notes"]]
        entries.append({"item_name": order["name"], "variants": variants})
    for item in service.add_loyverse_item_keys(entries):
        item["category_id"] = categories["Online Tickets"]  # the helper hardcodes production's id
        created = service.process_item_with_inventory(item)
        if created.get("errors"):
            sys.exit(f"creating online item {item['item_name']} failed: {created['errors']}")
        levels = [
            {"variant_id": v["variant_id"], "store_id": store_id, "stock_after": int(v["option1_value"].split(" x ")[1])}
            for v in created["variants"] if "~" not in v["option1_value"]
        ]
        service.update_inventory(levels)
        print(f"  online {created['item_name']!r}: " + ", ".join(v["option1_value"] for v in created["variants"]))

    # 5. group bookings for today, as add_inventory shapes them
    groups = [{"item_name": name, "variants": [{"sku": (b := generate_barcode()), "barcode": b,
                                                   "default_pricing_type": "FIXED", "default_price": 0}]} for name in GROUPS]
    for item in service.add_loyverse_group_keys(groups):
        created = service.process_item_with_inventory(item, IMAGE_DIR / "product_image_group.png")
        if created.get("errors"):
            sys.exit(f"creating group item {item['item_name']} failed: {created['errors']}")
        print(f"  group {created['item_name']!r}: barcode {created['variants'][0].get('sku')}")
    print("done")


if __name__ == "__main__":
    main()
