"""DB-backed round trip of the booking service.

Needs the local MySQL from .env with migration 007 applied; skipped otherwise.
Every row it creates has a group_name starting with "TEST " and is deleted at
the end (cascades clear events, questions, payments and documents).
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

try:
    from src.models.base import query_one

    query_one("SELECT 1 AS ok")
    DB_OK = True
except Exception:  # noqa: BLE001 - any connection problem means skip
    DB_OK = False

pytestmark = pytest.mark.skipif(not DB_OK, reason="MySQL not reachable")

from src.models import booking as bm  # noqa: E402
from src.models.group_booking import GroupBooking  # noqa: E402
from src.services import booking as bs  # noqa: E402

VISIT = date(2026, 11, 12)  # a Thursday inside the 2026/27 season


@pytest.fixture
def created():
    ids: list[int] = []
    yield ids
    for booking_id in ids:
        bm.delete(booking_id)


def make(created, **overrides):
    data = {
        "group_name": "TEST pytest school",
        "group_type": "school",
        "contact_name": "Jane Test",
        "contact_email": "Jane.Test@Example.com",
        "contact_mobile": "082 123 4567",
        "visit_date": VISIT.isoformat(),
        "adults": 5,
        "children": 50,
        "questions": ["Is there shade?"],
    }
    data.update(overrides)
    row = bs.create_booking(data, source="manual", actor=None)
    created.append(row["id"])
    return row


def test_create_assigns_everything(created):
    b = make(created)
    assert b["reference"].startswith("FY") and b["reference"] == f"FY{b['doc_number']}"
    assert len(b["barcode"]) == 13
    assert b["status"] == "enquiry"
    assert b["people_booked"] == 55
    assert b["price_tier_code"] == "school_weekday"
    assert b["price_per_person"] == Decimal("70.00")
    assert b["deposit_due"] == Decimal("2800.00")
    assert b["hold_expires_on"] == VISIT - timedelta(days=7)
    assert b["contact_email"] == "jane.test@example.com"
    assert b["contact_mobile"] == "27821234567"
    detail = bs.get_booking_detail(b["id"])
    assert [q["question"] for q in detail["questions"]] == ["Is there shade?"]
    assert [e["kind"] for e in detail["events"]] == ["created"]


def test_update_recalculates_and_logs(created):
    b = make(created)
    b = bs.update_booking(b["id"], {"people_booked": 200}, actor=None)
    assert b["deposit_due"] == Decimal("4200.00")
    b = bs.update_booking(b["id"], {"visit_date": "2026-11-14"}, actor=None)  # Saturday
    assert b["price_tier_code"] == "nonprofit_kids_weekend"
    assert b["price_per_person"] == Decimal("95.00")
    kinds = [e["kind"] for e in bs.get_booking_detail(b["id"])["events"]]
    assert kinds == ["created", "updated", "updated"]


def test_payment_auto_confirms(created):
    b = make(created)
    bs.set_status(b["id"], "proforma_sent", None)
    bs.record_payment(b["id"], "eft", "1000", None, "FY-x", None, None)
    assert bm.get(b["id"])["status"] == "proforma_sent"
    bs.record_payment(b["id"], "eft", "1800", None, None, None, None)
    row = bm.get(b["id"])
    assert row["status"] == "confirmed" and row["confirmed_at"] is not None
    fin = bs.booking_finance(row)
    assert fin["paid_total"] == Decimal("2800.00")
    assert fin["balance_due"] == Decimal("1050.00")


def test_invalid_transition_raises(created):
    b = make(created)
    with pytest.raises(bs.InvalidTransition):
        bs.set_status(b["id"], "completed", None)


def test_arrivals_complete_a_confirmed_booking(created):
    b = make(created, deposit_waived=True)
    bs.set_status(b["id"], "confirmed", None, reason="Deposit waived")
    b = bs.record_arrivals(b["id"], 48, "manual", None)
    assert b["status"] == "completed"
    assert b["arrived_count"] == 48 and b["arrived_source"] == "manual"
    assert bs.booking_finance(b)["final_amount"] == Decimal("3360.00")


def test_calendar_and_day_view_include_the_booking(created):
    b = make(created)
    days = bs.calendar_days(VISIT, VISIT)
    assert len(days) == 1
    assert any(x["id"] == b["id"] for x in days[0]["bookings"])
    assert days[0]["tentative_people"] >= 55
    day = bs.day_detail(VISIT)
    mine = next(x for x in day["bookings"] if x["id"] == b["id"])
    assert mine["finance"]["total_amount"] == 3850.0


def test_group_booking_adapter_filters_to_confirmed(created):
    b = make(created)
    assert all(x.id != b["id"] for x in GroupBooking.get_by_date(VISIT))
    bs.set_status(b["id"], "confirmed", None, reason="test")
    found = [x for x in GroupBooking.get_by_date(VISIT) if x.id == b["id"]]
    assert len(found) == 1
    assert found[0].contact_person == "Jane Test"
    assert found[0].mobile_number == "27821234567"
    assert GroupBooking.get_by_barcode(b["barcode"]).group_name == "TEST pytest school"


def test_list_filters(created):
    b = make(created)
    rows, total = bm.list_bookings(q=b["reference"])
    assert total == 1 and rows[0]["id"] == b["id"]
    rows, total = bm.list_bookings(statuses=["cancelled"], q=b["reference"])
    assert total == 0
