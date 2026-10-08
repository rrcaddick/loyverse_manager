"""The public form API against MySQL: config, submission, receipt. No Turnstile
(the secret is blanked), no mail (the acknowledgement toggle stays off, and the
send is stubbed where it is turned on)."""

from __future__ import annotations

import pytest

from src.models.base import execute, query_one
from src.services import public_form

pytestmark = pytest.mark.usefixtures("db")

PAYLOAD = {
    "group_name": "TEST Public API Primary",
    "group_type": "school",
    "contact_name": "Api Tester",
    "contact_email": "api.tester@example.com",
    "contact_mobile": "082 706 9415",
    "visit_date": "2026-11-05",
    "visitors": 42,
    "arrival_time": "10:00",
    "vehicles": 1,
    "gazebos": 2,
    "questions": ["Is there shade?"],
    "policy_accepted": True,
    "website": "",
}


@pytest.fixture
def client(monkeypatch):
    from web.app import create_app

    monkeypatch.setattr(public_form, "TURNSTILE_SECRET_KEY", "")
    monkeypatch.setattr(public_form, "rate_limited", lambda ip: False)
    app = create_app()
    app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
    with app.test_client() as c:
        yield c
    for r in __import__("src.models.base", fromlist=["query"]).query(
        "SELECT id FROM bookings WHERE group_name LIKE 'TEST Public API%%'"
    ):
        execute("DELETE FROM form_submissions WHERE booking_id = %s", (r["id"],))
        execute("DELETE FROM email_messages WHERE booking_id = %s", (r["id"],))
        execute("DELETE FROM bookings WHERE id = %s", (r["id"],))


def test_form_config_carries_the_new_fields(client):
    r = client.get("/api/v1/public/form-config")
    assert r.status_code == 200
    body = r.get_json()
    assert body["arrival_slots"][0] == "09:00" and body["arrival_slots"][-1] == "Not sure yet"
    assert body["max_gazebos"] == 7 and body["max_group_size"] == 900 and body["min_group_size"] == 10
    assert body["acknowledgement_enabled"] is False
    assert r.headers["Cache-Control"] == "no-store"


def test_submit_then_fetch_receipt(client):
    r = client.post("/api/v1/public/booking-request", json=PAYLOAD)
    assert r.status_code == 201, r.get_json()
    body = r.get_json()
    assert set(body) >= {"id", "token", "reference", "group_name", "visit_date", "contact_email", "visitors", "acknowledged"}
    assert body["visitors"] == 42 and body["acknowledged"] is False and body["visit_date"] == "2026-11-05"
    row = query_one("SELECT people_booked, arrival_time, gazebos, status, source FROM bookings WHERE id = %s", (body["id"],))
    assert (row["people_booked"], row["arrival_time"], row["gazebos"], row["status"], row["source"]) == (42, "10:00", 2, "enquiry", "form")
    # Nothing was emailed: the toggle is off by default.
    assert query_one("SELECT COUNT(*) AS n FROM email_messages WHERE booking_id = %s", (body["id"],))["n"] == 0

    r = client.get(f"/api/v1/public/requests/{body['id']}?token={body['token']}")
    assert r.status_code == 200
    receipt = r.get_json()
    assert receipt["reference"] == body["reference"] and receipt["visitors"] == 42 and receipt["acknowledged"] is False
    assert "contact_mobile" not in receipt and "price_per_person" not in receipt
    assert client.get(f"/api/v1/public/requests/{body['id']}").status_code == 403
    assert client.get(f"/api/v1/public/requests/{body['id']}?token=nope").status_code == 403
    assert client.get(f"/api/v1/public/requests/{body['id'] + 1000000}?token={body['token']}").status_code == 403
    other = public_form.request_receipt_token(body["id"] + 1000000)
    assert client.get(f"/api/v1/public/requests/{body['id'] + 1000000}?token={other}").status_code == 404


def test_validation_messages_reach_the_client(client):
    bad = {**PAYLOAD, "visit_date": "2026-11-02", "visitors": 5, "arrival_time": "noon", "gazebos": 9, "policy_accepted": False}
    r = client.post("/api/v1/public/booking-request", json=bad)
    assert r.status_code == 422
    fields = r.get_json()["error"]["fields"]
    assert fields["visit_date"].endswith("The next open day is Wednesday 4 November.")
    assert fields["visitors"].endswith("buy day tickets on Quicket.")
    assert fields["arrival_time"] == "Choose an arrival time from the list"
    assert fields["gazebos"] == "We have 7 gazebos to hire"
    assert fields["policy_accepted"] == "Agree to the booking terms to send your request"


def test_acknowledgement_when_enabled_marks_the_receipt(client, monkeypatch):
    from src.services import mail_send, settings as settings_service

    real = settings_service.get_settings

    def enabled():
        s = real()
        s.form["acknowledgement_enabled"] = True
        return s

    monkeypatch.setattr("web.api.public.get_settings", enabled)
    monkeypatch.setattr(public_form, "get_settings", enabled)
    sent = {}

    def fake_send(**kw):
        sent.update(kw)
        execute(
            """
            INSERT INTO email_messages (direction, kind, from_email, to_emails, subject, sent_at, booking_id, send_status, is_auto_generated)
            VALUES ('outbound', 'acknowledgement', 'test@example.test', '["x"]', %s, NOW(), %s, 'sent', 1)
            """,
            (kw["rendered"].subject, kw["booking_id"]),
        )
        return {"id": 1, "send_status": "sent"}

    monkeypatch.setattr(mail_send, "send_email", fake_send)
    r = client.post("/api/v1/public/booking-request", json={**PAYLOAD, "group_name": "TEST Public API Ack"})
    assert r.status_code == 201, r.get_json()
    body = r.get_json()
    assert body["acknowledged"] is True and sent["kind"] == "acknowledgement" and sent["to"] == ["api.tester@example.com"]
    assert sent["rendered"].subject.startswith("Request received ")
    r = client.get(f"/api/v1/public/requests/{body['id']}?token={body['token']}")
    assert r.get_json()["acknowledged"] is True
