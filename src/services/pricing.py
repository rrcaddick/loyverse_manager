"""Day classification and price/deposit rules for group bookings.

Pure functions over a ``Settings`` object (docs/booking-system.md §5, §7).
The only outside data are the ``season_days`` and ``price_tiers`` tables;
both are reached through small lookup functions that callers can pre-load
(``load_season_days``) or tests can monkeypatch (``get_price_tier``).

    s = get_settings()
    day_type(date(2026, 12, 16), s)            # "weekend" (public holiday)
    default_price("school_weekday", d, s)      # Decimal("70.00")
    deposit_for(55, Decimal("70"), s)          # Decimal("2800.00")
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal, Mapping

from src.services import settings as settings_service
from src.services.settings import Settings
from src.utils.holidays import is_public_holiday

DayType = Literal["weekday", "weekend"]

SATURDAY = 5
SUNDAY = 6

# Tiers that are already the undiscounted rate and so survive the no-discount window.
PUBLIC_TIERS = ("public_weekend", "peak")
PEAK_TIER = "peak"
PUBLIC_TIER = "public_weekend"

TWO_PLACES = Decimal("0.01")


# ----------------------------------------------------------- lookups ------

def get_price_tier(code: str) -> dict | None:
    """Row from ``price_tiers`` (serialised) or None. Monkeypatch in tests."""
    return settings_service.get_price_tier(code)


def load_season_days(from_day: date, to_day: date) -> dict[date, dict]:
    """Pre-load ``season_days`` for a range so per-day checks need no queries."""
    out: dict[date, dict] = {}
    for row in settings_service.list_season_days(from_day, to_day):
        out[_as_date(row["day"])] = row
    return out


def season_day(d: date, season_days: Mapping[date, dict] | None = None) -> dict | None:
    """The ``season_days`` row for ``d`` (from the preloaded map when given)."""
    if season_days is not None:
        return season_days.get(d)
    return load_season_days(d, d).get(d)


# ----------------------------------------------------- day classification --

def _as_date(value) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _month_day(value: str) -> tuple[int, int]:
    month, day = str(value).split("-")
    return int(month), int(day)


def day_type(d: date, s: Settings) -> DayType:
    """``weekend`` on Saturday, Sunday or a public holiday; otherwise ``weekday``."""
    if d.weekday() in (SATURDAY, SUNDAY) or is_public_holiday(d):
        return "weekend"
    return "weekday"


def in_season(d: date, s: Settings) -> bool:
    start = _as_date(s.season.start)
    end = _as_date(s.season.end)
    return start <= d <= end


def is_closed(d: date, s: Settings, season_days: Mapping[date, dict] | None = None) -> bool:
    """Closed on configured weekdays, on explicit closures and outside the season.

    An explicit ``season_days`` row is authoritative: ``closed`` closes a day the
    rules would open, and ``open``/``peak`` opens a day the rules would close.
    """
    row = season_day(d, season_days)
    if row is not None:
        return row["kind"] == "closed"
    if not in_season(d, s):
        return True
    return d.weekday() in set(s.season.closed_weekdays)


def is_avoid(d: date, s: Settings) -> bool:
    """Open but discouraged (Wednesdays by default)."""
    return d.weekday() in set(s.season.avoid_weekdays)


def is_peak(d: date, s: Settings, season_days: Mapping[date, dict] | None = None) -> bool:
    row = season_day(d, season_days)
    return row is not None and row["kind"] == "peak"


def day_label(d: date, season_days: Mapping[date, dict] | None = None) -> str | None:
    row = season_day(d, season_days)
    return row.get("label") if row else None


def in_no_discount_window(d: date, s: Settings) -> bool:
    """Inclusive MM-DD window; wraps the year end when start > end (12-13 .. 01-11)."""
    start = _month_day(s.season.no_discount_start)
    end = _month_day(s.season.no_discount_end)
    md = (d.month, d.day)
    if start <= end:
        return start <= md <= end
    return md >= start or md <= end


# -------------------------------------------------------------- pricing ----

def group_type_config(group_type: str | None, s: Settings) -> dict | None:
    if not group_type:
        return None
    for entry in s.form.group_types:
        if entry.get("code") == group_type:
            return entry
    return None


def default_tier_for(group_type: str | None, d: date, s: Settings) -> str | None:
    """The tier code a group type defaults to on ``d`` (None for unknown types)."""
    entry = group_type_config(group_type, s)
    if entry is None:
        return None
    key = "weekend_tier" if day_type(d, s) == "weekend" else "weekday_tier"
    return entry.get(key)


def effective_tier(
    tier_code: str | None,
    d: date,
    s: Settings,
    season_days: Mapping[date, dict] | None = None,
) -> str | None:
    """The tier whose price actually applies on ``d``.

    Peak days always price at the peak tier. Inside the no-discount window
    group tiers are unavailable, so anything other than a public tier becomes
    ``public_weekend``. Otherwise the requested tier stands.
    """
    if is_peak(d, s, season_days):
        return PEAK_TIER
    if in_no_discount_window(d, s) and tier_code not in PUBLIC_TIERS:
        return PUBLIC_TIER
    return tier_code


def tier_price(tier_code: str | None) -> Decimal | None:
    if not tier_code:
        return None
    row = get_price_tier(tier_code)
    if row is None or row.get("price") is None:
        return None
    return Decimal(str(row["price"])).quantize(TWO_PLACES)


def default_price(
    tier_code: str | None,
    d: date,
    s: Settings,
    season_days: Mapping[date, dict] | None = None,
) -> Decimal:
    """Per-person price for ``tier_code`` on ``d``.

    Peak days use ``pricing.peak_price``; the no-discount window uses
    ``pricing.public_weekend_price`` unless the tier is already public/peak;
    otherwise the tier's table price. An unknown tier falls back to the
    public price.
    """
    if is_peak(d, s, season_days):
        return _money(s.pricing.peak_price)
    if in_no_discount_window(d, s) and tier_code not in PUBLIC_TIERS:
        return _money(s.pricing.public_weekend_price)
    price = tier_price(tier_code)
    if price is None:
        return _money(s.pricing.public_weekend_price)
    return price


def deposit_for(people: int, price: Decimal, s: Settings) -> Decimal:
    """``max(min_people × price, round(people × percent/100) × price)``, capped at the total."""
    people = max(int(people or 0), 0)
    price = _money(price)
    total = price * people
    min_people = Decimal(int(s.deposit.min_people))
    percent_people = (Decimal(people) * Decimal(str(s.deposit.percent)) / Decimal(100)).quantize(
        Decimal(1), rounding=ROUND_HALF_UP
    )
    deposit = max(min_people * price, percent_people * price)
    return min(deposit, total).quantize(TWO_PLACES)


def hold_expiry_for(visit_date: date, s: Settings) -> date:
    return visit_date - timedelta(days=int(s.reminders.lapse_days_before))


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(TWO_PLACES)
