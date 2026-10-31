"""Day kinds: what sort of day a calendar day is (UI round two, 26 and 29 Oct 2026).

``settings.day_kinds.kinds`` is an ordered list, highest priority first; the
first kind a day matches is its primary kind, which gives the calendar cell its
border colour and tag. Built-in codes carry a rule; a kind the operator adds
matches the dates listed on it.

    peak            ``peak_days`` (MM-DD, every year) and season_days rows of kind peak
    public_holiday  src.utils.holidays
    ramadan_eve     the day before 1 Ramadan (tabular Islamic calendar, or the override)
    eid             the day after the last day of Ramadan (1 Shawwal, or the override)
    weekend         Saturday and Sunday
    school_holiday  season.school_holidays ranges
    closed          season.closed_weekdays and explicit closures; never blocks a group

The Islamic dates are the tabular (Kuwaiti) calendar, right to a day; the moon
sighting decides the real date, so ``ramadan.start`` and ``ramadan.end`` on
the settings override the computed first and last day of Ramadan.
"""

from __future__ import annotations

from datetime import date, timedelta
from math import ceil, floor
from typing import Any, Mapping

from src.services import pricing
from src.utils.holidays import is_public_holiday

BUILT_IN = ("peak", "public_holiday", "ramadan_eve", "eid", "weekend", "school_holiday", "closed")

DEFAULT_KINDS: list[dict[str, Any]] = [
    {"code": "peak", "label": "Peak day", "colour": "#E53935", "on": True},
    {"code": "public_holiday", "label": "Public holiday", "colour": "#8E24AA", "on": True},
    {"code": "ramadan_eve", "label": "Day before Ramadan", "colour": "#3949AB", "on": True},
    {"code": "eid", "label": "Day after Ramadan", "colour": "#5E35B1", "on": True},
    {"code": "weekend", "label": "Weekend", "colour": "#FB8C00", "on": True},
    {"code": "school_holiday", "label": "School holiday", "colour": "#FFB300", "on": True},
    {"code": "closed", "label": "Closed to the public", "colour": "#9E9E9E", "on": True},
]
DEFAULT_PEAK_DAYS = ["12-26", "01-01", "01-02"]

ISLAMIC_EPOCH_JD = 1948439.5
GREGORIAN_EPOCH_JD = 1721425.5  # 1 January 1 (proleptic Gregorian), ordinal 1


def _as_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            return None
    return None


# ------------------------------------------------------ islamic calendar ---

def hijri_to_date(year: int, month: int, day: int) -> date:
    """Tabular Islamic calendar (Kuwaiti algorithm) to a Gregorian date."""
    jd = day + ceil(29.5 * (month - 1)) + (year - 1) * 354 + floor((3 + 11 * year) / 30) + ISLAMIC_EPOCH_JD - 1
    return date.fromordinal(int(floor(jd - GREGORIAN_EPOCH_JD)) + 1)


def _hijri_years_touching(year: int) -> range:
    approx = int((year - 622) * 365.2425 / 354.367) + 1
    return range(approx - 1, approx + 3)


def ramadan_windows(year: int, overrides: Mapping[str, Any] | None = None) -> list[dict[str, date]]:
    """Every Ramadan that touches the Gregorian ``year``: ``start`` (1 Ramadan),
    ``end`` (the last day) and ``eid`` (the day after). An override whose date
    falls in the same Gregorian year as a computed Ramadan replaces that one's
    start or end."""
    o_start = _as_date((overrides or {}).get("start"))
    o_end = _as_date((overrides or {}).get("end"))
    out: list[dict[str, date]] = []
    for hy in _hijri_years_touching(year):
        start = hijri_to_date(hy, 9, 1)
        eid = hijri_to_date(hy, 10, 1)
        if start.year not in (year - 1, year, year + 1):
            continue
        if o_start and abs((o_start - start).days) <= 20:
            start = o_start
        if o_end and abs((o_end - (eid - timedelta(days=1))).days) <= 20:
            eid = o_end + timedelta(days=1)
        out.append({"start": start, "end": eid - timedelta(days=1), "eid": eid})
    return out


# ------------------------------------------------------------- matching ---

def _kinds_cfg(s) -> Mapping[str, Any]:
    try:
        return s.day_kinds
    except AttributeError:
        return {}


def peak_month_days(s) -> set[str]:
    cfg = _kinds_cfg(s)
    return {str(v) for v in (cfg.get("peak_days") if cfg else None) or []}


def _matches(kind: Mapping[str, Any], d: date, s, season_days, cfg: Mapping[str, Any]) -> bool:
    code = kind.get("code")
    if code == "peak":
        return pricing.is_peak(d, s, season_days)
    if code == "public_holiday":
        return is_public_holiday(d)
    if code == "ramadan_eve":
        return any(d == w["start"] - timedelta(days=1) for w in ramadan_windows(d.year, cfg.get("ramadan")))
    if code == "eid":
        return any(d == w["eid"] for w in ramadan_windows(d.year, cfg.get("ramadan")))
    if code == "weekend":
        return d.weekday() >= 5
    if code == "school_holiday":
        return pricing.is_school_holiday(d, s)
    if code == "closed":
        return pricing.is_closed(d, s, season_days)
    return d.isoformat() in {str(v)[:10] for v in kind.get("dates") or []}


def _public(kind: Mapping[str, Any]) -> dict[str, Any]:
    return {"code": kind.get("code"), "label": kind.get("label") or kind.get("code"), "colour": kind.get("colour") or "#9E9E9E"}


def kinds_for(d: date, s, season_days: Mapping[date, dict] | None = None) -> list[dict[str, Any]]:
    """Every enabled kind the day matches, highest priority first."""
    cfg = _kinds_cfg(s)
    out: list[dict[str, Any]] = []
    for kind in (cfg.get("kinds") if cfg else None) or []:
        if not isinstance(kind, Mapping) or not kind.get("code") or kind.get("on", True) is False:
            continue
        if _matches(kind, d, s, season_days, cfg):
            out.append(_public(kind))
    return out


def primary_kind(d: date, s, season_days: Mapping[date, dict] | None = None) -> dict[str, Any] | None:
    kinds = kinds_for(d, s, season_days)
    return kinds[0] if kinds else None


def legend(s) -> list[dict[str, Any]]:
    """The enabled kinds in priority order, for the calendar's legend."""
    cfg = _kinds_cfg(s)
    return [_public(k) for k in (cfg.get("kinds") if cfg else None) or [] if isinstance(k, Mapping) and k.get("code") and k.get("on", True) is not False]
