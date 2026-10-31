"""Pricing rules against the default settings, with the DB lookups patched out."""

import copy
from datetime import date
from decimal import Decimal

import pytest

from src.services import pricing
from src.services.settings import DEFAULTS, Settings

TIERS = {
    "children_weekday": 70,
    "group_weekday": 95,
    "group_weekend": 95,
    "public_weekend": 115,
    "peak": 130,
}

SEASON_DAYS = {
    date(2026, 12, 24): {"day": "2026-12-24", "kind": "closed", "label": "Christmas Eve"},
    date(2026, 12, 25): {"day": "2026-12-25", "kind": "peak", "label": "Christmas Day"},
    date(2026, 12, 26): {"day": "2026-12-26", "kind": "peak", "label": "Day of Goodwill"},
    date(2026, 12, 31): {"day": "2026-12-31", "kind": "closed", "label": "New Year's Eve"},
    date(2027, 1, 1): {"day": "2027-01-01", "kind": "peak", "label": "New Year's Day"},
    date(2027, 1, 2): {"day": "2027-01-02", "kind": "peak", "label": "Peak day"},
    date(2027, 1, 3): {"day": "2027-01-03", "kind": "peak", "label": "Peak day"},
    date(2027, 3, 26): {"day": "2027-03-26", "kind": "closed", "label": "Closed"},
    # A Monday the park opens specially.
    date(2026, 12, 28): {"day": "2026-12-28", "kind": "open", "label": "Open Monday"},
}

THU = date(2026, 11, 12)
SAT = date(2026, 11, 14)
SUN = date(2026, 11, 15)
MON = date(2026, 11, 16)
TUE = date(2026, 11, 17)
WED = date(2026, 11, 18)
RECONCILIATION_DAY = date(2026, 12, 16)  # a Wednesday


@pytest.fixture
def s() -> Settings:
    return Settings(copy.deepcopy(DEFAULTS))


@pytest.fixture(autouse=True)
def patched_lookups(monkeypatch):
    monkeypatch.setattr(
        pricing,
        "get_price_tier",
        lambda code: {"code": code, "price": TIERS[code]} if code in TIERS else None,
    )
    monkeypatch.setattr(
        pricing,
        "load_season_days",
        lambda a, b: {d: r for d, r in SEASON_DAYS.items() if a <= d <= b},
    )


# ------------------------------------------------------------ day types ---

def test_day_type(s):
    assert pricing.day_type(THU, s) == "weekday"
    assert pricing.day_type(SAT, s) == "weekend"
    assert pricing.day_type(SUN, s) == "weekend"
    assert pricing.day_type(RECONCILIATION_DAY, s) == "weekend"


def test_closed_weekdays_and_season(s):
    assert pricing.is_closed(MON, s)
    assert pricing.is_closed(TUE, s)
    assert not pricing.is_closed(WED, s)
    assert not pricing.is_closed(THU, s)
    assert pricing.is_closed(date(2026, 10, 30), s)  # day before season start
    assert not pricing.is_closed(date(2026, 10, 31), s)  # season start (Saturday)
    assert pricing.is_closed(date(2027, 5, 1), s)  # after season end


def test_explicit_season_days_win(s):
    assert pricing.is_closed(date(2026, 12, 24), s)  # Thursday, closed
    assert not pricing.is_closed(date(2026, 12, 28), s)  # Monday, explicitly open
    assert not pricing.is_closed(date(2026, 12, 25), s)  # peak day is open


def test_avoid_and_peak(s):
    assert pricing.is_avoid(WED, s)
    assert not pricing.is_avoid(THU, s)
    assert pricing.is_peak(date(2026, 12, 25), s)
    assert pricing.is_peak(date(2027, 1, 3), s)
    assert not pricing.is_peak(THU, s)


def test_school_holidays_from_settings(s):
    assert pricing.is_school_holiday(date(2026, 12, 10), s)
    assert pricing.is_school_holiday(date(2027, 1, 12), s)
    assert not pricing.is_school_holiday(date(2026, 12, 9), s)
    assert not pricing.is_school_holiday(date(2027, 1, 13), s)
    s.season["school_holidays"] = [{"from": "2027-03-01", "to": "2027-03-10", "label": "Test"}]
    assert pricing.is_school_holiday(date(2027, 3, 5), s)
    assert not pricing.is_school_holiday(date(2026, 12, 15), s)


def test_rate_day_most_specific_first(s):
    assert pricing.rate_day(THU, s) == "weekday"
    assert pricing.rate_day(SAT, s) == "weekend"
    assert pricing.rate_day(SUN, s) == "weekend"
    assert pricing.rate_day(RECONCILIATION_DAY, s) == "public_holiday"
    assert pricing.rate_day(date(2026, 12, 17), s) == "school_holiday"  # a Thursday in the holidays
    assert pricing.rate_day(date(2026, 12, 25), s) == "peak"  # peak beats the public holiday
    assert pricing.rate_day(date(2026, 12, 19), s) == "weekend"  # Saturday in the holidays


