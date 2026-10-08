"""Pricing rules against the default settings, with the DB lookups patched out."""

import copy
from datetime import date
from decimal import Decimal

import pytest

from src.services import pricing
from src.services.settings import DEFAULTS, Settings

TIERS = {
    "school_weekday": 70,
    "school_parents_weekday": 90,
    "adult_small_weekday": 95,
    "adult_large_weekday": 90,
    "pensioners_weekday": 90,
    "church_weekend": 95,
    "nonprofit_kids_weekend": 95,
    "nonprofit_adults_weekend": 100,
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


def test_no_discount_window_wraps_the_year(s):
    assert not pricing.in_no_discount_window(date(2026, 12, 12), s)
    assert pricing.in_no_discount_window(date(2026, 12, 13), s)
    assert pricing.in_no_discount_window(date(2026, 12, 31), s)
    assert pricing.in_no_discount_window(date(2027, 1, 1), s)
    assert pricing.in_no_discount_window(date(2027, 1, 11), s)
    assert not pricing.in_no_discount_window(date(2027, 1, 12), s)


def test_no_discount_window_without_wrap(s):
    s.season["no_discount_start"] = "03-01"
    s.season["no_discount_end"] = "03-10"
    assert pricing.in_no_discount_window(date(2027, 3, 5), s)
    assert not pricing.in_no_discount_window(date(2027, 2, 28), s)
    assert not pricing.in_no_discount_window(date(2027, 3, 11), s)


# ---------------------------------------------------------------- tiers ---

@pytest.mark.parametrize(
    "group_type, weekday_tier, weekend_tier",
    [
        ("school", "school_weekday", "nonprofit_kids_weekend"),
        ("creche", "school_weekday", "nonprofit_kids_weekend"),
        ("church", "adult_large_weekday", "church_weekend"),
        ("nonprofit", "adult_large_weekday", "nonprofit_adults_weekend"),
        ("family", "adult_small_weekday", "nonprofit_adults_weekend"),
        ("corporate", "adult_small_weekday", "public_weekend"),
        ("pensioners", "pensioners_weekday", "public_weekend"),
        ("other", "adult_small_weekday", "public_weekend"),
    ],
)
def test_default_tier_for(s, group_type, weekday_tier, weekend_tier):
    assert pricing.default_tier_for(group_type, THU, s) == weekday_tier
    assert pricing.default_tier_for(group_type, SAT, s) == weekend_tier
    # A public holiday counts as a weekend.
    assert pricing.default_tier_for(group_type, RECONCILIATION_DAY, s) == weekend_tier


def test_default_tier_for_unknown_type(s):
    assert pricing.default_tier_for("zoo", THU, s) is None
    assert pricing.default_tier_for(None, THU, s) is None


def test_effective_tier(s):
    assert pricing.effective_tier("school_weekday", THU, s) == "school_weekday"
    assert pricing.effective_tier("school_weekday", date(2026, 12, 17), s) == "public_weekend"
    assert pricing.effective_tier("public_weekend", date(2026, 12, 17), s) == "public_weekend"
    assert pricing.effective_tier("school_weekday", date(2026, 12, 25), s) == "peak"
    assert pricing.effective_tier(None, THU, s) is None


# ---------------------------------------------------------------- price ---

def test_default_price_uses_tier_table(s):
    assert pricing.default_price("school_weekday", THU, s) == Decimal("70.00")
    assert pricing.default_price("nonprofit_adults_weekend", SAT, s) == Decimal("100.00")


def test_default_price_peak_day(s):
    assert pricing.default_price("school_weekday", date(2026, 12, 25), s) == Decimal("130.00")
    assert pricing.default_price(None, date(2027, 1, 2), s) == Decimal("130.00")


def test_default_price_no_discount_window(s):
    in_window = date(2026, 12, 17)  # Thursday
    assert pricing.default_price("school_weekday", in_window, s) == Decimal("115.00")
    assert pricing.default_price("public_weekend", in_window, s) == Decimal("115.00")
    assert pricing.default_price("peak", in_window, s) == Decimal("130.00")


def test_default_price_unknown_tier_falls_back_to_public(s):
    assert pricing.default_price("no_such_tier", THU, s) == Decimal("115.00")
    assert pricing.default_price(None, THU, s) == Decimal("115.00")


def test_default_price_follows_settings_not_table(s):
    s.pricing["peak_price"] = 150
    s.pricing["public_weekend_price"] = 120
    assert pricing.default_price("school_weekday", date(2026, 12, 25), s) == Decimal("150.00")
    assert pricing.default_price("school_weekday", date(2026, 12, 17), s) == Decimal("120.00")


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
