"""South African public holiday computation."""

from datetime import date

from src.utils.holidays import (
    easter_sunday,
    holiday_name,
    is_public_holiday,
    public_holidays,
)


def test_easter_dates():
    assert easter_sunday(2026) == date(2026, 4, 5)
    assert easter_sunday(2027) == date(2027, 3, 28)
    assert easter_sunday(2024) == date(2024, 3, 31)


def test_good_friday_and_family_day():
    h = public_holidays(2026)
    assert h[date(2026, 4, 3)] == "Good Friday"
    assert h[date(2026, 4, 6)] == "Family Day"
    h27 = public_holidays(2027)
    assert h27[date(2027, 3, 26)] == "Good Friday"
    assert h27[date(2027, 3, 29)] == "Family Day"


def test_fixed_dates_present():
    h = public_holidays(2026)
    for d, name in (
        (date(2026, 1, 1), "New Year's Day"),
        (date(2026, 3, 21), "Human Rights Day"),
        (date(2026, 4, 27), "Freedom Day"),
        (date(2026, 5, 1), "Workers' Day"),
        (date(2026, 6, 16), "Youth Day"),
        (date(2026, 8, 9), "National Women's Day"),
        (date(2026, 9, 24), "Heritage Day"),
        (date(2026, 12, 16), "Day of Reconciliation"),
        (date(2026, 12, 25), "Christmas Day"),
        (date(2026, 12, 26), "Day of Goodwill"),
    ):
        assert h[d] == name


def test_sunday_holiday_is_observed_on_monday():
    # 9 August 2026 is a Sunday → Monday 10 August is a holiday too.
    assert date(2026, 8, 9).weekday() == 6
    assert is_public_holiday(date(2026, 8, 10))
    assert holiday_name(date(2026, 8, 10)) == "National Women's Day (observed)"
    # 21 March 2026 is a Saturday → no Monday observance.
    assert not is_public_holiday(date(2026, 3, 23))


def test_christmas_on_sunday_does_not_add_a_27th():
    # 2022: Christmas fell on a Sunday; Monday 26th is already Day of Goodwill.
    h = public_holidays(2022)
    assert date(2022, 12, 26) in h
    assert date(2022, 12, 27) not in h


def test_ordinary_days_are_not_holidays():
    assert not is_public_holiday(date(2026, 11, 12))
    assert holiday_name(date(2026, 11, 12)) is None