# ---------------------------------------------------------------- tiers ---

@pytest.mark.parametrize("group_type, children", [("school", True), ("creche", True), ("aftercare", True), ("youth_club", True), ("church", False), ("nonprofit", False), ("family", False), ("corporate", False), ("pensioners", False), ("other", False)])
def test_children_groups_are_a_flag_on_the_type(s, group_type, children):
    assert pricing.is_children_group(group_type, s) is children


def test_unknown_type_is_not_a_children_group(s):
    assert pricing.is_children_group("zoo", s) is False
    assert pricing.is_children_group(None, s) is False


def test_decide_tier_term_time_weekday(s):
    assert pricing.decide_tier("school", THU, 60, s).tier_code == "children_weekday"
    assert pricing.decide_tier("church", THU, 60, s).tier_code == "group_weekday"
    assert pricing.decide_tier("zoo", THU, 60, s).tier_code == "group_weekday"


def test_decide_tier_weekend_and_school_holiday_are_the_group_rate(s):
    assert pricing.decide_tier("church", SAT, 60, s).tier_code == "group_weekend"
    assert pricing.decide_tier("school", SAT, 60, s).tier_code == "group_weekend"  # no children's rate at the weekend
    assert pricing.decide_tier("school", date(2026, 12, 17), 60, s).tier_code == "group_weekend"  # nor in the holidays


def test_decide_tier_public_holiday_and_peak_are_public_for_everyone(s):
    assert pricing.decide_tier("church", RECONCILIATION_DAY, 200, s).tier_code == "public_weekend"
    assert pricing.decide_tier("school", date(2026, 12, 25), 200, s).tier_code == "peak"


def test_decide_tier_minimum_is_hard_on_weekends_and_waivable_on_weekdays(s):
    weekend = pricing.decide_tier("church", SAT, 30, s)
    assert weekend.tier_code == "public_weekend" and weekend.under_minimum and not weekend.minimum_waived
    alone = pricing.decide_tier("church", THU, 30, s)
    assert alone.tier_code == "public_weekend" and alone.under_minimum and not alone.minimum_waived
    joined = pricing.decide_tier("church", THU, 30, s, other_group_on_day=True)
    assert joined.tier_code == "group_weekday" and joined.minimum_waived
    kids = pricing.decide_tier("school", THU, 24, s, other_group_on_day=True)
    assert kids.tier_code == "children_weekday" and kids.minimum_waived
    assert pricing.decide_tier("church", THU, 40, s).under_minimum is False


def test_group_minimum_follows_settings(s):
    s.pricing["group_minimum"] = 20
    assert pricing.decide_tier("church", SAT, 25, s).tier_code == "group_weekend"


# ---------------------------------------------------------------- price ---

def test_price_for_tier_uses_the_table(s):
    assert pricing.price_for_tier("children_weekday") == Decimal("70.00")
    assert pricing.price_for_tier("group_weekend") == Decimal("95.00")
    assert pricing.price_for_tier("peak") == Decimal("130.00")


def test_price_for_unknown_tier_falls_back_to_public(s):
    assert pricing.price_for_tier("no_such_tier") == Decimal("115.00")
    assert pricing.price_for_tier(None) == Decimal("115.00")


# -------------------------------------------------------------- deposit ---

@pytest.mark.parametrize(
    "people, price, expected",
    [
        (55, "70", "2800.00"),  # 40 × 70 beats round(16.5)=17 × 70
        (100, "70", "2800.00"),  # 30 × 70 = 2100 < 40 × 70
        (200, "70", "4200.00"),  # 60 × 70
        (20, "70", "1400.00"),  # capped at the total (20 × 70)
        (40, "95", "3800.00"),  # exactly the minimum
        (135, "95", "3800.00"),  # round(40.5) → 41 × 95 = 3895? No: ROUND_HALF_UP gives 41
        (0, "70", "0.00"),
    ],
)
def test_deposit_for(s, people, price, expected):
    result = pricing.deposit_for(people, Decimal(price), s)
    if people == 135:
        # 135 × 30% = 40.5 → 41 people × 95 = 3895 (half-up, not banker's rounding)
        assert result == Decimal("3895.00")
    else:
        assert result == Decimal(expected)


def test_deposit_for_follows_settings(s):
    s.deposit["min_people"] = 10
    s.deposit["percent"] = 50
    assert pricing.deposit_for(30, Decimal("100"), s) == Decimal("1500.00")
    assert pricing.deposit_for(10, Decimal("100"), s) == Decimal("1000.00")


def test_hold_expiry(s):
    assert pricing.hold_expiry_for(date(2026, 11, 20), s) == date(2026, 11, 13)
    s.reminders["lapse_days_before"] = 10
    assert pricing.hold_expiry_for(date(2026, 11, 20), s) == date(2026, 11, 10)
