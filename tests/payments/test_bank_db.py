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
    # An odd deposit so no real booking in a shared database ties at the top rank.
    b = data.booking(status="proforma_sent", deposit="2817.00", group_name="TEST Riverbend Academy", contact_name="Pieter Botha")
    tx = data.transaction(amount="2817.00", description="CAPITEC RIVERBEND BOTHA")
    bank.match_new()
    row = bank_model.get(tx["id"])
    assert row["match_status"] == "suggested"
    out = bank_model.serialize(row)
    suggestions = out["suggestions"]
    assert suggestions[0]["booking_id"] == b["id"]
    assert suggestions[0]["confidence"] == "Equals the deposit" and suggestions[0]["tone"] == "green"
    assert "Name words: Botha, Riverbend" in suggestions[0]["reasons"]
    assert out["preselected_booking_id"] == b["id"]
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
    # The deposit confirmed the booking; removing it reverts to proforma_sent.
    after = query_one("SELECT status, confirmed_at FROM bookings WHERE id = %s", (b["id"],))
    assert after["status"] == "proforma_sent" and after["confirmed_at"] is None
    assert out["booking_reverted"] == {
        "id": b["id"], "reference": b["reference"], "from": "confirmed", "to": "proforma_sent",
        "deposit_due": 2800.0, "paid_total": 0.0,
    }
    last = query_one("SELECT kind, summary, data FROM booking_events WHERE booking_id = %s ORDER BY id DESC LIMIT 1", (b["id"],))
    assert last["kind"] == "status_changed" and "Payment unmatched" in last["summary"]


def test_unmatch_keeps_confirmed_when_another_payment_covers_the_deposit(data):
    b = data.booking(status="proforma_sent", deposit="2800.00")
    tx = data.transaction(amount="2800.00", description=f"INV {b['doc_number']} first")
    bank.match_new()
    # A second, manual payment also covers the deposit on its own.
    bank.confirm_match(data.transaction(amount="3000.00", description="TEST second")["id"], b["id"])
    out = bank.unmatch(tx["id"])
    assert out["booking_reverted"] is None
    assert query_one("SELECT status FROM bookings WHERE id = %s", (b["id"],))["status"] == "confirmed"


def test_unmatch_does_not_revert_a_waived_deposit_or_a_completed_visit(data):
    waived = data.booking(status="proforma_sent", deposit="0.00", deposit_waived=True)
    tx = data.transaction(amount="500.00", description="TEST waived part payment")
    bank.confirm_match(tx["id"], waived["id"])
    assert query_one("SELECT status FROM bookings WHERE id = %s", (waived["id"],))["status"] == "confirmed"
    assert bank.unmatch(tx["id"])["booking_reverted"] is None
    assert query_one("SELECT status FROM bookings WHERE id = %s", (waived["id"],))["status"] == "confirmed"

    done = data.booking(status="completed", deposit="2800.00")
    tx2 = data.transaction(amount="2800.00", description="TEST completed")
    bank.confirm_match(tx2["id"], done["id"])
    assert bank.unmatch(tx2["id"])["booking_reverted"] is None
    assert query_one("SELECT status FROM bookings WHERE id = %s", (done["id"],))["status"] == "completed"


def test_ignore_and_unignore(data):
    tx = data.transaction(amount="99.00", description="TEST card settlement")
    out = bank.ignore(tx["id"], "card_settlement", actor=None, note="not a booking")
    assert out["match_status"] == "ignored" and out["ignore_reason"] == "card_settlement: not a booking"
    assert out["ignore"] == {"reason": "card_settlement", "label": "Card settlement", "note": "not a booking"}
    assert out["matched_at"] is not None and out["rule"] is None
    out = bank.unmatch(tx["id"])
    assert out["match_status"] == "unmatched" and out["ignore_reason"] is None and out["ignore"] is None
    # Legacy free text is kept as "other" with the text as the note.
    out = bank.ignore(tx["id"], "  Card settlement, not a booking  ")
    assert out["ignore"] == {"reason": "other", "label": "Other", "note": "Card settlement, not a booking"}


