"""Matching rules and the poll window, with in-memory candidates (no database)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from src.services import bank
from src.services.bank import (
    HISTORY_FLOOR,
    MatchResult,
    arithmetic_line,
    candidate_finance,
    confidence_for,
    derive_rule_pattern,
    match_transaction,
    matching_rule,
    parse_reference_numbers,
    poll_window,
    rank_suggestions,
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
    assert r.suggestions[0]["confidence"] == "Equals the deposit"
    assert r.suggestions[0]["tone"] == "green" and r.suggestions[0]["preselected"] is True


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
    # Both equal the deposit; the name only adds a reason, never a rank. Same
    # sentence and the same visit date: a tie, so nothing is pre-selected.
    assert {s["booking_id"] for s in r.suggestions} == {1, 2}
    assert all(s["confidence"] == "Equals the deposit" for s in r.suggestions)
    assert not any(s["preselected"] for s in r.suggestions)
    assert r.suggestions[0]["reasons"] == ["Amount equals the deposit", "Name words: Dlamini, Sunnyside"]


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
        "total_amount", "deposit_due", "paid_total", "balance_due", "reasons",
        "confidence", "confidence_key", "tone", "rank", "arithmetic", "preselected",
    }
    assert "score" not in s
    assert s["visit_date"] == (TODAY + timedelta(days=20)).isoformat()
    assert s["total_amount"] == 3500.0
    assert s["confidence"] == "Part of the balance" and s["tone"] == "grey"
    assert s["arithmetic"] == "R1\u00a0000 of R3\u00a0500 balance · R0 paid · R3\u00a0500 total"


# --------------------------------------------------------- confidence ---

FIN = {"deposit_due": 2800.0, "balance_due": 3500.0, "paid_total": 0.0, "total_amount": 3500.0}


@pytest.mark.parametrize(
    "amount, name_only, sentence, tone, rank",
    [
        ("2800", False, "Equals the deposit", "green", 1),
        ("2800.60", False, "Equals the deposit", "green", 1),  # within R1
        ("3500", False, "Equals the balance", "green", 2),
        ("1000", False, "Part of the balance", "grey", 3),
        ("9000", False, "Exceeds the balance", "grey", 4),
        ("1000", True, "Name matches", "grey", 5),
        ("2800", True, "Equals the deposit", "green", 1),  # the amount wins over "name only"
    ],
)
def test_confidence_sentences(amount, name_only, sentence, tone, rank):
    c = confidence_for(Decimal(amount), FIN, name_only=name_only)
    assert (c["sentence"], c["tone"], c["rank"]) == (sentence, tone, rank)


def test_arithmetic_line_forms():
    assert arithmetic_line(Decimal("2800"), FIN) == "R2\u00a0800 = deposit · R0 paid · R3\u00a0500 total"
    assert arithmetic_line(Decimal("3500"), FIN) == "R3\u00a0500 = balance · R0 paid · R3\u00a0500 total"
    paid = {**FIN, "paid_total": 2800.0, "balance_due": 700.0}
    assert arithmetic_line(Decimal("700"), paid) == "R700 = balance · R2\u00a0800 paid · R3\u00a0500 total"
    assert arithmetic_line(Decimal("250.50"), paid) == "R250.50 of R700 balance · R2\u00a0800 paid · R3\u00a0500 total"


def test_candidates_order_by_sentence_then_nearest_visit_and_preselect_only_when_alone():
    # 1001 is named by number but the amount is only part of its balance;
    # 2 and 3 both equal the deposit, 3 visits sooner.
    near = booking(1001, visit_date=TODAY + timedelta(days=5), deposit_due=Decimal("1000"))
    equal_far = booking(2, visit_date=TODAY + timedelta(days=60))
    equal_near = booking(3, visit_date=TODAY + timedelta(days=10))
    r = match_transaction(credit("2800", "DEPOSIT 1001"), [near, equal_far, equal_near], TODAY)
    assert [s["booking_id"] for s in r.suggestions] == [3, 2, 1001]
    assert [s["confidence"] for s in r.suggestions] == [
        "Equals the deposit", "Equals the deposit", "Part of the balance",
    ]
    assert not any(s["preselected"] for s in r.suggestions)  # two tie at the top

    r = match_transaction(credit("2800", "DEPOSIT 1001"), [near, equal_far], TODAY)
    assert [s["booking_id"] for s in r.suggestions] == [2, 1001]
    assert r.suggestions[0]["preselected"] is True and r.suggestions[1]["preselected"] is False


def test_rank_suggestions_cuts_to_five_and_is_stable():
    entries = [
        {"booking_id": i, "rank": 3, "visit_date": (TODAY + timedelta(days=i)).isoformat()} for i in range(1, 9)
    ]
    ranked = rank_suggestions(entries, TODAY)
    assert [e["booking_id"] for e in ranked] == [1, 2, 3, 4, 5]
    assert ranked[0]["preselected"] is False  # five share the top sentence: a tie


def test_name_only_candidate_reads_name_matches():
    cands = [booking(1, group_name="Sunnyside Primary School", contact_name="Nomsa Dlamini")]
    r = match_transaction(credit("500", "ABSA BANK SUNNYSIDE DLAMINI"), cands, TODAY)
    assert r.suggestions[0]["confidence"] == "Name matches" and r.suggestions[0]["rank"] == 5
    assert r.suggestions[0]["preselected"] is True  # alone at the top, however weak


# -------------------------------------------------------- ignore rules ---

@pytest.mark.parametrize(
    "description, pattern",
    [
        ("FNB APP TRANSFER FROM RAY", "FNB APP TRANSFER FROM"),
        ("INTERNET TRF FROM CALL ACC", "INTERNET TRF FROM"),
        ("ADDPAY-PSP31240029671426092600", "ADDPAY-PSP"),
        ("NETCASH161CPP:THE FARMYARD PARK", "NETCASH"),
        ("BIS/INT 22,00000 2026-09-30", "BIS/INT"),
        ("Microsoft ISO", "Microsoft ISO"),
        ("ONE TWO THREE FOUR FIVE SIX SEVEN", "ONE TWO THREE FOUR FIVE"),
        ("1234 PAYMENT", "1234 PAYMENT"),  # nothing usable before the digits: the whole text
        ("", None),
        (None, None),
    ],
)
def test_derive_rule_pattern(description, pattern):
    assert derive_rule_pattern(description) == pattern


def test_matching_rule_is_a_case_insensitive_prefix():
    rules = [{"id": 1, "pattern": "FNB APP TRANSFER FROM", "reason": "own_transfer"}]
    assert matching_rule("fnb app transfer from ray", rules)["id"] == 1
    assert matching_rule("FNB APP PAYMENT FROM RAY", rules) is None
    assert matching_rule("", rules) is None and matching_rule(None, rules) is None
    assert matching_rule("X", [{"id": 2, "pattern": "", "reason": "other"}]) is None


def test_entry_to_row_normalises_debits_and_zero_balance(entries):
    rows = entries("200_history_after_approvals.json")
    debit = next(e for e in rows if e["creditDebitIndicator"] == "DEBIT")
    row = bank.entry_to_row("123", "fp", debit)
    assert row["credit_debit"] == "DEBIT" and row["amount"] == Decimal("2.01")
    assert row["booking_date"] == date.fromisoformat(debit["bookingDate"]["Date"])
    assert row["fingerprint"] == "fp" and row["account_number"] == "123"
    zero = dict(debit, availability={"amount": "0.00", "currency": "ZAR"})
    assert bank.entry_to_row("123", "fp", zero)["balance_after"] is None
