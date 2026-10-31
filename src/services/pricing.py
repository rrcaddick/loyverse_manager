"""Day classification and price/deposit rules for group bookings.

Three rates (owner, 30 Oct 2026). Children's groups pay R70 on a term-time
weekday. Every other group pays the group rate, R95, on weekdays, weekends
and school holidays alike. The public rate, R115, applies on public holidays
and to anything under the group minimum; peak days carry their own public
price. Group types are information: the one thing a type decides is whether
the children's rate can apply. Agreed prices below the rate are a discount
with a reason, never a different rate (``booking._derive_pricing``).

Pure functions over a ``Settings`` object. The only outside data are the
``season_days`` and ``price_tiers`` tables, reached through small lookups
that callers can pre-load (``load_season_days``) or tests can monkeypatch
(``get_price_tier``).

    s = get_settings()
    decide_tier("school", date(2026, 11, 12), 60, s).tier_code   # "children_weekday"
    decide_tier("church", date(2026, 11, 14), 30, s).tier_code   # "public_weekend" (under 40)
    deposit_for(55, Decimal("70"), s)                              # Decimal("2800.00")
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal, Mapping

from src.services import settings as settings_service
from src.services.settings import Settings
from src.utils.holidays import is_public_holiday

DayType = Literal["weekday", "weekend"]
RateDay = Literal["peak", "public_holiday", "weekend", "school_holiday", "weekday"]

SATURDAY = 5
SUNDAY = 6

CHILDREN_TIER = "children_weekday"
GROUP_WEEKDAY_TIER = "group_weekday"
GROUP_WEEKEND_TIER = "group_weekend"
PUBLIC_TIER = "public_weekend"  # the code predates the rename; it is the gate price
PEAK_TIER = "peak"
PUBLIC_TIERS = (PUBLIC_TIER, PEAK_TIER)
TIER_CODES = (CHILDREN_TIER, GROUP_WEEKDAY_TIER, GROUP_WEEKEND_TIER, PUBLIC_TIER, PEAK_TIER)
DEFAULT_GROUP_MINIMUM = 40

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
    """An explicit season_days row of kind peak, or one of the yearly peak
    days on ``settings.day_kinds.peak_days`` (MM-DD; 26 Dec, 1 and 2 Jan)."""
    row = season_day(d, season_days)
    if row is not None and row["kind"] == "peak":
        return True
    try:
        yearly = s.day_kinds.get("peak_days") or []
    except AttributeError:
        yearly = []
    return d.strftime("%m-%d") in {str(v) for v in yearly}


def day_label(d: date, season_days: Mapping[date, dict] | None = None) -> str | None:
    row = season_day(d, season_days)
    return row.get("label") if row else None


def is_school_holiday(d: date, s: Settings) -> bool:
    """Inside one of ``season.school_holidays`` (inclusive ISO ranges)."""
    for r in s.season.get("school_holidays") or []:
        try:
            if _as_date(r["from"]) <= d <= _as_date(r["to"]):
                return True
        except (KeyError, TypeError, ValueError):
            continue
    return False


def rate_day(d: date, s: Settings, season_days: Mapping[date, dict] | None = None) -> RateDay:
    """What kind of day ``d`` is for pricing, most specific first."""
    if is_peak(d, s, season_days):
        return "peak"
    if is_public_holiday(d):
        return "public_holiday"
    if d.weekday() in (SATURDAY, SUNDAY):
        return "weekend"
    if is_school_holiday(d, s):
        return "school_holiday"
    return "weekday"


# -------------------------------------------------------------- pricing ----

def group_type_config(group_type: str | None, s: Settings) -> dict | None:
    if not group_type:
        return None
    for entry in s.form.group_types:
        if entry.get("code") == group_type:
            return entry
    return None


def is_children_group(group_type: str | None, s: Settings) -> bool:
    entry = group_type_config(group_type, s)
    return bool(entry and entry.get("children"))


def group_minimum(s: Settings) -> int:
    try:
        return int(s.pricing.get("group_minimum") or DEFAULT_GROUP_MINIMUM)
    except (TypeError, ValueError):
        return DEFAULT_GROUP_MINIMUM


@dataclass(frozen=True)
class TierDecision:
    tier_code: str
    rate_day: RateDay
    under_minimum: bool  # fewer people than the group minimum
    minimum_waived: bool  # under the minimum, but another group opens the park that weekday

    def as_dict(self) -> dict:
        return asdict(self)


def decide_tier(
    group_type: str | None,
    d: date,
    people: int | None,
    s: Settings,
    *,
    season_days: Mapping[date, dict] | None = None,
    other_group_on_day: bool = False,
) -> TierDecision:
    """The rate a booking qualifies for on ``d``.

    Peak days and public holidays are public rate for everyone. Weekends and
    school holidays are the group rate, or public under the minimum (a hard
    rule, since the park is open anyway). A term-time weekday is the
    children's rate for a children's group and the group rate for the rest;
    under the minimum it is public unless another group is already booked
    that day, when the park opens for them regardless.
    """
    day = rate_day(d, s, season_days)
    under = int(people or 0) < group_minimum(s)
    if day == "peak":
        return TierDecision(PEAK_TIER, day, under, False)
    if day == "public_holiday":
        return TierDecision(PUBLIC_TIER, day, under, False)
    if day in ("weekend", "school_holiday"):
        return TierDecision(PUBLIC_TIER if under else GROUP_WEEKEND_TIER, day, under, False)
    if under and not other_group_on_day:
        return TierDecision(PUBLIC_TIER, day, True, False)
    tier = CHILDREN_TIER if is_children_group(group_type, s) else GROUP_WEEKDAY_TIER
    return TierDecision(tier, day, under, under)


def tier_price(tier_code: str | None) -> Decimal | None:
    if not tier_code:
        return None
    row = get_price_tier(tier_code)
    if row is None or row.get("price") is None:
        return None
    return Decimal(str(row["price"])).quantize(TWO_PLACES)


def price_for_tier(tier_code: str | None) -> Decimal:
    """The tier's table price; an unknown tier prices as public."""
    price = tier_price(tier_code)
    if price is None:
        price = tier_price(PUBLIC_TIER)
    return price if price is not None else Decimal("0.00")


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
