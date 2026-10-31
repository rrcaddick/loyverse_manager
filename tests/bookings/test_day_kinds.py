"""Day kinds: the priority list, the Islamic dates and the overrides."""

import copy
from datetime import date

from src.services import day_kinds
from src.services.settings import DEFAULTS, Settings


def settings(**day_kind_overrides) -> Settings:
    data = copy.deepcopy(DEFAULTS)
    data["day_kinds"].update(day_kind_overrides)
    return Settings(data)


def test_tabular_islamic_calendar_is_within_a_day():
    # Ramadan 1448 begins about 8 Feb 2027; Eid al-Fitr about 10 Mar 2027.
    assert abs((day_kinds.hijri_to_date(1448, 9, 1) - date(2027, 2, 8)).days) <= 1
    assert abs((day_kinds.hijri_to_date(1448, 10, 1) - date(2027, 3, 10)).days) <= 1
    windows = day_kinds.ramadan_windows(2027)
    assert any(w["start"].year == 2027 and w["start"].month == 2 for w in windows)


def test_priority_order_picks_one_kind():
    s = settings()
    # 26 Dec 2026: a Saturday, Day of Goodwill, in the school holidays, and a peak day.
    assert day_kinds.primary_kind(date(2026, 12, 26), s)["code"] == "peak"
    assert [k["code"] for k in day_kinds.kinds_for(date(2026, 12, 26), s)] == ["peak", "public_holiday", "weekend", "school_holiday"]
    # 16 Dec 2026: Day of Reconciliation on a Wednesday in the holidays.
    assert day_kinds.primary_kind(date(2026, 12, 16), s)["code"] == "public_holiday"
    # A Saturday in the holidays is a weekend before it is a school holiday.
    assert day_kinds.primary_kind(date(2026, 12, 19), s)["code"] == "weekend"
    # A Monday in the holidays: school holiday beats closed; in term a Monday is closed.
    assert day_kinds.primary_kind(date(2026, 12, 14), s)["code"] == "school_holiday"
    assert day_kinds.primary_kind(date(2026, 11, 16), s)["code"] == "closed"
    # A term-time Thursday is nothing in particular.
    assert day_kinds.primary_kind(date(2026, 11, 19), s) is None


def test_ramadan_days_and_the_moon_sighting_override():
    s = settings()
    start = next(w["start"] for w in day_kinds.ramadan_windows(2027) if w["start"].year == 2027)
    eve = start.fromordinal(start.toordinal() - 1)
    assert "ramadan_eve" in [k["code"] for k in day_kinds.kinds_for(eve, s)]
    moved = settings(ramadan={"start": "2027-02-10", "end": None})
    assert "ramadan_eve" in [k["code"] for k in day_kinds.kinds_for(date(2027, 2, 9), moved)]
    assert "ramadan_eve" not in [k["code"] for k in day_kinds.kinds_for(eve, moved)] or eve == date(2027, 2, 9)
    ended = settings(ramadan={"start": None, "end": "2027-03-11"})
    assert "eid" in [k["code"] for k in day_kinds.kinds_for(date(2027, 3, 12), ended)]


def test_custom_kinds_disabled_kinds_and_the_legend():
    kinds = copy.deepcopy(DEFAULTS["day_kinds"]["kinds"])
    kinds.insert(0, {"code": "custom-1", "label": "Carols night", "colour": "#123456", "on": True, "dates": ["2026-12-19"]})
    for k in kinds:
        if k["code"] == "weekend":
            k["on"] = False
    s = settings(kinds=kinds)
    assert day_kinds.primary_kind(date(2026, 12, 19), s)["label"] == "Carols night"
    # Weekend is off: the Saturday falls through to the school holiday.
    assert day_kinds.primary_kind(date(2026, 12, 12), s)["code"] == "school_holiday"
    assert [k["code"] for k in day_kinds.legend(s)][:2] == ["custom-1", "peak"]
    assert "weekend" not in [k["code"] for k in day_kinds.legend(s)]


def test_yearly_peak_days_price_as_peak():
    from src.services import pricing

    s = settings()
    assert pricing.is_peak(date(2027, 1, 2), s) is True
    assert pricing.rate_day(date(2027, 1, 2), s) == "peak"
    assert pricing.is_peak(date(2027, 1, 5), s, {}) is False