@pytest.fixture
def rules():
    """Delete every rule created by a test (patterns start with TEST-RULE)."""
    from src.models.base import execute

    yield
    execute("DELETE FROM bank_ignore_rules WHERE pattern LIKE 'TEST-RULE%%'")


def test_ignore_with_rule_parks_queued_credits_and_later_polls(data, rules):
    first = data.transaction(amount="10.00", description="TEST-RULE APP TRANSFER FROM RAY")
    sibling = data.transaction(amount="11.00", description="TEST-RULE APP TRANSFER FROM LINDA")
    other = data.transaction(amount="12.00", description="TEST-RULE APP PAYMENT FROM SCHOOL")
    out = bank.ignore(first["id"], "own_transfer", actor=None, create_rule=True)
    assert out["match_status"] == "ignored"
    rule = out["rule"]
    assert rule["created"] is True and rule["applied"] == 1
    assert rule["rule"]["pattern"] == "TEST-RULE APP TRANSFER FROM" and rule["rule"]["reason"] == "own_transfer"
    # The sibling already in the queue was ignored by the rule; the other was not.
    sib = bank_model.get(sibling["id"])
    assert sib["match_status"] == "ignored" and sib["ignore_reason"].startswith("own_transfer: rule:")
    assert bank_model.get(other["id"])["match_status"] == "unmatched"
    # The next poll's matcher applies the rule to a new entry before matching it.
    later = data.transaction(amount="13.00", description="test-rule app transfer from ray again")
    counts = bank.match_new()
    assert counts["ignored"] >= 1
    assert bank_model.get(later["id"])["match_status"] == "ignored"
    # Same pattern again: not duplicated.
    again = bank.create_ignore_rule("TEST-RULE APP TRANSFER FROM", "own_transfer")
    assert again["created"] is False and again["rule"]["id"] == rule["rule"]["id"]
    assert any(r["id"] == rule["rule"]["id"] for r in bank.list_ignore_rules())
    assert bank.delete_ignore_rule(rule["rule"]["id"])["pattern"] == "TEST-RULE APP TRANSFER FROM"
    with pytest.raises(bank.BankError):
        bank.delete_ignore_rule(rule["rule"]["id"])


def test_rule_guards(data, rules):
    with pytest.raises(bank.BankError) as exc:
        bank.create_ignore_rule("TES", "own_transfer")
    assert exc.value.status == 422
    with pytest.raises(bank.BankError):
        bank.create_ignore_rule("TEST-RULE OTHER", "other")
    # "other" never makes a rule, even when asked.
    tx = data.transaction(amount="1.00", description="TEST-RULE OTHER THING")
    assert bank.ignore(tx["id"], "other", create_rule=True)["rule"] is None


