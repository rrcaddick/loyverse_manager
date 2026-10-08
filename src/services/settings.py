"""Typed application settings stored as JSON sections in ``app_settings``.

Stored values are merged over the defaults below, so a section can be partly
configured and new keys gain defaults without a migration. Price tiers and
season days are small tables with their own helpers at the bottom.

    s = get_settings()
    s.deposit.min_people          # 40
    s.documents.next_number       # 1703
    update_settings("reminders", {"still_interested_days": 10}, user_id)
"""

from __future__ import annotations

import copy
from datetime import date
from decimal import Decimal
from typing import Any

from config.settings import GMAIL_ADDRESS
from src.models.base import dumps, execute, loads, query, query_one, serialize_row, transaction

DEFAULTS: dict[str, dict[str, Any]] = {
    "season": {
        "start": "2026-10-31",
        "end": "2027-04-30",
        "closed_weekdays": [0, 1],  # Monday, Tuesday (Python weekday numbers)
        "avoid_weekdays": [2],  # Wednesday: open but discouraged
        "no_discount_start": "12-13",  # MM-DD, inclusive
        "no_discount_end": "01-11",
    },
    "pricing": {
        "public_weekend_price": 115.00,
        "peak_price": 130.00,
        "vat_rate": 15,
    },
    "deposit": {
        "min_people": 40,
        "percent": 30,
    },
    "documents": {
        "next_number": 1703,
        "proforma_prefix": "FY",
        "invoice_prefix": "INV",
        "company_name": "The Farmyard Park (Pty) Ltd",
        "trading_name": "The Farmyard Park",
        "address_line1": "Protea Road",
        "address_line2": "Klapmuts, 7625",
        "company_reg": "2020/752714/07",
        "vat_no": "4780 308 575",
        "bank_name": "FNB",
        "bank_account_name": "The Farmyard Park",
        "bank_account_type": "Current Account",
        "bank_account_number": "62871182764",
        "bank_branch_code": "250655",
        "pop_email": GMAIL_ADDRESS or "thefarmyardpark@gmail.com",
        "payment_terms": "The deposit secures your date. The balance is payable on the day of your visit.",
    },
    "reminders": {
        "still_interested_days": 7,
        "deposit_reminder_days_before": 14,
        "final_details_days_before": 3,
        "lapse_days_before": 7,
    },
    "capacity": {
        "daily_warning_people": 1000,
    },
    "email": {
        "sender_name": "The Farmyard Park",
        "signature_name": "Linda Caddick",
        "signature_title": "Director",
        "signature_company": "The Farmyard Park (Pty) Ltd",
        "phone": "081 461 4246",
        "website": "www.farmyardpark.co.za",
        "bounce_back_enabled": True,
        "review_window_days": 14,
    },
    "form": {
        "group_types": [
            {"code": "school", "label": "School", "weekday_tier": "school_weekday", "weekend_tier": "nonprofit_kids_weekend"},
            {"code": "creche", "label": "Crèche or children's group", "weekday_tier": "school_weekday", "weekend_tier": "nonprofit_kids_weekend"},
            {"code": "church", "label": "Church group", "weekday_tier": "adult_large_weekday", "weekend_tier": "church_weekend"},
            {"code": "nonprofit", "label": "Non-profit or club", "weekday_tier": "adult_large_weekday", "weekend_tier": "nonprofit_adults_weekend"},
            {"code": "family", "label": "Family or friends", "weekday_tier": "adult_small_weekday", "weekend_tier": "nonprofit_adults_weekend"},
            {"code": "corporate", "label": "Corporate or team building", "weekday_tier": "adult_small_weekday", "weekend_tier": "public_weekend"},
            {"code": "pensioners", "label": "Pensioners", "weekday_tier": "pensioners_weekday", "weekend_tier": "public_weekend"},
            {"code": "other", "label": "Other", "weekday_tier": "adult_small_weekday", "weekend_tier": "public_weekend"},
        ],
        "max_questions": 5,
        "min_group_size": 10,
        "intro": "Tell us about your group and we will come back to you with a proforma and your booking reference.",
    },
}

SECTIONS = tuple(DEFAULTS.keys())


class Section(dict):
    """dict with attribute access: s.deposit.min_people == s.deposit['min_people']."""

    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


class Settings:
    def __init__(self, data: dict[str, dict]):
        self._data = data
        for key, value in data.items():
            setattr(self, key, Section(value))

    def to_dict(self) -> dict:
        return copy.deepcopy(self._data)

    def __getitem__(self, key: str) -> Section:
        return getattr(self, key)


def _merge(defaults: dict, stored: dict | None) -> dict:
    out = copy.deepcopy(defaults)
    for k, v in (stored or {}).items():
        out[k] = v
    return out


