"""Calendar roll-up (pure aggregation, no DB)."""

import copy
from datetime import date

import pytest

from src.services.booking import aggregate_calendar
from src.services.settings import DEFAULTS, Settings

THU = date(2026, 11, 12)
FRI = date(2026, 11, 13)
SAT = date(2026, 11, 14)
SUN = date(2026, 11, 15)
MON = date(2026, 11, 16)


def booking(id, visit_date, status, people, **extra):
    row = {
        "id": id,
        "reference": f"FY{1700 + id}",
        "group_name": f"Group {id}",
        "status": status,
        "people_booked": people,
        "group_type": "school",
        "contact_name": "Someone",
        "visit_date": visit_date,
        "arrival_time": None,
        "vehicles": 1,
    }
    row.update(extra)
    return row


@pytest.fixture
def s():
    return Settings(copy.deepcopy(DEFAULTS))


def test_every_day_in_range_appears(s):
    days = aggregate_calendar(THU, MON, [], s, {})
    assert [d["date"] for d in days] == [
        "2026-11-12",
        "2026-11-13",
        "2026-11-14",
        "2026-11-15",
        "2026-11-16",
    ]
    assert all(d["total_people"] == 0 and d["bookings"] == [] for d in days)


def test_people_are_split_by_status(s):
    rows = [
        booking(1, FRI, "confirmed", 100),
        booking(2, FRI, "completed", 50),
        booking(3, FRI, "enquiry", 30),
        booking(4, FRI, "proforma_sent", 20),
        booking(5, FRI, "cancelled", 999),
        booking(6, FRI, "lapsed", 999),
        booking(7, FRI, "no_show", 999),
    ]
    (day,) = aggregate_calendar(FRI, FRI, rows, s, {})
    assert day["total_people"] == 200
    assert day["confirmed_people"] == 150
    assert day["tentative_people"] == 50
    assert day["booking_count"] == 4
    assert [b["id"] for b in day["bookings"]] == [1, 2, 3, 4]
    assert set(day["bookings"][0]) == {
        "id",
        "reference",
        "group_name",
        "status",
        "people_booked",
        "group_type",
        "contact_name",
        "arrival_time",
        "vehicles",
    }


def test_capacity_warning(s):
    s.capacity["daily_warning_people"] = 500
    rows = [booking(1, SAT, "confirmed", 300), booking(2, SAT, "enquiry", 200)]
    (day,) = aggregate_calendar(SAT, SAT, rows, s, {})
    assert day["capacity_warning"] is True
    rows[1]["people_booked"] = 199
    (day,) = aggregate_calendar(SAT, SAT, rows, s, {})
    assert day["capacity_warning"] is False


def test_day_flags_and_labels(s):
    season = {
        date(2026, 12, 24): {"kind": "closed", "label": "Christmas Eve"},
        date(2026, 12, 25): {"kind": "peak", "label": "Christmas Day"},
    }
    days = {d["date"]: d for d in aggregate_calendar(date(2026, 12, 23), date(2026, 12, 26), [], s, season)}
    assert days["2026-12-23"]["is_avoid"] is True  # Wednesday
    assert days["2026-12-23"]["in_no_discount_window"] is True
    assert days["2026-12-24"]["is_closed"] is True
    assert days["2026-12-24"]["label"] == "Christmas Eve"
    assert days["2026-12-25"]["is_peak"] is True
    assert days["2026-12-25"]["day_type"] == "weekend"  # public holiday
    assert days["2026-12-26"]["label"] == "Day of Goodwill"  # from the holiday table


def test_weekend_and_closed_days(s):
    days = {d["date"]: d for d in aggregate_calendar(THU, MON, [], s, {})}
    assert days["2026-11-12"]["day_type"] == "weekday"
    assert days["2026-11-14"]["day_type"] == "weekend"
    assert days["2026-11-15"]["day_type"] == "weekend"
    assert days["2026-11-16"]["is_closed"] is True  # Monday


def test_bookings_outside_range_are_ignored(s):
    rows = [booking(1, MON, "confirmed", 100)]
    days = aggregate_calendar(THU, SUN, rows, s, {})
    assert all(d["total_people"] == 0 for d in days)
