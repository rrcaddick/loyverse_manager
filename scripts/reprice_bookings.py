"""Re-derive every booking's rate under the current pricing rules and keep the
agreed price as a discount below it.

Run once after migration 016 (and again after any import): the migration maps
old tier codes across but cannot apply the day and minimum rules, and it
leaves any booking whose agreed price is above its mapped rate unpriced.

    .venv/bin/python -m scripts.reprice_bookings            # report only
    .venv/bin/python -m scripts.reprice_bookings --apply    # write the changes

For each booking the rate is decided from its group type, visit date and
headcount (src/services/pricing.py). The agreed price per person is kept:
below the rate it is a discount with the reason "Imported from the booking
sheet" unless the booking already carries a reason; above the rate the
booking is put on the public rate with the gap as its discount and listed
for review, since no rule can produce that price.
"""

from __future__ import annotations

import argparse
from decimal import Decimal

from src.models import booking as booking_model
from src.models.base import query, transaction
from src.services import pricing
from src.services.settings import get_settings

IMPORT_REASON = "Imported from the booking sheet"
TWO = Decimal("0.01")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="write the changes (default: report only)")
    args = ap.parse_args()

    s = get_settings()
    rows = query(
        "SELECT id, reference, group_type, visit_date, people_booked, price_tier_code, tier_price, "
        "price_per_person, discount_per_person, discount_reason, minimum_waived_by FROM bookings ORDER BY visit_date, id"
    )
    changes: list[tuple] = []
    review: list[tuple] = []
    for r in rows:
        agreed = Decimal(str(r["price_per_person"])).quantize(TWO)
        other = None
        if int(r["people_booked"] or 0) < pricing.group_minimum(s) and pricing.rate_day(r["visit_date"], s) == "weekday":
            other = booking_model.another_group_on_day(r["visit_date"], int(r["id"]))
        decision = pricing.decide_tier(r["group_type"], r["visit_date"], r["people_booked"], s, other_group_on_day=other is not None)
        tier = decision.tier_code
        rate = pricing.price_for_tier(tier)
        note = ""
        if agreed > rate:
            tier, rate = pricing.PUBLIC_TIER, pricing.price_for_tier(pricing.PUBLIC_TIER)
            note = "above the rate: public rate less a discount, review"
            review.append((r["reference"], str(r["visit_date"]), r["group_type"], r["people_booked"], f"agreed R{agreed} vs rate R{pricing.price_for_tier(decision.tier_code)} ({decision.tier_code})"))
        discount = (rate - agreed).quantize(TWO)
        reason = (r.get("discount_reason") or IMPORT_REASON) if discount > 0 else None
        waived_by = other if decision.minimum_waived else None
        new = {
            "price_tier_code": tier,
            "tier_price": rate.quantize(TWO),
            "discount_per_person": discount,
            "discount_reason": reason,
            "minimum_waived_by": waived_by,
        }
        old = {k: (Decimal(str(r[k])).quantize(TWO) if k in ("tier_price", "discount_per_person") and r[k] is not None else r[k]) for k in new}
        if old != new:
            changes.append((int(r["id"]), r["reference"], old, new, note))

    print(f"{len(rows)} bookings; {len(changes)} to change; {len(review)} for review")
    for _id, ref, old, new, note in changes:
        diff = ", ".join(f"{k}: {old[k]} -> {new[k]}" for k in new if old[k] != new[k])
        print(f"  {ref:8} {diff}{'  [' + note + ']' if note else ''}")
    if review:
        print("\nFor review (agreed price above any rate the rules give):")
        for row in review:
            print("  ", row)
    if args.apply and changes:
        with transaction() as conn:
            for _id, _ref, _old, new, _note in changes:
                booking_model.update_fields(_id, new, conn=conn)
        print(f"\napplied {len(changes)} changes")
    elif changes:
        print("\nreport only; rerun with --apply to write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
