"""DB round trip: insert-once semantics, automatic matching through the real
bookings service, unmatch/ignore, the poll log and the admin API.

Needs the local MySQL from .env with migration 007 applied; skipped otherwise.
Every booking created has a group_name starting with "TEST ", every bank
transaction a fingerprint starting with "test-"; all are deleted afterwards.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from src.models import bank_transaction as bank_model
from src.models.base import query, query_one
from src.services import bank
from web.api import SESSION_CSRF_KEY, SESSION_USER_KEY

pytestmark = pytest.mark.usefixtures("require_db")


# ---------------------------------------------------------------- model ---

def test_upsert_by_fingerprint_inserts_once(data):
    tx = data.transaction(amount="10.00", description="TEST once")
    again_id, created = bank_model.upsert_by_fingerprint(
        {
            "fingerprint": tx["fingerprint"],
            "account_number": "00000000000",
            "booking_date": tx["booking_date"],
            "amount": Decimal("10.00"),
            "credit_debit": "CREDIT",
        }
    )
    assert (again_id, created) == (tx["id"], False)
    assert query_one("SELECT COUNT(*) AS n FROM bank_transactions WHERE fingerprint = %s", (tx["fingerprint"],))["n"] == 1


def test_list_filters_and_serialize(data):
    tx = data.transaction(amount="123.45", description="TEST list me", end_to_end_id="E2E-TEST-1")
    debit = data.transaction(amount="5.00", description="TEST debit", credit_debit="DEBIT")
    rows, total = bank_model.list_transactions(q="list me")
    assert total == 1 and rows[0]["id"] == tx["id"]
    rows, total = bank_model.list_transactions(q="123.45")
    assert tx["id"] in {r["id"] for r in rows}
    rows, _ = bank_model.list_transactions(credit_debit="DEBIT", q="TEST debit")
    assert [r["id"] for r in rows] == [debit["id"]]
    rows, _ = bank_model.list_transactions(status="matched", q="list me")
    assert rows == []
    rows, _ = bank_model.list_transactions(date_from=date.today() + timedelta(days=1), q="list me")
    assert rows == []
    out = bank_model.serialize(bank_model.get(tx["id"]))
    assert out["amount"] == 123.45 and out["matched_booking"] is None and out["suggestions"] == []
    assert "raw" not in out and out["match_status"] == "unmatched"
    assert bank_model.latest_booking_date() >= date.today()


def test_poll_log_round_trip(data):
    before = bank_model.poll_count()
    poll_id = bank_model.start_poll(date(2026, 7, 3), date(2026, 10, 9))
    try:
        assert bank_model.poll_count() == before + 1
        bank_model.finish_poll(poll_id, "failed", error="TEST boom")
        last = bank_model.last_poll()
        assert last["id"] == poll_id and last["status"] == "failed" and last["error"] == "TEST boom"
        assert last["finished_at"] is not None
    finally:
        from src.models.base import execute

        execute("DELETE FROM bank_poll_log WHERE id = %s", (poll_id,))


# ------------------------------------------------------------- matching ---

def test_strong_match_records_payment_and_confirms_booking(data):
    b = data.booking(status="proforma_sent", people=50, price="70.00", deposit="2800.00")
    tx = data.transaction(amount="2800.00", description=f"ABSA BANK {b['reference']} SCHOOL")
    counts = bank.match_new()
    assert counts["matched"] >= 1

    tx_after = bank_model.get(tx["id"])
    assert tx_after["match_status"] == "matched"
    assert tx_after["matched_booking_id"] == b["id"]
    assert tx_after["match_method"] == "reference"
    assert tx_after["matched_at"] is not None and tx_after["matched_by"] is None

    payment = bank_model.payment_for_transaction(tx["id"])
    assert payment["booking_id"] == b["id"] and payment["kind"] == "eft"
    assert Decimal(str(payment["amount"])) == Decimal("2800.00")
    assert payment["paid_on"] == tx["booking_date"]
    assert payment["note"] == "Matched from FNB"

    booking_after = query_one("SELECT status FROM bookings WHERE id = %s", (b["id"],))
    assert booking_after["status"] == "confirmed"  # the bookings service auto-confirmed

    kinds = [r["kind"] for r in query("SELECT kind FROM booking_events WHERE booking_id = %s ORDER BY id", (b["id"],))]
    assert "payment_recorded" in kinds and "payment_matched" in kinds and "status_changed" in kinds
    # No email was sent: nothing in email_messages points at this booking.
    assert query_one("SELECT COUNT(*) AS n FROM email_messages WHERE booking_id = %s", (b["id"],))["n"] == 0


def test_match_new_is_idempotent_and_handles_partial_deposit(data):
    b = data.booking(status="proforma_sent", deposit="2800.00")
    tx = data.transaction(amount="1000.00", description=f"{b['reference']} part 1")
    bank.match_new()
    bank.match_new()
    assert query_one("SELECT COUNT(*) AS n FROM payments WHERE bank_transaction_id = %s", (tx["id"],))["n"] == 1
    assert query_one("SELECT status FROM bookings WHERE id = %s", (b["id"],))["status"] == "proforma_sent"
    tx2 = data.transaction(amount="1800.00", description=f"{b['reference']} part 2")
    bank.match_new()
    assert bank_model.get(tx2["id"])["match_status"] == "matched"
    assert query_one("SELECT status FROM bookings WHERE id = %s", (b["id"],))["status"] == "confirmed"


def test_suggested_match_stores_suggestions_and_rematches_later(data):
    b = data.booking(status="proforma_sent", deposit="2800.00", group_name="TEST Riverbend Academy", contact_name="Pieter Botha")
    tx = data.transaction(amount="2800.00", description="CAPITEC RIVERBEND BOTHA")
    bank.match_new()
    row = bank_model.get(tx["id"])
    assert row["match_status"] == "suggested"
    suggestions = bank_model.serialize(row)["suggestions"]
    assert suggestions[0]["booking_id"] == b["id"]
    assert suggestions[0]["score"] >= 70
    assert query_one("SELECT COUNT(*) AS n FROM payments WHERE bank_transaction_id = %s", (tx["id"],))["n"] == 0

    # Operator confirms the suggestion.
    payment = bank.confirm_match(tx["id"], b["id"], actor=None, method="manual")
    assert payment["bank_transaction_id"] == tx["id"]
    row = bank_model.get(tx["id"])
    assert row["match_status"] == "matched" and row["match_method"] == "manual" and row["suggestions"] is None


def test_unmatch_removes_payment_and_resets(data):
    b = data.booking(status="proforma_sent", deposit="2800.00")
    tx = data.transaction(amount="2800.00", description=f"INV {b['doc_number']}")
    bank.match_new()
    assert bank_model.payment_for_transaction(tx["id"]) is not None

    out = bank.unmatch(tx["id"], actor=None)
    assert out["match_status"] == "unmatched" and out["matched_booking"] is None
    assert bank_model.payment_for_transaction(tx["id"]) is None
    assert query_one("SELECT COUNT(*) AS n FROM payments WHERE booking_id = %s", (b["id"],))["n"] == 0
    kinds = [r["kind"] for r in query("SELECT kind FROM booking_events WHERE booking_id = %s ORDER BY id", (b["id"],))]
    assert "payment_deleted" in kinds and "payment_unmatched" in kinds
    # Status is deliberately left alone (no legal transition back from confirmed).
    assert query_one("SELECT status FROM bookings WHERE id = %s", (b["id"],))["status"] == "confirmed"


def test_ignore_and_unignore(data):
    tx = data.transaction(amount="99.00", description="TEST card settlement")
    out = bank.ignore(tx["id"], "  Card settlement, not a booking  ", actor=None)
    assert out["match_status"] == "ignored" and out["ignore_reason"] == "Card settlement, not a booking"
    assert out["matched_at"] is not None
    out = bank.unmatch(tx["id"])
    assert out["match_status"] == "unmatched" and out["ignore_reason"] is None


def test_confirm_match_guards(data):
    b1 = data.booking(status="proforma_sent")
    b2 = data.booking(status="proforma_sent")
    tx = data.transaction(amount="100.00", description="TEST guard")
    debit = data.transaction(amount="100.00", description="TEST guard debit", credit_debit="DEBIT")
    bank.confirm_match(tx["id"], b1["id"], actor=None)
    with pytest.raises(bank.BankError) as exc:
        bank.confirm_match(tx["id"], b2["id"], actor=None)
    assert exc.value.status == 409
    with pytest.raises(bank.BankError) as exc:
        bank.ignore(tx["id"], "x")
    assert exc.value.status == 409
    with pytest.raises(bank.BankError) as exc:
        bank.confirm_match(debit["id"], b1["id"], actor=None)
    assert exc.value.status == 422
    fresh = data.transaction(amount="1.00", description="TEST guard fresh")
    with pytest.raises(bank.BankError) as exc:
        bank.confirm_match(fresh["id"], 999999999, actor=None)
    assert exc.value.status == 404
    # Re-confirming the same pairing is a no-op that keeps the single payment.
    bank.confirm_match(tx["id"], b1["id"], actor=None)
    assert query_one("SELECT COUNT(*) AS n FROM payments WHERE bank_transaction_id = %s", (tx["id"],))["n"] == 1


def test_summary_shape(data):
    data.transaction(amount="7.00", description="TEST summary")
    s = bank.summary()
    assert set(s) == {"counts", "unmatched_credits_30d", "last_poll"}
    assert set(s["counts"]) == set(bank_model.STATUSES)
    assert s["unmatched_credits_30d"]["count"] >= 1


# ----------------------------------------------------------------- API ---

@pytest.fixture
def client(data):
    from web.app import create_app

    app = create_app()
    app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
    user = data.admin_user()
    with app.test_client() as c:
        with c.session_transaction() as sess:
            sess[SESSION_USER_KEY] = user["id"]
            sess[SESSION_CSRF_KEY] = "test-csrf"
        yield c


def test_api_list_get_ignore_unmatch(client, data):
    tx = data.transaction(amount="42.00", description="TEST api row", end_to_end_id="E2E-API")
    r = client.get("/api/v1/payments/bank-transactions?q=api+row&status=unmatched")
    assert r.status_code == 200
    body = r.get_json()
    assert body["total"] == 1 and body["page"] == 1
    item = body["items"][0]
    assert item["id"] == tx["id"] and item["amount"] == 42.0 and item["matched_booking"] is None
    assert {"booking_date", "description", "end_to_end_id", "credit_debit", "balance_after",
            "match_status", "suggestions", "match_method", "matched_at"} <= set(item)

    r = client.get(f"/api/v1/payments/bank-transactions/{tx['id']}")
    assert r.status_code == 200 and r.get_json()["end_to_end_id"] == "E2E-API"
    assert client.get("/api/v1/payments/bank-transactions/999999999").status_code == 404
    assert client.get("/api/v1/payments/bank-transactions?status=bogus").status_code == 400
    assert client.get("/api/v1/payments/bank-transactions?from=2026-13-01").status_code == 400

    headers = {"X-CSRF-Token": "test-csrf"}
    r = client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/ignore", json={"reason": "TEST"}, headers=headers)
    assert r.status_code == 200 and r.get_json()["transaction"]["match_status"] == "ignored"
    r = client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/unmatch", json={}, headers=headers)
    assert r.status_code == 200 and r.get_json()["transaction"]["match_status"] == "unmatched"
    # CSRF is enforced on writes.
    assert client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/ignore", json={"reason": "x"}).status_code == 403

    r = client.get("/api/v1/payments/summary")
    assert r.status_code == 200 and "counts" in r.get_json()


def test_api_match_and_unmatch(client, data):
    b = data.booking(status="proforma_sent", deposit="2800.00")
    tx = data.transaction(amount="2800.00", description="TEST api match")
    headers = {"X-CSRF-Token": "test-csrf"}
    r = client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/match", json={"booking_id": b["id"]}, headers=headers)
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["transaction"]["match_status"] == "matched"
    assert body["transaction"]["matched_booking"] == {"id": b["id"], "reference": b["reference"], "group_name": b["group_name"]}
    assert body["transaction"]["match_method"] == "manual"
    assert body["payment"]["bank_transaction_id"] == tx["id"]
    assert bank_model.get(tx["id"])["matched_by"] is not None
    assert query_one("SELECT status FROM bookings WHERE id = %s", (b["id"],))["status"] == "confirmed"

    r = client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/match", json={"booking_id": b["id"] + 1}, headers=headers)
    assert r.status_code in (404, 409)
    r = client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/match", json={}, headers=headers)
    assert r.status_code == 422
    r = client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/unmatch", json={}, headers=headers)
    assert r.status_code == 200 and r.get_json()["transaction"]["match_status"] == "unmatched"
    assert bank_model.payment_for_transaction(tx["id"]) is None