def test_needs_attention_view_orders_suggested_then_oldest_unmatched(data):
    from datetime import date as _date

    b = data.booking(status="proforma_sent", deposit="2800.00", group_name="TEST Viewtown Academy", contact_name="Zanele Viewer")
    old = data.transaction(amount="5.00", description="TEST view old", booking_date=_date.today() - timedelta(days=9))
    new = data.transaction(amount="6.00", description="TEST view new", booking_date=_date.today() - timedelta(days=1))
    sug = data.transaction(amount="2800.00", description="CAPITEC VIEWTOWN ZANELE TEST view", booking_date=_date.today() - timedelta(days=3))
    debit = data.transaction(amount="7.00", description="TEST view debit", credit_debit="DEBIT")
    ignored = data.transaction(amount="8.00", description="TEST view ignored")
    bank.ignore(ignored["id"], "interest")
    bank.match_new()
    rows, total = bank_model.list_transactions(view="needs_attention", q="TEST view", page_size=50)
    ids = [r["id"] for r in rows]
    assert ids == [sug["id"], old["id"], new["id"]]
    assert debit["id"] not in ids and ignored["id"] not in ids
    rows, _ = bank_model.list_transactions(view="matched", q="TEST view")
    assert rows == []
    rows, _ = bank_model.list_transactions(view="all", q="TEST view", page_size=50)
    assert {r["id"] for r in rows} == {old["id"], new["id"], sug["id"], debit["id"], ignored["id"]}
    with pytest.raises(ValueError):
        bank_model.list_transactions(view="bogus")


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
    assert set(s) == {"counts", "to_confirm", "unmatched_credits_30d", "needs_attention", "last_poll"}
    assert set(s["counts"]) == set(bank_model.STATUSES)
    assert s["unmatched_credits_30d"]["count"] >= 1
    assert s["needs_attention"] == s["to_confirm"] + s["unmatched_credits_30d"]["count"]
    if s["last_poll"] is not None:
        assert {"id", "started_at", "finished_at", "status", "window_from", "window_to",
                "entries", "new_entries", "error"} == set(s["last_poll"])


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
    assert r.status_code == 422  # the reason is one of four codes now
    r = client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/ignore", json={"reason": "interest", "note": "bank interest"}, headers=headers)
    assert r.status_code == 200
    body = r.get_json()
    assert body["transaction"]["match_status"] == "ignored" and body["rule"] is None
    assert body["transaction"]["ignore"] == {"reason": "interest", "label": "Interest", "note": "bank interest"}
    r = client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/unmatch", json={}, headers=headers)
    assert r.status_code == 200
    assert r.get_json()["transaction"]["match_status"] == "unmatched" and r.get_json()["booking_reverted"] is None
    # CSRF is enforced on writes.
    assert client.post(f"/api/v1/payments/bank-transactions/{tx['id']}/ignore", json={"reason": "other"}).status_code == 403
    assert client.get("/api/v1/payments/bank-transactions?view=bogus").status_code == 400
    r = client.get("/api/v1/payments/bank-transactions?view=needs_attention&q=api+row")
    assert r.status_code == 200 and r.get_json()["total"] == 1

    r = client.get("/api/v1/payments/summary")
    assert r.status_code == 200 and {"counts", "needs_attention", "to_confirm", "last_poll"} <= set(r.get_json())


def test_api_ignore_rules(client, data, rules):
    headers = {"X-CSRF-Token": "test-csrf"}
    tx = data.transaction(amount="3.00", description="TEST-RULE CARD SETTLE 123456")
    r = client.post(
        f"/api/v1/payments/bank-transactions/{tx['id']}/ignore",
        json={"reason": "card_settlement", "create_rule": True},
        headers=headers,
    )
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["rule"]["rule"]["pattern"] == "TEST-RULE CARD SETTLE" and body["rule"]["created"] is True
    rule_id = body["rule"]["rule"]["id"]
    r = client.get("/api/v1/payments/ignore-rules")
    assert r.status_code == 200 and any(x["id"] == rule_id for x in r.get_json()["items"])
    # "other" may not create a rule.
    tx2 = data.transaction(amount="4.00", description="TEST-RULE OTHER")
    r = client.post(f"/api/v1/payments/bank-transactions/{tx2['id']}/ignore", json={"reason": "other", "create_rule": True}, headers=headers)
    assert r.status_code == 422
    # Explicit creation and deletion.
    r = client.post("/api/v1/payments/ignore-rules", json={"pattern": "TEST-RULE EXPLICIT", "reason": "interest"}, headers=headers)
    assert r.status_code == 201 and r.get_json()["rule"]["reason"] == "interest"
    explicit_id = r.get_json()["rule"]["id"]
    assert client.post("/api/v1/payments/ignore-rules", json={"pattern": "TEST-RULE EXPLICIT", "reason": "interest"}, headers=headers).status_code == 200
    assert client.delete(f"/api/v1/payments/ignore-rules/{explicit_id}", headers=headers).status_code == 200
    assert client.delete(f"/api/v1/payments/ignore-rules/{explicit_id}", headers=headers).status_code == 404
    assert client.delete(f"/api/v1/payments/ignore-rules/{rule_id}", headers=headers).status_code == 200


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
    assert r.get_json()["booking_reverted"]["to"] == "proforma_sent"
    assert query_one("SELECT status FROM bookings WHERE id = %s", (b["id"],))["status"] == "proforma_sent"
    assert bank_model.payment_for_transaction(tx["id"]) is None
