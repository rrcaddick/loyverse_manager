"""Matching rules and the poll window, with in-memory candidates (no database)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from src.services import bank
from src.services.bank import (
    HISTORY_FLOOR,
    MatchResult,
    candidate_finance,
    match_transaction,
    parse_reference_numbers,
    poll_window,
    significant_words,
)

TODAY = date(2026, 10, 8)


# ------------------------------------------------------------------ parsing ---

def test_prefixed_reference_forms():
    for text in ("FY1703", "fy1703", "FY 1703", "FY-1703", "INV1703", "inv 1703", "Inv-1703", "Payment FY1703 school"):
        prefixed, bare = parse_reference_numbers(text)
        assert prefixed == [1703], text
        assert bare == [], text


def test_bare_four_digit_numbers_only():
    prefixed, bare = parse_reference_numbers("CAPITEC 1703 SMITH 20261005 123 12345")
    assert prefixed == []
    assert bare == [1703]


def test_prefixed_number_is_not_repeated_as_bare_and_both_sources_count():
    prefixed, bare = parse_reference_numbers("FY1703 deposit 1704", "INV1705")
    assert prefixed == [1703, 1705]
    assert bare == [1704]


def test_parse_handles_none_and_empty():
    assert parse_reference_numbers(None, "") == ([], [])


def test_significant_words_filters_boilerplate_and_short_words():
    words = significant_words("ABSA BANK Payment from St Mary Primary School EFT deposit")
    assert words == {"MARY", "PRIMARY", "SCHOOL"}
    assert significant_words(None) == set()


# ------------------------------------------------------------------- window ---

def test_window_first_poll_starts_at_history_floor_or_season_lead():
    season_start = date(2026, 10, 31)
    window_from, window_to = poll_window(TODAY, None, season_start, 0)
    assert window_from == max(HISTORY_FLOOR, season_start - timedelta(days=120))
    assert window_from == date(2026, 7, 3)
    assert window_to == TODAY + timedelta(days=1)


def test_window_follows_latest_entry_with_overlap():
    window_from, _ = poll_window(TODAY, date(2026, 10, 7), date(2026, 10, 31), 5)
    assert window_from == date(2026, 10, 4)
    # Never earlier than the production floor, even with a very early season.
    window_from, _ = poll_window(TODAY, date(2026, 5, 1), date(2026, 6, 1), 5)
    assert window_from == HISTORY_FLOOR
    # Never after today.
    window_from, _ = poll_window(TODAY, TODAY + timedelta(days=30), date(2026, 1, 1), 0)
    assert window_from == TODAY


def test_window_to_rotates_through_28_distinct_dates():
    tos = {poll_window(TODAY, None, date(2026, 10, 31), n)[1] for n in range(28)}
    assert len(tos) == 28
    assert min(tos) == TODAY + timedelta(days=1)
    assert max(tos) == TODAY + timedelta(days=28)
    assert poll_window(TODAY, None, date(2026, 10, 31), 28)[1] == TODAY + timedelta(days=1)


# ----------------------------------------------------------------- matching ---

def booking(doc: int, **overrides) -> dict:
    row = {
        "id": doc,
        "reference": f"FY{doc}",
        "doc_number": doc,
        "status": "proforma_sent",
        "group_name": "Sunnyside Primary School",
        "contact_name": "Nomsa Dlamini",
        "visit_date": TODAY + timedelta(days=20),
        "people_booked": 50,
        "price_per_person": Decimal("70.00"),
        "deposit_due": Decimal("2800.00"),
        "deposit_waived": 0,
        "paid_total": Decimal("0.00"),
    }
    row.update(overrides)
    return row


def credit(amount, description, e2e=None) -> dict:
    return {
        "id": 1,
        "credit_debit": "CREDIT",
        "amount": Decimal(str(amount)),
        "description": description,
        "end_to_end_id": e2e,
        "booking_date": TODAY,
    }


def test_candidate_finance():
    fin = candidate_finance(booking(1703, paid_total=Decimal("2800")))
    assert fin == {
        "total_amount": Decimal("3500.00"),
        "deposit_due": Decimal("2800.00"),
        "paid_total": Decimal("2800.00"),
        "balance_due": Decimal("700.00"),
    }
    assert candidate_finance(booking(1, deposit_waived=1))["deposit_due"] == Decimal("0.00")


def test_strong_on_prefixed_reference():
    cands = [booking(1703), booking(1704)]
    r = match_transaction(credit("2800", "ABSA BANK FY1703"), cands, TODAY)
    assert r == MatchResult("strong", 1703, [], "reference")
    # In the endToEndId too, any case, odd amount still fine while under the total.
    r = match_transaction(credit("1234.56", "CAPITEC", "inv-1704"), cands, TODAY)
    assert r.kind == "strong" and r.booking_id == 1704 and r.method == "reference"


def test_prefixed_reference_prefers_prefixed_over_bare():
    cands = [booking(1703), booking(1704)]
    r = match_transaction(credit("2800", "FY1703 1704"), cands, TODAY)
    assert r.kind == "strong" and r.booking_id == 1703


def test_prefixed_reference_on_dead_booking_is_only_a_suggestion():
    cands = [booking(1703, status="cancelled")]
    r = match_transaction(credit("2800", "FY1703"), cands, TODAY)
    assert r.kind == "suggested" and r.booking_id is None
    assert r.suggestions[0]["booking_id"] == 1703
    assert "cancelled" in r.suggestions[0]["reasons"][0]


def test_prefixed_reference_over_total_is_a_suggestion():
    cands = [booking(1703)]  # total 3500
    r = match_transaction(credit("3600", "FY1703"), cands, TODAY)
    assert r.kind == "suggested"
    assert "exceeds the total" in r.suggestions[0]["reasons"][0]
    # R1 tolerance: 3501 is still strong
    assert match_transaction(credit("3501", "FY1703"), cands, TODAY).kind == "strong"


def test_two_live_references_in_one_payment_are_suggested_not_matched():
    cands = [booking(1703), booking(1704)]
    r = match_transaction(credit("5600", "FY1703 FY1704"), cands, TODAY)
    assert r.kind == "suggested"
    assert {s["booking_id"] for s in r.suggestions} == {1703, 1704}


def test_bare_number_with_matching_deposit_is_strong():
    cands = [booking(1703)]
    r = match_transaction(credit("2800", "CAPITEC 1703 N DLAMINI"), cands, TODAY)
    assert r == MatchResult("strong", 1703, [], "reference_amount")
    # within R1 either way
    assert match_transaction(credit("2799.50", "1703"), cands, TODAY).kind == "strong"
    assert match_transaction(credit("2801", "1703"), cands, TODAY).kind == "strong"


def test_bare_number_with_matching_balance_is_strong():
    cands = [booking(1703, status="confirmed", paid_total=Decimal("2800"))]  # balance 700
    r = match_transaction(credit("700", "ref 1703"), cands, TODAY)
    assert r.kind == "strong" and r.method == "reference_amount"


def test_bare_number_without_amount_agreement_is_suggested():
    cands = [booking(1703)]
    r = match_transaction(credit("1000", "ABSA 1703"), cands, TODAY)
    assert r.kind == "suggested"
    assert r.suggestions[0]["booking_id"] == 1703
    assert "Number 1703 matches FY1703" in r.suggestions[0]["reasons"]


def test_bare_number_over_total_is_not_suggested_by_number():
    cands = [booking(1703)]
    r = match_transaction(credit("9999", "ABSA 1703"), cands, TODAY)
    assert r.kind == "none"


def test_amount_only_suggests_recent_and_upcoming_bookings():
    recent = booking(1, visit_date=TODAY - timedelta(days=3))
    old = booking(2, visit_date=TODAY - timedelta(days=30))
    future = booking(3, visit_date=TODAY + timedelta(days=90), deposit_due=Decimal("1500"))
    r = match_transaction(credit("2800", "EFT PAYMENT"), [recent, old, future], TODAY)
    assert r.kind == "suggested"
    assert [s["booking_id"] for s in r.suggestions] == [1]
    assert r.suggestions[0]["reasons"] == ["Amount equals the deposit"]
    assert r.suggestions[0]["score"] == 40


def test_amount_equal_to_balance_suggests():
    cands = [booking(1, status="confirmed", paid_total=Decimal("2800"))]
    r = match_transaction(credit("700", "BALANCE"), cands, TODAY)
    assert r.kind == "suggested" and r.suggestions[0]["reasons"] == ["Amount equals the balance"]


def test_two_name_words_suggest_one_does_not():
    cands = [booking(1, group_name="Sunnyside Primary School", contact_name="Nomsa Dlamini")]
    r = match_transaction(credit("500", "ABSA BANK SUNNYSIDE DLAMINI"), cands, TODAY)
    assert r.kind == "suggested"
    assert r.suggestions[0]["reasons"][0].startswith("Name words: Dlamini, Sunnyside")
    assert match_transaction(credit("500", "PAYMENT SUNNYSIDE"), cands, TODAY).kind == "none"


def test_generic_name_words_alone_score_too_low():
    cands = [booking(1, group_name="St Peters Primary School")]
    r = match_transaction(credit("500", "PRIMARY SCHOOL FEES"), cands, TODAY)
    assert r.kind == "none"  # two generic words score 10, below the threshold


def test_amount_and_name_add_up_and_rank_first():
    a = booking(1, group_name="Sunnyside Primary", contact_name="Nomsa Dlamini")
    b = booking(2, group_name="Other Group")
    r = match_transaction(credit("2800", "SUNNYSIDE DLAMINI"), [a, b], TODAY)
    assert r.kind == "suggested"
    assert r.suggestions[0]["booking_id"] == 1 and r.suggestions[0]["score"] == 70
    assert r.suggestions[1]["booking_id"] == 2 and r.suggestions[1]["score"] == 40


def test_suggestions_capped_at_five():
    cands = [booking(i) for i in range(1, 9)]
    r = match_transaction(credit("2800", "DEPOSIT"), cands, TODAY)
    assert r.kind == "suggested" and len(r.suggestions) == 5


def test_waived_deposit_and_zero_balance_do_not_match_amounts():
    waived = booking(1, deposit_waived=1, paid_total=Decimal("3500"))  # deposit 0, balance 0
    r = match_transaction(credit("0.50", "X"), [waived], TODAY)
    assert r.kind == "none"


def test_debits_and_unknown_numbers_are_none():
    cands = [booking(1703)]
    debit = dict(credit("2800", "FY1703"), credit_debit="DEBIT")
    assert match_transaction(debit, cands, TODAY).kind == "none"
    assert match_transaction(credit("50", "FY9999 CARD SETTLEMENT"), cands, TODAY).kind == "none"


def test_suggestion_payload_shape():
    cands = [booking(1703)]
    r = match_transaction(credit("1000", "ABSA 1703"), cands, TODAY)
    s = r.suggestions[0]
    assert set(s) == {
        "booking_id", "reference", "group_name", "contact_name", "visit_date", "status",
        "total_amount", "deposit_due", "paid_total", "balance_due", "score", "reasons",
    }
    assert s["visit_date"] == (TODAY + timedelta(days=20)).isoformat()
    assert s["total_amount"] == 3500.0


def test_entry_to_row_normalises_debits_and_zero_balance(entries):
    rows = entries("200_history_after_approvals.json")
    debit = next(e for e in rows if e["creditDebitIndicator"] == "DEBIT")
    row = bank.entry_to_row("123", "fp", debit)
    assert row["credit_debit"] == "DEBIT" and row["amount"] == Decimal("2.01")
    assert row["booking_date"] == date.fromisoformat(debit["bookingDate"]["Date"])
    assert row["fingerprint"] == "fp" and row["account_number"] == "123"
    zero = dict(debit, availability={"amount": "0.00", "currency": "ZAR"})
    assert bank.entry_to_row("123", "fp", zero)["balance_after"] is None
