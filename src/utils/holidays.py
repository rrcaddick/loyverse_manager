"""South African public holidays, computed for any year.

The Public Holidays Act (1994) lists ten fixed-date holidays plus Good Friday
and Family Day (the Monday after Easter). Whenever a public holiday falls on a
Sunday the following Monday is also a public holiday. One-off holidays
(election days and the like) are not known in advance; record those as
``season_days`` rows instead.

    is_public_holiday(date(2026, 12, 16))   # True, Day of Reconciliation
    public_holidays(2027)                   # {date: name, ...}
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

FIXED_HOLIDAYS: tuple[tuple[int, int, str], ...] = (
    (1, 1, "New Year's Day"),
    (3, 21, "Human Rights Day"),
    (4, 27, "Freedom Day"),
    (5, 1, "Workers' Day"),
    (6, 16, "Youth Day"),
    (8, 9, "National Women's Day"),
    (9, 24, "Heritage Day"),
    (12, 16, "Day of Reconciliation"),
    (12, 25, "Christmas Day"),
    (12, 26, "Day of Goodwill"),
)

SUNDAY = 6


def easter_sunday(year: int) -> date:
    """Gregorian Easter Sunday (anonymous / Meeus-Jones-Butcher algorithm)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741 - the algorithm's own name
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(year, month, day)


@lru_cache(maxsize=32)
def public_holidays(year: int) -> dict[date, str]:
    """All public holidays in ``year``, including Sunday-to-Monday observances."""
    holidays: dict[date, str] = {}
    for month, day, name in FIXED_HOLIDAYS:
        holidays[date(year, month, day)] = name

    easter = easter_sunday(year)
    holidays[easter - timedelta(days=2)] = "Good Friday"
    holidays[easter + timedelta(days=1)] = "Family Day"

    # A holiday on a Sunday is observed on the Monday, unless that Monday is
    # already a holiday (25 Dec on a Sunday simply runs into Day of Goodwill).
    for d, name in list(holidays.items()):
        if d.weekday() == SUNDAY:
            observed = d + timedelta(days=1)
            holidays.setdefault(observed, f"{name} (observed)")

    return dict(sorted(holidays.items()))


def is_public_holiday(d: date) -> bool:
    return d in public_holidays(d.year)


def holiday_name(d: date) -> str | None:
    return public_holidays(d.year).get(d)
