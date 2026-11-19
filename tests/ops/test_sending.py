"""Automatic expiry and the sending rules (6 Nov 2026). Needs the local MySQL."""

from datetime import date, timedelta

import pytest

try:
    from src.models.base import query_one

    query_one("SELECT 1 AS ok")
    DB_OK = True
except Exception:  # noqa: BLE001
    DB_OK = False

pytestmark = pytest.mark.skipif(not DB_OK, reason="MySQL not reachable")

from src.models import booking as bm  # noqa: E402
from src.models.base import execute  # noqa: E402
from src.services import booking as bs  # noqa: E402
from src.services import sending  # noqa: E402
from src.utils.date import get_today  # noqa: E402


@pytest.fixture
def created():
    ids: list[int] = []
    yield ids
    for booking_id in ids:
        bm.delete(booking_id)


def make(created, **overrides):
    today = get_today()
    data = {
        "group_name": "TEST Sending pytest church",
        "group_type": "church",
        "area": "TEST Paarl",
        "contact_name": "Jane Test",
        "contact_email": "sending.pytest@example.com",
        "contact_mobile": "082 555 0404",
        "visit_date": (today + timedelta(days=40)).isoformat(),
        "adults": 10,
        "children": 40,
        "status": "proforma_sent",
    }
    data.update(overrides)
    row = bs.create_booking(data, source="manual", actor=None)
    created.append(row["id"])
    return row


def test_a_pending_booking_past_its_expiry_becomes_expired_and_comes_back(created):
    today = get_today()
    b = make(created)
    execute("UPDATE bookings SET hold_expires_on = %s WHERE id = %s", (today - timedelta(days=1), b["id"]))
    expired = sending.expire_holds(today)
    assert any(x["booking_id"] == b["id"] for x in expired)
    row = bm.get(b["id"])
    assert row["status"] == "lapsed" and row["lapsed_at"] is not None
    # The notice is planned (whatever the mode) because it was never sent.
    assert any(c["rule"] == "expiry" and c["booking_id"] == b["id"] for c in sending.plan(today))
    # A new deposit date brings it back to Pending, the proforma date untouched.
    proforma_at = row["proforma_sent_at"]
    bs.update_booking(b["id"], {"hold_expires_on": (today + timedelta(days=5)).isoformat()}, None)
    row = bm.get(b["id"])
    assert row["status"] == "proforma_sent" and row["lapsed_at"] is None and row["proforma_sent_at"] == proforma_at


def test_a_deposit_after_expiry_confirms_the_booking(created):
    today = get_today()
    b = make(created)
    execute("UPDATE bookings SET hold_expires_on = %s WHERE id = %s", (today - timedelta(days=2), b["id"]))
    sending.expire_holds(today)
    assert bm.get(b["id"])["status"] == "lapsed"
    bs.record_payment(b["id"], "eft", bm.get(b["id"])["deposit_due"], today, "late deposit", None, None)
    row = bm.get(b["id"])
    assert row["status"] == "confirmed" and row["lapsed_at"] is None and row["confirmed_at"] is not None


def test_the_preview_lists_every_rule_with_its_mode():
    p = sending.preview(get_today())
    assert [r["key"] for r in p["rules"]] == [r["key"] for r in sending.RULES]
    assert all(r["mode"] in ("manual", "automatic") for r in p["rules"])
    assert p["rules"][5]["key"] == "ticket" and p["rules"][5]["days_before"] is not None


def test_the_pass_sends_nothing_while_the_switch_is_off(created):
    from web.api.bookings import run_automatic_sends
    from web.app import create_app

    app = create_app()
    with app.test_request_context():
        out = run_automatic_sends(get_today(), send=False)
    assert out["enabled"] is False and out["sent"] == []
    assert all(c["why"] in ("manual", "sending switched off", "no email address") for c in out["skipped"])
