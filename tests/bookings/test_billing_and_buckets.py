"""Billing fields on a booking and the list tabs' buckets (docs/redesign-spec.md §6, §9)."""

from __future__ import annotations

import copy

import pytest

from src.models import booking as bm
from src.services import booking as bs
from src.services import pricing
from src.services.settings import DEFAULTS, Settings


@pytest.fixture
def s():
    return Settings(copy.deepcopy(DEFAULTS))


@pytest.fixture(autouse=True)
def patched_tiers(monkeypatch):
    monkeypatch.setattr(pricing, "get_price_tier", lambda code: {"code": code, "price": 70} if code else None)
    monkeypatch.setattr(pricing, "load_season_days", lambda a, b: {})


def test_billing_fields_are_accepted_and_bounded(s):
    clean = bs.validate_booking_data(
        {"billing_address": "  12 Church St\nKuils River  ", "customer_vat_number": " 4123456789 "},
        partial=True,
        settings=s,
    )
    assert clean == {"billing_address": "12 Church St\nKuils River", "customer_vat_number": "4123456789"}
    with pytest.raises(bs.BookingError) as exc:
        bs.validate_booking_data({"billing_address": "x" * 501}, partial=True, settings=s)
    assert exc.value.fields == {"billing_address": "At most 500 characters"}
    with pytest.raises(bs.BookingError) as exc:
        bs.validate_booking_data({"customer_vat_number": "4" * 33}, partial=True, settings=s)
    assert exc.value.fields == {"customer_vat_number": "At most 32 characters"}
    # Blank clears the field.
    assert bs.validate_booking_data({"billing_address": "", "customer_vat_number": None}, partial=True, settings=s) == {
        "billing_address": None, "customer_vat_number": None,
    }
    assert {"billing_address", "customer_vat_number"} <= bm.WRITABLE_COLUMNS


def test_buckets_cover_every_status_once():
    assert bm.BUCKETS["pending"] == ("enquiry", "proforma_sent")
    assert bm.BUCKETS["confirmed"] == ("confirmed",)
    assert bm.BUCKETS["lapsed"] == ("lapsed", "cancelled")
    assert bm.BUCKETS["past"] == ("completed", "no_show")
    seen = [st for key, sts in bm.BUCKETS.items() if key != "all" for st in sts]
    assert sorted(seen) == sorted(bm.STATUSES)


def test_counts_by_bucket_sums_statuses():
    by_status = {"enquiry": 3, "proforma_sent": 4, "confirmed": 5, "completed": 6, "cancelled": 1, "lapsed": 2, "no_show": 1}
    assert bm.counts_by_bucket(by_status) == {"pending": 7, "confirmed": 5, "lapsed": 3, "past": 7, "all": 22}


# ------------------------------------------------------------------ DB ---

try:
    from src.models.base import query_one

    query_one("SELECT 1 AS ok")
    DB_OK = True
except Exception:  # noqa: BLE001
    DB_OK = False


@pytest.mark.skipif(not DB_OK, reason="MySQL not reachable")
def test_billing_fields_round_trip_and_counts_endpoint():
    from src.models.base import execute
    from web.api import SESSION_CSRF_KEY, SESSION_USER_KEY
    from web.app import create_app

    created = []
    email = "test-billing-agent@example.test"
    execute("DELETE FROM users WHERE email = %s", (email,))
    admin_id = execute(
        "INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active) "
        "VALUES (%s, 'TEST billing admin', 'admin', 'x', 0, 1)",
        (email,),
    )
    try:
        row = bs.create_booking(
            {
                "group_name": "TEST billing pytest",
                "group_type": "church",
                "contact_name": "Bill Test",
                "visit_date": "2026-11-14",
                "visitors": 40,
                "billing_address": "1 Statement Road\nKlapmuts",
                "customer_vat_number": "4000000001",
            },
            source="manual",
            actor=None,
        )
        created.append(row["id"])
        assert row["billing_address"] == "1 Statement Road\nKlapmuts" and row["customer_vat_number"] == "4000000001"
        row = bs.update_booking(row["id"], {"customer_vat_number": "4000000002"}, actor=None)
        assert row["customer_vat_number"] == "4000000002"
        detail = bs.get_booking_detail(row["id"])
        assert detail["billing_address"] == "1 Statement Road\nKlapmuts" and detail["customer_vat_number"] == "4000000002"
        events = query_one("SELECT data FROM booking_events WHERE booking_id = %s ORDER BY id DESC LIMIT 1", (row["id"],))
        assert "customer_vat_number" in str(events["data"])

        app = create_app()
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        with app.test_client() as c:
            with c.session_transaction() as sess:
                sess[SESSION_USER_KEY] = admin_id
                sess[SESSION_CSRF_KEY] = "test-csrf"
            r = c.get("/api/v1/bookings/counts")
            assert r.status_code == 200
            body = r.get_json()
            assert {"counts", "pending", "confirmed", "lapsed", "past", "all"} <= set(body)
            assert body["pending"] == body["counts"]["enquiry"] + body["counts"]["proforma_sent"] and body["pending"] >= 1
            assert body["all"] == sum(body["counts"].values())
            r = c.get("/api/v1/bookings?bucket=pending&q=TEST+billing+pytest")
            assert r.status_code == 200 and r.get_json()["total"] == 1
            item = r.get_json()["items"][0]
            assert item["customer_vat_number"] == "4000000002" and item["billing_address"].startswith("1 Statement")
            assert c.get("/api/v1/bookings?bucket=past&q=TEST+billing+pytest").get_json()["total"] == 0
            assert c.get("/api/v1/bookings?bucket=all&q=TEST+billing+pytest").get_json()["total"] == 1
            assert c.get("/api/v1/bookings?bucket=pending&status=confirmed&q=TEST+billing+pytest").get_json()["total"] == 0
            assert c.get("/api/v1/bookings?bucket=nope").status_code == 422
            r = c.patch(
                f"/api/v1/bookings/{row['id']}",
                json={"billing_address": "x" * 501},
                headers={"X-CSRF-Token": "test-csrf"},
            )
            assert r.status_code == 422 and "billing_address" in r.get_json()["error"]["fields"]
    finally:
        for bid in created:
            bm.delete(bid)
        execute("DELETE FROM users WHERE id = %s", (admin_id,))
