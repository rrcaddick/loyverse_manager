"""Queue builder and reminder recompute against real rows (group_name 'TEST ...')."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from src.models.base import execute, query, query_one
from src.services import reminders
from src.services.public_form import _fallback_create_booking, _fallback_record_payment
from src.utils.date import get_today
from tests.ops.conftest import delete_test_bookings

pytestmark = pytest.mark.usefixtures("db")


def make(group, visit, status, **cols):
    booking = _fallback_create_booking(
        {
            "group_name": group,
            "group_type": "church",
            "contact_name": "Test Contact",
            "contact_email": f"{group.split()[-1].lower()}@example.test",
            "contact_mobile": "27820000000",
            "visit_date": visit.isoformat(),
            "adults": 50,
            "children": 10,
            "people_booked": 60,
            "price_per_person": "95.00",
        },
        "manual",
        None,
    )
    cols.setdefault("status", status)
    assignments = ", ".join(f"{k} = %s" for k in cols)
    execute(f"UPDATE bookings SET {assignments} WHERE id = %s", (*cols.values(), booking["id"]))
    return query_one("SELECT * FROM bookings WHERE id = %s", (booking["id"],))


@pytest.fixture
def rows():
    delete_test_bookings()
    today = get_today()
    a = make("TEST Confirmed Church", today + timedelta(days=2), "confirmed", confirmed_at=datetime.now())
    b = make(
        "TEST Proforma Church",
        today + timedelta(days=5),
        "proforma_sent",
        proforma_sent_at=datetime.combine(today - timedelta(days=10), datetime.min.time()),
        hold_expires_on=today + timedelta(days=1),
    )
    c = make("TEST Enquiry Church", today + timedelta(days=20), "enquiry")
    execute(
        """
        INSERT INTO email_messages (direction, from_name, from_email, subject, sent_at, booking_id, snippet)
        VALUES ('outbound', 'Park', 'park@example.test', 'Your proforma', %s, %s, 'Attached'),
               ('inbound', 'Customer', 'enquiry@example.test', 'Re: Your proforma', %s, %s, 'Thanks, question...')
        """,
        (datetime.now() - timedelta(hours=2), b["id"], datetime.now() - timedelta(hours=1), b["id"]),
    )
    yield {"a": a, "b": b, "c": c}
    delete_test_bookings()


def refs(section, key="booking"):
    return {item[key]["reference"] for item in section["items"]}


def section(queue, key):
    return next(s for s in queue["sections"] if s["key"] == key)


def test_queue_sections_and_reminders(rows):
    a, b, c = rows["a"], rows["b"], rows["c"]
    applicable = reminders.recompute_reminders()
    assert applicable >= 1

    queue = reminders.build_queue()
    assert [s["key"] for s in queue["sections"]] == [
        "needs_reply", "unmatched_emails", "new_requests", "payments_to_confirm", "unmatched_credits",
        "reminders_due", "tickets_to_send", "visits_this_week", "arrivals_to_record", "lapsing",
    ]
    for s in queue["sections"]:
        assert s["count"] == (sum(g["count"] for g in s["items"]) if s["key"] == "reminders_due" else len(s["items"]))

    assert b["reference"] in refs(section(queue, "needs_reply"))
    reply = next(i for i in section(queue, "needs_reply")["items"] if i["booking"]["reference"] == b["reference"])
    assert reply["message"]["subject"] == "Re: Your proforma"

    assert c["reference"] in refs(section(queue, "new_requests"))
    assert a["reference"] not in refs(section(queue, "new_requests"))

    assert a["reference"] in refs(section(queue, "tickets_to_send"))
    week = section(queue, "visits_this_week")
    assert {a["reference"], b["reference"]} <= refs(week)
    item_a = next(i for i in week["items"] if i["booking"]["reference"] == a["reference"])
    assert item_a["finance"] == {
        "price_per_person": 95.0, "total_amount": 5700.0, "deposit_due": 3800.0, "deposit_waived": False,
        "paid_total": 0.0, "balance_due": 5700.0,
    }

    assert b["reference"] in refs(section(queue, "lapsing"))
    lapsing_b = next(i for i in section(queue, "lapsing")["items"] if i["booking"]["reference"] == b["reference"])
    assert lapsing_b["days_left"] == 1

    due = section(queue, "reminders_due")
    kinds = {g["kind"]: g for g in due["items"]}
    assert b["reference"] in {i["booking"]["reference"] for i in kinds["still_interested"]["items"]}
    assert b["reference"] in {i["booking"]["reference"] for i in kinds["deposit_reminder"]["items"]}
    assert "lapse" not in kinds or b["reference"] not in {i["booking"]["reference"] for i in kinds["lapse"]["items"]}

    # dismiss one and make sure recompute does not resurrect it
    target = next(i for i in kinds["still_interested"]["items"] if i["booking"]["reference"] == b["reference"])
    dismissed = reminders.dismiss_reminder(target["reminder_id"], None)
    assert dismissed["status"] == "dismissed"
    assert query_one(
        "SELECT 1 FROM booking_events WHERE booking_id = %s AND kind = 'reminder_dismissed'", (b["id"],)
    )
    reminders.recompute_reminders()
    assert query_one("SELECT status FROM booking_reminders WHERE id = %s", (target["reminder_id"],))["status"] == "dismissed"
    assert reminders.dismiss_reminder(999999999, None) is None

    # deposit arrives -> confirmed; unpaid reminders go, final_details appears
    _fallback_record_payment(b["id"], "eft", Decimal("3800.00"), get_today(), "TEST EFT", None, None)
    assert query_one("SELECT status FROM bookings WHERE id = %s", (b["id"],))["status"] == "confirmed"
    reminders.recompute_reminders()
    kinds_now = {r["kind"]: r["status"] for r in query("SELECT kind, status FROM booking_reminders WHERE booking_id = %s", (b["id"],))}
    assert kinds_now == {"final_details": "due"}

    # sent rows survive a recompute even when the condition is gone
    reminders.mark_sent(a["id"], "deposit_reminder")
    reminders.recompute_reminders()
    assert query_one(
        "SELECT status FROM booking_reminders WHERE booking_id = %s AND kind = 'deposit_reminder'", (a["id"],)
    )["status"] == "sent"


def test_arrivals_to_record_uses_past_confirmed(rows):
    today = get_today()
    old = make("TEST Yesterday Church", today - timedelta(days=1), "confirmed")
    queue = reminders.build_queue()
    assert old["reference"] in refs(section(queue, "arrivals_to_record"))
    execute("UPDATE bookings SET arrived_count = 40, arrived_source = 'manual' WHERE id = %s", (old["id"],))
    queue = reminders.build_queue()
    assert old["reference"] not in refs(section(queue, "arrivals_to_record"))