def get_settings() -> Settings:
    rows = query("SELECT setting_key, value FROM app_settings")
    stored = {r["setting_key"]: loads(r["value"]) or {} for r in rows}
    return Settings({k: _merge(v, stored.get(k)) for k, v in DEFAULTS.items()})


def update_settings(section: str, data: dict, user_id: int | None) -> Settings:
    if section not in DEFAULTS:
        raise ValueError(f"Unknown settings section: {section}")
    unknown = set(data) - set(DEFAULTS[section])
    if unknown:
        raise ValueError(f"Unknown keys for {section}: {', '.join(sorted(unknown))}")
    current = get_settings()[section]
    merged = {**current, **data}
    execute(
        """
        INSERT INTO app_settings (setting_key, value, updated_by) VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)
        """,
        (section, dumps(merged), user_id),
    )
    return get_settings()


def next_document_number() -> int:
    """Atomically take the next proforma/invoice number."""
    with transaction() as conn:
        row = query_one(
            "SELECT value FROM app_settings WHERE setting_key = 'documents' FOR UPDATE", conn=conn
        )
        current = _merge(DEFAULTS["documents"], loads(row["value"]) if row else None)
        number = int(current["next_number"])
        current["next_number"] = number + 1
        execute(
            """
            INSERT INTO app_settings (setting_key, value) VALUES ('documents', %s)
            ON DUPLICATE KEY UPDATE value = VALUES(value)
            """,
            (dumps(current),),
            conn=conn,
        )
    return number


def bump_document_number_past(number: int) -> None:
    """Ensure the counter is above ``number`` (used by the sheet import)."""
    with transaction() as conn:
        row = query_one(
            "SELECT value FROM app_settings WHERE setting_key = 'documents' FOR UPDATE", conn=conn
        )
        current = _merge(DEFAULTS["documents"], loads(row["value"]) if row else None)
        if int(current["next_number"]) <= number:
            current["next_number"] = number + 1
            execute(
                """
                INSERT INTO app_settings (setting_key, value) VALUES ('documents', %s)
                ON DUPLICATE KEY UPDATE value = VALUES(value)
                """,
                (dumps(current),),
                conn=conn,
            )


# ----------------------------------------------------------------- tiers ---

def list_price_tiers(active_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM price_tiers"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort_order, id"
    return [serialize_row(r) for r in query(sql)]


def get_price_tier(code: str) -> dict | None:
    row = query_one("SELECT * FROM price_tiers WHERE code = %s", (code,))
    return serialize_row(row)


def replace_price_tiers(tiers: list[dict]) -> list[dict]:
    """Upsert the given tiers and deactivate any not present."""
    with transaction() as conn:
        codes = []
        for i, t in enumerate(tiers):
            code = (t.get("code") or "").strip()
            if not code:
                raise ValueError("Every price tier needs a code")
            codes.append(code)
            execute(
                """
                INSERT INTO price_tiers (code, label, day_type, price, min_group_size, notes, sort_order, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE label = VALUES(label), day_type = VALUES(day_type),
                    price = VALUES(price), min_group_size = VALUES(min_group_size),
                    notes = VALUES(notes), sort_order = VALUES(sort_order), is_active = VALUES(is_active)
                """,
                (
                    code,
                    t.get("label") or code,
                    t.get("day_type") or "weekday",
                    Decimal(str(t.get("price") or 0)),
                    int(t.get("min_group_size") or 0),
                    t.get("notes"),
                    int(t.get("sort_order") if t.get("sort_order") is not None else i * 10),
                    int(bool(t.get("is_active", True))),
                ),
                conn=conn,
            )
        if codes:
            placeholders = ",".join(["%s"] * len(codes))
            execute(
                f"UPDATE price_tiers SET is_active = 0 WHERE code NOT IN ({placeholders})",
                tuple(codes),
                conn=conn,
            )
    return list_price_tiers()


# ----------------------------------------------------------- season days ---

def list_season_days(from_day: date | None = None, to_day: date | None = None) -> list[dict]:
    sql = "SELECT * FROM season_days"
    params: list = []
    clauses = []
    if from_day:
        clauses.append("day >= %s")
        params.append(from_day)
    if to_day:
        clauses.append("day <= %s")
        params.append(to_day)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY day"
    return [serialize_row(r) for r in query(sql, tuple(params))]


def replace_season_days(days: list[dict]) -> list[dict]:
    with transaction() as conn:
        execute("DELETE FROM season_days", conn=conn)
        for d in days:
            execute(
                "INSERT INTO season_days (day, kind, label) VALUES (%s, %s, %s)",
                (d["day"], d.get("kind") or "closed", d.get("label")),
                conn=conn,
            )
    return list_season_days()
