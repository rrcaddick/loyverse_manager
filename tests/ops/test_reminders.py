from datetime import date, datetime
from decimal import Decimal

from src.services.reminders import compute_due_dates
from src.services.settings import DEFAULTS

CFG = DEFAULTS["reminders"]  # 7 / 14 / 3 / 7


def booking(**overrides):
    base = {
        "status": "proforma_sent",
        "visit_date": date(2026, 11, 21),
        "proforma_sent_at": datetime(2026, 10, 1, 14, 30),
        "hold_expires_on": None,
        "deposit_due": Decimal("3800.00"),
        "deposit_waived": 0,
    }
    base.update(overrides)
    return base


def test_unpaid_proforma_gets_all_three_unpaid_reminders():
    due = compute_due_dates(booking(), Decimal("0"), CFG)
    assert due == {
        "still_interested": date(2026, 10, 8),  # sent + 7
        "deposit_reminder": date(2026, 11, 7),  # visit - 14
        "lapse": date(2026, 11, 14),  # visit - 7 (no explicit hold)
    }


def test_explicit_hold_date_wins_for_lapse():
    due = compute_due_dates(booking(hold_expires_on=date(2026, 11, 10)), 0, CFG)
    assert due["lapse"] == date(2026, 11, 10)


def test_partial_payment_keeps_deposit_reminder_only():
    due = compute_due_dates(booking(), Decimal("500"), CFG)
    assert due == {"deposit_reminder": date(2026, 11, 7)}


def test_deposit_covered_but_not_yet_confirmed_has_nothing_unpaid():
    due = compute_due_dates(booking(), Decimal("3800"), CFG)
    assert due == {}


def test_enquiry_without_proforma_has_no_still_interested():
    due = compute_due_dates(booking(status="enquiry", proforma_sent_at=None), 0, CFG)
    assert set(due) == {"deposit_reminder", "lapse"}


def test_confirmed_gets_final_details_only():
    due = compute_due_dates(booking(status="confirmed"), Decimal("3800"), CFG)
    assert due == {"final_details": date(2026, 11, 18)}


def test_waived_deposit_skips_deposit_reminder():
    due = compute_due_dates(booking(status="enquiry", proforma_sent_at=None, deposit_waived=1), 0, CFG)
    assert "deposit_reminder" not in due and "lapse" in due


def test_inactive_statuses_have_no_reminders():
    for status in ("cancelled", "lapsed", "completed", "no_show"):
        assert compute_due_dates(booking(status=status), 0, CFG) == {}


def test_string_dates_are_accepted():
    due = compute_due_dates(
        booking(visit_date="2026-11-21", proforma_sent_at="2026-10-01 14:30:00"), "0.00", CFG
    )
    assert due["still_interested"] == date(2026, 10, 8)
