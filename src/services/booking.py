"""Booking business rules: creation, edits, the status machine, payments,
arrivals and the read models the API serves (docs/booking-system.md §5, §7).

Every function takes and returns plain dict rows (native DB types). The API
layer serialises them. Validation errors raise ``BookingError`` with a
``fields`` map; a missing booking raises ``BookingNotFound``; an illegal
status change raises ``InvalidTransition``.

    b = create_booking({...}, source="form", actor=None)
    b = update_booking(b["id"], {"people_booked": 60}, actor=user_id)
    set_status(b["id"], "cancelled", actor, reason="Customer withdrew")
    record_payment(b["id"], "eft", Decimal("2800"), date.today(), "FY1703", None, actor)
    detail = get_booking_detail(b["id"])
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping
from zoneinfo import ZoneInfo

import phonenumbers
import pymysql
from phonenumbers import NumberParseException

from src.models import booking as booking_model
from src.models import booking_legacy_row as legacy_model
from src.models import booking_event as event_model
from src.models import booking_question as question_model
from src.models import payment as payment_model
from src.models.base import dumps, execute, loads, query, query_one, serialize_row, transaction
from src.models.booking import (
    ACTIVE_STATUSES,
    FIRM_STATUSES,
    STATUSES,
    TENTATIVE_STATUSES,
)
from src.services import day_kinds, pricing
from src.services.barcode import generate_barcode
from src.services.settings import (
    Settings,
    bump_document_number_past,
    get_settings,
    next_document_number,
)
from src.utils.date import get_today
from src.utils.holidays import holiday_name
from src.utils.logging import setup_logger

logger = setup_logger("booking")

SAST = ZoneInfo("Africa/Johannesburg")
TWO_PLACES = Decimal("0.01")
ZERO = Decimal("0.00")

SOURCES = ("form", "email", "import", "manual")
ARRIVAL_SOURCES = ("loyverse",)  # the customer app joins this list when it is ready
PAYMENT_KINDS = payment_model.KINDS
GROUP_TYPE_FALLBACK = "other"

# ------------------------------------------------------------ status machine --

TRANSITIONS: dict[str, frozenset[str]] = {
    # A form request waits for review: accept puts it on the calendar (enquiry,
    # then the proforma goes out) or decline closes it without a word being sent.
    "requested": frozenset({"enquiry", "proforma_sent", "declined", "cancelled"}),
    "enquiry": frozenset({"proforma_sent", "confirmed", "cancelled", "lapsed"}),
    "proforma_sent": frozenset({"confirmed", "cancelled", "lapsed"}),
    # confirmed → proforma_sent is the revert when a matched deposit is removed
    # (bank unmatch) and the deposit is no longer covered.
    "confirmed": frozenset({"completed", "cancelled", "no_show", "proforma_sent"}),
    "completed": frozenset(),
    "cancelled": frozenset({"enquiry"}),
    "lapsed": frozenset({"enquiry"}),
    "no_show": frozenset(),
    "declined": frozenset({"requested", "enquiry"}),
}

STATUS_STAMPS = {
    "enquiry": "accepted_at",
    "declined": "declined_at",
    "proforma_sent": "proforma_sent_at",
    "confirmed": "confirmed_at",
    "completed": "completed_at",
    "cancelled": "cancelled_at",
    "lapsed": "lapsed_at",
}

STATUS_LABELS = {
    "requested": "Request",
    "enquiry": "Enquiry",
    "proforma_sent": "Proforma sent",
    "confirmed": "Confirmed",
    "completed": "Completed",
    "cancelled": "Cancelled",
    "lapsed": "Expired",
    "no_show": "No show",
    "declined": "Declined",
}

FIELD_LABELS = {
    "group_name": "group name",
    "group_type": "group type",
    "area": "area",
    "billing_address": "billing address",
    "customer_vat_number": "customer VAT number",
    "contact_name": "contact name",
    "contact_email": "email",
    "contact_mobile": "mobile",
    "visit_date": "visit date",
    "alternative_date": "alternative date",
    "adults": "adults",
    "children": "children",
    "people_booked": "people",
    "price_tier_code": "rate",
    "tier_price": "rate price",
    "price_per_person": "price per person",
    "discount_per_person": "discount per person",
    "discount_reason": "discount reason",
    "minimum_waived_by": "minimum waived",
    "deposit_due": "deposit",
    "deposit_overridden": "deposit override",
    "deposit_waived": "deposit waived",
    "deposit_override_reason": "deposit override reason",
    "hold_expires_on": "expiry",
    "customer_notes": "customer notes",
    "internal_notes": "internal notes",
    "enquiry_date": "enquiry date",
    "email_thread_id": "email thread",
}


class BookingError(ValueError):
    """Invalid input. ``fields`` maps field name → message for 422 responses."""

    def __init__(self, message: str, fields: dict[str, str] | None = None):
        super().__init__(message)
        self.fields = fields or {}


class BookingNotFound(BookingError):
    pass


class InvalidTransition(BookingError):
    pass


def check_transition(current: str, new: str, visit_date: date, today: date) -> None:
    """Raise ``InvalidTransition`` unless ``current → new`` is allowed today."""
    if new not in STATUSES:
        raise InvalidTransition(f"Unknown status '{new}'", {"status": "Unknown status"})
    if new == current:
        raise InvalidTransition(
            f"Booking is already {STATUS_LABELS[current].lower()}", {"status": "No change"}
        )
    if new not in TRANSITIONS.get(current, frozenset()):
        raise InvalidTransition(
            f"Cannot move a booking from {STATUS_LABELS[current].lower()} to "
            f"{STATUS_LABELS[new].lower()}",
            {"status": "Not allowed from the current status"},
        )
    if new == "no_show" and visit_date >= today:
        raise InvalidTransition(
            "A booking can only be marked as a no-show after its visit date",
            {"status": "Visit date has not passed"},
        )


def allowed_transitions(current: str, visit_date: date, today: date) -> list[str]:
    out = []
    for status in TRANSITIONS.get(current, frozenset()):
        try:
            check_transition(current, status, visit_date, today)
        except InvalidTransition:
            continue
        out.append(status)
    return sorted(out, key=STATUSES.index)


# -------------------------------------------------------------- normalisers --

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def now_local() -> datetime:
    """Naive SAST timestamp; the DB session runs in SAST too."""
    return datetime.now(SAST).replace(tzinfo=None, microsecond=0)


def normalise_mobile(value: Any) -> str | None:
    """E.164 digits without the ``+`` (``27821234567``); None for empty."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = phonenumbers.parse(text, "ZA")
    except NumberParseException as exc:
        raise BookingError("Invalid mobile number", {"contact_mobile": "Invalid number"}) from exc
    if not phonenumbers.is_valid_number(parsed):
        raise BookingError("Invalid mobile number", {"contact_mobile": "Invalid number"})
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164).lstrip("+")


def normalise_email(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if not text:
        return None
    if not _EMAIL_RE.match(text):
        raise BookingError("Invalid email address", {"contact_email": "Invalid email address"})
    return text


def parse_date(value: Any, field: str) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError as exc:
        raise BookingError(f"Invalid date for {field}", {field: "Use YYYY-MM-DD"}) from exc


def parse_datetime(value: Any, field: str) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    try:
        return datetime.fromisoformat(str(value).strip().replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise BookingError(f"Invalid timestamp for {field}", {field: "Use ISO 8601"}) from exc


def parse_int(value: Any, field: str, minimum: int = 0) -> int | None:
    if value is None or value == "":
        return None
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise BookingError(f"Invalid number for {field}", {field: "Must be a whole number"}) from exc
    if number < minimum:
        raise BookingError(f"{field} must be at least {minimum}", {field: f"Must be at least {minimum}"})
    return number


def parse_money(value: Any, field: str) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        amount = Decimal(str(value).strip().replace(",", "")).quantize(TWO_PLACES)
    except (InvalidOperation, ValueError) as exc:
        raise BookingError(f"Invalid amount for {field}", {field: "Must be an amount"}) from exc
    if amount < 0:
        raise BookingError(f"{field} cannot be negative", {field: "Cannot be negative"})
    return amount


def parse_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def parse_text(value: Any, field: str, max_length: int | None = None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if max_length and len(text) > max_length:
        raise BookingError(
            f"{field} is too long", {field: f"At most {max_length} characters"}
        )
    return text


# -------------------------------------------------------------- validation ---

_TEXT_FIELDS = {
    "group_name": 255,
    "group_type": 32,
    "area": 255,
    "billing_address": 500,
    "customer_vat_number": 32,
    "contact_name": 255,
    "discount_reason": 255,
    "deposit_override_reason": 255,
    "customer_notes": None,
    "internal_notes": None,
}
_DATE_FIELDS = ("visit_date", "alternative_date", "hold_expires_on", "enquiry_date")
_INT_FIELDS = ("adults", "children", "people_booked")
_MONEY_FIELDS = ("price_per_person", "discount_per_person", "deposit_due")
_BOOL_FIELDS = ("deposit_overridden", "deposit_waived")
_CREATE_ONLY_STAMPS = (
    "proforma_sent_at",
    "invoice_sent_at",
    "final_invoice_sent_at",
    "ticket_sent_at",
    "ticket_emailed_at",
    "confirmed_at",
    "completed_at",
    "cancelled_at",
    "lapsed_at",
)


def validate_booking_data(
    data: Mapping[str, Any], *, partial: bool, settings: Settings
) -> dict[str, Any]:
    """Coerce and check an incoming payload. Unknown keys are ignored.

    ``partial=True`` (PATCH) only checks the keys present; ``partial=False``
    (create) also enforces the required fields.
    """
    clean: dict[str, Any] = {}
    errors: dict[str, str] = {}

    def attempt(field: str, fn, *args):
        try:
            clean[field] = fn(*args)
        except BookingError as exc:
            errors.update(exc.fields or {field: str(exc)})

    for field, max_len in _TEXT_FIELDS.items():
        if field in data:
            attempt(field, parse_text, data[field], field, max_len)
    for field in _DATE_FIELDS:
        if field in data:
            attempt(field, parse_date, data[field], field)
    for field in _INT_FIELDS:
        if field in data:
            attempt(field, parse_int, data[field], field)
    for field in _MONEY_FIELDS:
        if field in data:
            attempt(field, parse_money, data[field], field)
    for field in _BOOL_FIELDS:
        if field in data:
            clean[field] = parse_bool(data[field])
    if "contact_email" in data:
        attempt("contact_email", normalise_email, data["contact_email"])
    if "contact_mobile" in data:
        attempt("contact_mobile", normalise_mobile, data["contact_mobile"])
    if "email_thread_id" in data:
        attempt("email_thread_id", parse_int, data["email_thread_id"], "email_thread_id")
    if "price_tier_code" in data:
        code = parse_text(data["price_tier_code"], "price_tier_code", 32)
        if code and pricing.get_price_tier(code) is None:
            errors["price_tier_code"] = "Unknown rate"
        else:
            clean["price_tier_code"] = code
    if clean.get("discount_per_person") is not None and clean["discount_per_person"] < 0:
        errors["discount_per_person"] = "A discount cannot be negative"

    if clean.get("group_type") is not None:
        if pricing.group_type_config(clean["group_type"], settings) is None:
            errors["group_type"] = "Unknown group type"

    if not partial:
        for field in ("group_name", "contact_name", "visit_date"):
            if clean.get(field) is None and field not in errors:
                errors[field] = "This field is required"
        if "status" in data and data["status"] is not None:
            if data["status"] not in STATUSES:
                errors["status"] = "Unknown status"
            else:
                clean["status"] = data["status"]
        if "doc_number" in data and data["doc_number"] is not None:
            attempt("doc_number", parse_int, data["doc_number"], "doc_number", 1)
        if "questions" in data and data["questions"]:
            questions = data["questions"]
            if not isinstance(questions, (list, tuple)):
                errors["questions"] = "Must be a list of questions"
            else:
                clean["questions"] = [str(q).strip() for q in questions if str(q).strip()]
        if "legacy_sheet_row" in data and isinstance(data["legacy_sheet_row"], dict):
            clean["legacy_sheet_row"] = data["legacy_sheet_row"]
        for field in _CREATE_ONLY_STAMPS:
            if field in data:
                attempt(field, parse_datetime, data[field], field)
        if "arrived_count" in data and data["arrived_count"] is not None:
            attempt("arrived_count", parse_int, data["arrived_count"], "arrived_count")
            source = data.get("arrived_source") or "loyverse"
            if source not in ARRIVAL_SOURCES:
                errors["arrived_source"] = "Must be loyverse"
            else:
                clean["arrived_source"] = source

    if errors:
        raise BookingError("Validation failed", errors)
    return clean


# ----------------------------------------------------------------- pricing ----

def _derive_pricing(
    base: Mapping[str, Any],
    changes: Mapping[str, Any],
    s: Settings,
    *,
    other_group_on_day: bool | None = None,
) -> dict:
    """Rate, discount and deposit columns after ``changes`` are applied to ``base``.

    The rate follows the day, the group type and the headcount
    (``pricing.decide_tier``) and is re-derived whenever one of them changes; an
    explicit ``price_tier_code`` pins it. The discount is rands per person and
    survives recalculation: it is set from ``discount_per_person`` or derived
    from an agreed ``price_per_person``, is never negative (a price above the
    rate means a different rate, not a negative discount) and needs a reason
    while it is more than zero. The deposit rules are unchanged.

    ``other_group_on_day`` short-circuits the weekday-minimum lookup (tests).
    """
    merged = {**base, **changes}
    visit_date: date = merged["visit_date"]
    group_type = merged.get("group_type")
    people = int(merged.get("people_booked") or 0)
    is_create = not base

    inputs_changed = any(
        k in changes and changes[k] != base.get(k) for k in ("visit_date", "group_type", "people_booked")
    )
    waived_by = base.get("minimum_waived_by")
    if changes.get("price_tier_code"):
        tier = changes["price_tier_code"]
        waived_by = None
    elif is_create or inputs_changed or not base.get("price_tier_code"):
        other: int | None = None
        if people < pricing.group_minimum(s) and pricing.rate_day(visit_date, s) == "weekday":
            if other_group_on_day is None:
                other = booking_model.another_group_on_day(visit_date, base.get("id"))
            elif other_group_on_day:
                other = -1  # known to exist, identity not given
        decision = pricing.decide_tier(group_type, visit_date, people, s, other_group_on_day=other is not None)
        tier = decision.tier_code
        waived_by = (other if other and other > 0 else None) if decision.minimum_waived else None
    else:
        tier = base["price_tier_code"]
    tier_price = pricing.price_for_tier(tier)

    if changes.get("discount_per_person") is not None:
        discount = Decimal(str(changes["discount_per_person"]))
    elif changes.get("price_per_person") is not None:
        discount = tier_price - Decimal(str(changes["price_per_person"]))
        if discount < 0:
            raise BookingError(
                "The agreed price is above the rate",
                {"price_per_person": f"The rate is R{tier_price:.2f}. A higher price means a different rate, not a discount"},
            )
    else:
        discount = Decimal(str(base.get("discount_per_person") or 0))
    if discount < 0:
        raise BookingError("A discount cannot be negative", {"discount_per_person": "Cannot be negative"})
    if discount > tier_price:
        raise BookingError("The discount is more than the rate", {"discount_per_person": f"The rate is R{tier_price:.2f}"})
    discount = discount.quantize(TWO_PLACES)
    reason = changes.get("discount_reason", base.get("discount_reason")) if discount > 0 else None
    if discount > 0 and not reason:
        raise BookingError("A discount needs a reason", {"discount_reason": "Say why the price is below the rate"})
    price = (tier_price - discount).quantize(TWO_PLACES)

    waived = bool(changes.get("deposit_waived", base.get("deposit_waived")))
    computed_deposit = pricing.deposit_for(people, price, s)
    if waived:
        deposit, deposit_overridden = ZERO, False
    elif "deposit_overridden" in changes and changes["deposit_overridden"] is False:
        deposit, deposit_overridden = computed_deposit, False
    elif changes.get("deposit_due") is not None:
        deposit = changes["deposit_due"]
        deposit_overridden = bool(changes.get("deposit_overridden")) or deposit != computed_deposit
    elif base.get("deposit_overridden") and not base.get("deposit_waived"):
        deposit, deposit_overridden = Decimal(str(base["deposit_due"])), True
    else:
        deposit, deposit_overridden = computed_deposit, False
    deposit_reason = (
        changes.get("deposit_override_reason", base.get("deposit_override_reason"))
        if (deposit_overridden or waived)
        else None
    )

    return {
        "price_tier_code": tier,
        "tier_price": tier_price.quantize(TWO_PLACES),
        "discount_per_person": discount,
        "discount_reason": reason,
        "minimum_waived_by": waived_by,
        "price_per_person": price,
        "deposit_due": deposit.quantize(TWO_PLACES),
        "deposit_overridden": int(deposit_overridden),
        "deposit_waived": int(waived),
        "deposit_override_reason": deposit_reason,
    }


def quote(
    group_type: str | None,
    visit_date: date,
    people: int,
    *,
    exclude_id: int | None = None,
    settings: Settings | None = None,
) -> dict:
    """What a booking would be charged: the rate decision, its price, the deposit."""
    s = settings or get_settings()
    other: int | None = None
    if int(people or 0) < pricing.group_minimum(s) and pricing.rate_day(visit_date, s) == "weekday":
        other = booking_model.another_group_on_day(visit_date, exclude_id)
    decision = pricing.decide_tier(group_type, visit_date, people, s, other_group_on_day=other is not None)
    tier_price = pricing.price_for_tier(decision.tier_code)
    tier = pricing.get_price_tier(decision.tier_code) or {}
    return {
        **decision.as_dict(),
        "tier_label": tier.get("label") or decision.tier_code,
        "tier_price": float(tier_price),
        "minimum_waived_by": other if decision.minimum_waived else None,
        "group_minimum": pricing.group_minimum(s),
        "total": float(tier_price * int(people or 0)),
        "deposit_due": float(pricing.deposit_for(int(people or 0), tier_price, s)),
    }


# ----------------------------------------------------------------- helpers ----

def _require(booking_id: int) -> dict:
    row = booking_model.get(booking_id)
    if row is None:
        raise BookingNotFound(f"Booking {booking_id} not found")
    return row


def _unique_barcode(attempts: int = 8) -> str:
    for _ in range(attempts):
        code = generate_barcode()
        if not booking_model.barcode_exists(code):
            return code
    raise BookingError("Could not allocate a unique barcode")


def _diff(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, dict]:
    out = {}
    for key, new in after.items():
        old = before.get(key)
        if _norm(old) != _norm(new):
            out[key] = {"from": _json_value(old), "to": _json_value(new)}
    return out


def _norm(value: Any) -> Any:
    if isinstance(value, Decimal):
        return value.quantize(TWO_PLACES)
    if isinstance(value, bool):
        return int(value)
    return value


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _summarise(diff: Mapping[str, Any], prefix: str = "Updated") -> str:
    labels = [FIELD_LABELS.get(k, k.replace("_", " ")) for k in diff]
    if not labels:
        return prefix
    return f"{prefix} {', '.join(labels)}"


def add_event(
    booking_id: int,
    kind: str,
    summary: str,
    data: dict | None = None,
    actor: int | None = None,
    conn=None,
) -> int:
    return event_model.add(booking_id, kind, summary, data, actor, conn=conn)


def stamp(booking_id: int, column: str, when: datetime | None = None) -> None:
    """Set one of the ``*_at`` columns (``proforma_sent_at`` etc.) to now."""
    booking_model.update_fields(booking_id, {column: when or now_local()})


# ------------------------------------------------------------------ create ----


def _apply_visitors_alias(data: dict) -> dict:
    """``visitors`` is the public name for ``people_booked``; bookings count visitors only."""
    if "visitors" not in data:
        return data
    out = dict(data)
    visitors = out.pop("visitors")
    if out.get("people_booked") in (None, "") and visitors not in (None, ""):
        out["people_booked"] = visitors
    return out


def _mirror_primary_contact(booking_id: int) -> None:
    """Keep the booking's primary contact as a booking_contacts row (role
    primary) so the record lists one set of people and "on site" can land on
    any of them (migration 013 backfilled the existing bookings)."""
    from src.models import booking_contact

    booking = booking_model.get(booking_id)
    if not booking:
        return
    email = booking.get("contact_email")
    try:
        if email and "@" in email:
            # A booking that started without an address keeps one primary row:
            # the address lands on it rather than beside it.
            if not booking_contact.adopt_email_on_primary(
                booking_id, email, name=booking.get("contact_name"), mobile=booking.get("contact_mobile")
            ):
                booking_contact.upsert(
                    booking_id, email, name=booking.get("contact_name"), mobile=booking.get("contact_mobile"), role="primary", source="booking"
                )
        else:
            booking_contact.upsert_primary_without_email(booking_id, name=booking.get("contact_name"), mobile=booking.get("contact_mobile"))
    except Exception:  # noqa: BLE001 - never let the mirror break a save
        logger.exception("Could not mirror the primary contact for booking %s", booking_id)


def create_booking(
    data: Mapping[str, Any],
    source: str,
    actor: int | None,
    doc_number: int | None = None,
) -> dict:
    """Create a booking: reference, barcode, price and deposit are all assigned here."""
    if source not in SOURCES:
        raise BookingError(f"Unknown source '{source}'", {"source": "Unknown source"})
    s = get_settings()
    data = _apply_visitors_alias(data)
    clean = validate_booking_data(data, partial=False, settings=s)

    if clean.get("people_booked") is None:
        clean["people_booked"] = int(clean.get("adults") or 0) + int(clean.get("children") or 0)
    if clean["people_booked"] < 1 and source != "import":
        raise BookingError("At least one person is required", {"people_booked": "Must be at least 1"})

    questions = clean.pop("questions", [])
    status = clean.pop("status", None) or "enquiry"
    doc_number = clean.pop("doc_number", None) or doc_number
    if doc_number is not None:
        if booking_model.doc_number_exists(doc_number):
            raise BookingError(
                f"Document number {doc_number} is already in use",
                {"doc_number": "Already in use"},
            )
        bump_document_number_past(doc_number)
    else:
        doc_number = next_document_number()

    fields: dict[str, Any] = {
        "reference": f"{s.documents.proforma_prefix}{doc_number}",
        "doc_number": doc_number,
        "status": status,
        "source": source,
        "barcode": _unique_barcode(),
        "created_by": actor,
        **{k: v for k, v in clean.items() if k in booking_model.WRITABLE_COLUMNS},
    }
    fields.setdefault("enquiry_date", get_today())
    if fields.get("enquiry_date") is None:
        fields["enquiry_date"] = get_today()
    if not fields.get("hold_expires_on"):
        fields["hold_expires_on"] = pricing.hold_expiry_for(fields["visit_date"], s)
    fields.update(_derive_pricing({}, clean, s))
    for col in ("adults", "children"):
        fields[col] = int(fields.get(col) or 0)
    legacy_row = clean.get("legacy_sheet_row")
    stamp_col = STATUS_STAMPS.get(status)
    if stamp_col and not fields.get(stamp_col):
        fields[stamp_col] = now_local()

    try:
        with transaction() as conn:
            booking_id = booking_model.insert(fields, conn=conn)
            add_event(
                booking_id,
                "created",
                f"Booking created ({source})",
                {
                    "source": source,
                    "status": status,
                    "price_per_person": float(fields["price_per_person"]),
                    "deposit_due": float(fields["deposit_due"]),
                    "price_tier_code": fields["price_tier_code"],
                },
                actor,
                conn=conn,
            )
            if legacy_row:
                legacy_model.set_row(booking_id, legacy_row, conn=conn)
            if fields["discount_per_person"] > 0 or fields["deposit_overridden"] or fields["deposit_waived"]:
                add_event(
                    booking_id,
                    "override",
                    _override_summary(fields),
                    _override_data(fields),
                    actor,
                    conn=conn,
                )
            for i, question in enumerate(questions, start=1):
                question_model.add(booking_id, question, i, conn=conn)
    except pymysql.err.IntegrityError as exc:
        raise BookingError(f"Could not create booking: {exc.args[-1]}") from exc

    logger.info(f"Created booking {fields['reference']} (id {booking_id}, source {source})")
    _mirror_primary_contact(booking_id)
    return booking_model.get(booking_id)


def _override_summary(fields: Mapping[str, Any]) -> str:
    parts = []
    discount = Decimal(str(fields.get("discount_per_person") or 0))
    if discount > 0:
        why = f" ({fields['discount_reason']})" if fields.get("discount_reason") else ""
        parts.append(f"discount R{discount:.2f} per person{why}")
    if fields.get("deposit_waived"):
        parts.append("deposit waived")
    elif fields.get("deposit_overridden"):
        parts.append(f"deposit set to R{Decimal(str(fields['deposit_due'])):.2f}")
    if not parts:
        return "Discount removed"
    text = ", ".join(parts)
    return text[0].upper() + text[1:]


def _override_data(fields: Mapping[str, Any]) -> dict:
    return {
        "price_tier_code": fields.get("price_tier_code"),
        "tier_price": _json_value(fields.get("tier_price")),
        "discount_per_person": _json_value(fields.get("discount_per_person")),
        "discount_reason": fields.get("discount_reason"),
        "price_per_person": _json_value(fields.get("price_per_person")),
        "deposit_overridden": bool(fields.get("deposit_overridden")),
        "deposit_waived": bool(fields.get("deposit_waived")),
        "deposit_due": _json_value(fields.get("deposit_due")),
        "deposit_override_reason": fields.get("deposit_override_reason"),
    }


# ------------------------------------------------------------------ update ----

_OVERRIDE_COLUMNS = (
    "price_tier_code",
    "tier_price",
    "discount_per_person",
    "discount_reason",
    "minimum_waived_by",
    "price_per_person",
    "deposit_overridden",
    "deposit_waived",
    "deposit_due",
    "deposit_override_reason",
)


def update_booking(booking_id: int, data: Mapping[str, Any], actor: int | None) -> dict:
    """Apply an edit, recalculating price/deposit unless they are overridden."""
    current = _require(booking_id)
    s = get_settings()
    data = _apply_visitors_alias(data)
    clean = validate_booking_data(data, partial=True, settings=s)
    if not clean:
        return current

    if "adults" in clean or "children" in clean:
        if "people_booked" not in clean:
            adults = clean.get("adults", current.get("adults")) or 0
            children = clean.get("children", current.get("children")) or 0
            if adults + children > 0:
                clean["people_booked"] = adults + children
    if clean.get("people_booked") is not None and clean["people_booked"] < 1:
        raise BookingError("At least one person is required", {"people_booked": "Must be at least 1"})

    updates = {k: v for k, v in clean.items() if k in booking_model.WRITABLE_COLUMNS}
    updates.update(_derive_pricing(current, clean, s))

    if "visit_date" in clean and "hold_expires_on" not in clean:
        if clean["visit_date"] != current["visit_date"]:
            updates["hold_expires_on"] = pricing.hold_expiry_for(clean["visit_date"], s)

    diff = _diff(current, updates)
    if not diff:
        return current
    changed = {k: updates[k] for k in diff}

    override_diff = {k: v for k, v in diff.items() if k in _OVERRIDE_COLUMNS}
    override_flags_changed = any(
        k in override_diff for k in ("discount_per_person", "discount_reason", "deposit_overridden", "deposit_waived")
    ) or (updates["deposit_overridden"] and "deposit_due" in override_diff)

    with transaction() as conn:
        booking_model.update_fields(booking_id, changed, conn=conn)
        plain_diff = {k: v for k, v in diff.items() if not (override_flags_changed and k in _OVERRIDE_COLUMNS)}
        if plain_diff:
            add_event(booking_id, "updated", _summarise(plain_diff), {"changes": plain_diff}, actor, conn=conn)
        if override_flags_changed:
            merged = {**current, **changed}
            add_event(
                booking_id,
                "override",
                _override_summary(merged),
                {**_override_data(merged), "changes": override_diff},
                actor,
                conn=conn,
            )
    logger.info(f"Updated booking {current['reference']}: {', '.join(diff)}")
    _mirror_primary_contact(booking_id)
    return booking_model.get(booking_id)


# ------------------------------------------------------------------ status ----

def set_status(booking_id: int, status: str, actor: int | None, reason: str | None = None) -> dict:
    booking = _require(booking_id)
    check_transition(booking["status"], status, booking["visit_date"], get_today())
    fields: dict[str, Any] = {"status": status}
    stamp_col = STATUS_STAMPS.get(status)
    reverting = booking["status"] == "confirmed" and status == "proforma_sent"
    if stamp_col and not (reverting and booking.get(stamp_col)):
        fields[stamp_col] = now_local()
    if status == "enquiry":  # reopen
        fields["cancelled_at"] = None
        fields["lapsed_at"] = None
    if reverting:  # the deposit is no longer covered: the confirmation is undone
        fields["confirmed_at"] = None
    with transaction() as conn:
        booking_model.update_fields(booking_id, fields, conn=conn)
        summary = f"{STATUS_LABELS[booking['status']]} → {STATUS_LABELS[status]}"
        if reason:
            summary += f": {reason}"
        add_event(
            booking_id,
            "status_changed",
            summary,
            {"from": booking["status"], "to": status, "reason": reason},
            actor,
            conn=conn,
        )
    logger.info(f"Booking {booking['reference']}: {booking['status']} → {status}")
    return booking_model.get(booking_id)


# ---------------------------------------------------------------- payments ----

def record_payment(
    booking_id: int,
    kind: str,
    amount: Decimal | str | float,
    paid_on: date | str | None,
    reference: str | None,
    note: str | None,
    actor: int | None,
    bank_transaction_id: int | None = None,
) -> dict:
    """Insert a payment; confirm the booking once the deposit is covered."""
    booking = _require(booking_id)
    if kind not in PAYMENT_KINDS:
        raise BookingError("Unknown payment kind", {"kind": f"Must be one of {', '.join(PAYMENT_KINDS)}"})
    value = parse_money(amount, "amount")
    if value is None or value <= 0:
        raise BookingError("Amount must be greater than zero", {"amount": "Must be greater than zero"})
    when = parse_date(paid_on, "paid_on") or get_today()
    reference = parse_text(reference, "reference", 120)
    note = parse_text(note, "note", 255)

    try:
        with transaction() as conn:
            payment_id = payment_model.insert(
                booking_id, kind, value, when, reference, note, actor, bank_transaction_id, conn=conn
            )
            add_event(
                booking_id,
                "payment_recorded",
                f"{kind.upper()} payment of R{value:.2f} recorded",
                {
                    "payment_id": payment_id,
                    "kind": kind,
                    "amount": float(value),
                    "paid_on": when.isoformat(),
                    "reference": reference,
                    "bank_transaction_id": bank_transaction_id,
                },
                actor,
                conn=conn,
            )
    except pymysql.err.IntegrityError as exc:
        raise BookingError(
            "That bank transaction is already matched to a payment",
            {"bank_transaction_id": "Already matched"},
        ) from exc

    if booking["status"] in TENTATIVE_STATUSES:
        paid_total = payment_model.sum_for_booking(booking_id)
        deposit_due = ZERO if booking["deposit_waived"] else Decimal(str(booking["deposit_due"]))
        if paid_total > 0 and paid_total >= deposit_due:
            set_status(booking_id, "confirmed", actor, reason="Deposit received")

    return serialize_row(payment_model.get(payment_id))


def delete_payment(booking_id: int, payment_id: int, actor: int | None) -> None:
    booking = _require(booking_id)
    payment = payment_model.get(payment_id)
    if payment is None or payment["booking_id"] != booking["id"]:
        raise BookingNotFound("Payment not found")
    if payment.get("bank_transaction_id"):
        raise BookingError(
            "This payment came from a matched bank transaction. Unmatch it from the Payments page instead."
        )
    with transaction() as conn:
        payment_model.delete(payment_id, conn=conn)
        add_event(
            booking_id,
            "payment_deleted",
            f"{payment['kind'].upper()} payment of R{Decimal(str(payment['amount'])):.2f} removed",
            {"payment": serialize_row(payment)},
            actor,
            conn=conn,
        )


# ----------------------------------------------------------------- finance ----

def booking_finance(
    booking: Mapping[str, Any],
    paid_total: Decimal | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Money derived from the row, never stored. Decimal values.

    total_amount = people_booked × price; final_amount = arrived_count × price
    (None until arrivals are recorded); balance_due is against the final
    amount once it exists, otherwise against the total.
    """
    s = settings or get_settings()
    price = Decimal(str(booking["price_per_person"] or 0)).quantize(TWO_PLACES)
    people = int(booking.get("people_booked") or 0)
    total = (price * people).quantize(TWO_PLACES)
    deposit_due = ZERO if booking.get("deposit_waived") else Decimal(str(booking.get("deposit_due") or 0))
    deposit_due = deposit_due.quantize(TWO_PLACES)
    if paid_total is None:
        paid_total = payment_model.sum_for_booking(int(booking["id"]))
    paid = Decimal(str(paid_total)).quantize(TWO_PLACES)
    arrived = booking.get("arrived_count")
    final_amount = (price * int(arrived)).quantize(TWO_PLACES) if arrived is not None else None
    basis = final_amount if final_amount is not None else total
    vat_rate = Decimal(str(s.pricing.vat_rate))
    vat_divisor = Decimal(100) + vat_rate

    def vat(amount: Decimal) -> Decimal:
        return (amount * vat_rate / vat_divisor).quantize(TWO_PLACES)

    return {
        "price_per_person": price,
        "people_booked": people,
        "total_amount": total,
        "vat_amount": vat(total),
        "vat_rate": vat_rate,
        "deposit_due": deposit_due,
        "deposit_waived": bool(booking.get("deposit_waived")),
        "paid_total": paid,
        "deposit_outstanding": max(deposit_due - paid, ZERO),
        "deposit_covered": paid >= deposit_due,
        "balance_due": (basis - paid).quantize(TWO_PLACES),
        "arrived_count": int(arrived) if arrived is not None else None,
        "final_amount": final_amount,
        "final_vat_amount": vat(final_amount) if final_amount is not None else None,
    }


# ------------------------------------------------- questions, notes, arrivals --

def add_question(booking_id: int, question: str, actor: int | None) -> dict:
    _require(booking_id)
    text = parse_text(question, "question")
    if not text:
        raise BookingError("A question is required", {"question": "This field is required"})
    with transaction() as conn:
        qid = question_model.add(booking_id, text, conn=conn)
        add_event(booking_id, "updated", "Question added", {"question_id": qid, "question": text}, actor, conn=conn)
    return serialize_row(question_model.get(qid))


def answer_question(booking_id: int, question_id: int, answer: str, actor: int | None) -> dict:
    _require(booking_id)
    question = question_model.get(question_id)
    if question is None or question["booking_id"] != booking_id:
        raise BookingNotFound("Question not found")
    text = parse_text(answer, "answer")
    if not text:
        raise BookingError("An answer is required", {"answer": "This field is required"})
    with transaction() as conn:
        question_model.answer(question_id, text, actor, conn=conn)
        add_event(booking_id, "updated", "Question answered", {"question_id": question_id}, actor, conn=conn)
    return serialize_row(question_model.get(question_id))


def add_note(booking_id: int, text: str, actor: int | None) -> dict:
    _require(booking_id)
    note = parse_text(text, "text")
    if not note:
        raise BookingError("Note text is required", {"text": "This field is required"})
    summary = " ".join(note.split())
    event_id = add_event(booking_id, "note", summary[:255], {"text": note}, actor)
    row = query_one("SELECT * FROM booking_events WHERE id = %s", (event_id,))
    return event_model.serialize(row) if row else {"id": event_id}


def record_arrivals(booking_id: int, count: int, source: str, actor: int | None) -> dict:
    booking = _require(booking_id)
    if source not in ARRIVAL_SOURCES:
        raise BookingError("Unknown arrivals source", {"source": "Must be loyverse"})
    number = parse_int(count, "count")
    if number is None:
        raise BookingError("A count is required", {"count": "This field is required"})
    with transaction() as conn:
        booking_model.update_fields(
            booking_id, {"arrived_count": number, "arrived_source": source}, conn=conn
        )
        add_event(
            booking_id,
            "arrivals_recorded",
            f"{number} arrived ({source})",
            {"count": number, "source": source, "previous": booking.get("arrived_count")},
            actor,
            conn=conn,
        )
    if booking["status"] == "confirmed" and number > 0:
        set_status(booking_id, "completed", actor, reason="Arrivals recorded")
    return booking_model.get(booking_id)


# ----------------------------------------------------------------- calendar ---

CALENDAR_BOOKING_FIELDS = (
    "id",
    "reference",
    "group_name",
    "status",
    "people_booked",
    "group_type",
    "contact_name",
)


def aggregate_calendar(
    from_date: date,
    to_date: date,
    bookings: Iterable[Mapping[str, Any]],
    s: Settings,
    season_days: Mapping[date, dict],
) -> list[dict]:
    """Pure per-day roll-up; every day in the range appears, empty or not."""
    by_day: dict[date, list] = defaultdict(list)
    for b in bookings:
        if b["status"] in ACTIVE_STATUSES:
            by_day[b["visit_date"]].append(b)

    over_at = over_threshold(s)
    days = []
    d = from_date
    while d <= to_date:
        todays = by_day.get(d, [])
        total = sum(int(b["people_booked"] or 0) for b in todays)
        firm = sum(int(b["people_booked"] or 0) for b in todays if b["status"] in FIRM_STATUSES)
        tentative = sum(int(b["people_booked"] or 0) for b in todays if b["status"] in TENTATIVE_STATUSES)
        kinds = day_kinds.kinds_for(d, s, season_days)
        days.append(
            {
                "date": d.isoformat(),
                "weekday": d.weekday(),
                "day_type": pricing.day_type(d, s),
                "is_closed": pricing.is_closed(d, s, season_days),
                "is_avoid": pricing.is_avoid(d, s),
                "is_peak": pricing.is_peak(d, s, season_days),
                "is_school_holiday": pricing.is_school_holiday(d, s),
                "label": pricing.day_label(d, season_days) or holiday_name(d),
                "kind": kinds[0] if kinds else None,
                "kinds": [k["code"] for k in kinds],
                "total_people": total,
                "confirmed_people": firm,
                "tentative_people": tentative,
                "booking_count": len(todays),
                "over": total >= over_at,
                "capacity_warning": total >= over_at,
                "bookings": [
                    {k: _json_value(b.get(k)) for k in CALENDAR_BOOKING_FIELDS} for b in todays
                ],
            }
        )
        d += timedelta(days=1)
    return days


def capacity_of(s: Settings | None = None) -> int:
    """The day's capacity the calendar bar is drawn against (Settings › Capacity)."""
    s = s or get_settings()
    return int(s.capacity.get("capacity") or 1500)


def over_threshold(s: Settings | None = None) -> int:
    """People booked on one day from which the calendar shows OVER."""
    s = s or get_settings()
    return int(s.capacity.get("over_threshold") or s.capacity.get("daily_warning_people") or capacity_of(s))


def calendar_days(from_date: date, to_date: date) -> list[dict]:
    s = get_settings()
    season_days = pricing.load_season_days(from_date, to_date)
    rows = booking_model.list_by_date_range(from_date, to_date, ACTIVE_STATUSES)
    return aggregate_calendar(from_date, to_date, rows, s, season_days)


DAY_VIEW_STATUSES = (*ACTIVE_STATUSES, "no_show")


def day_detail(d: date) -> dict:
    """The manager's day view: each booking with its finance and payments."""
    s = get_settings()
    season_days = pricing.load_season_days(d, d)
    rows = booking_model.list_for_date(d, DAY_VIEW_STATUSES)
    if d == get_today():
        from src.services import arrivals  # the terminals' data, read as the page loads

        arrivals.refresh_rows(rows, d)
    items = []
    totals = {
        "bookings": 0,
        "total_people": 0,
        "confirmed_people": 0,
        "tentative_people": 0,
        "arrived_total": 0,
        "paid_total": ZERO,
        "balance_due_total": ZERO,
    }
    for row in rows:
        finance = booking_finance(row, paid_total=row.get("paid_total"), settings=s)
        items.append(
            {
                **booking_model.serialize(row),
                "finance": serialize_row(finance),
                "payments": payment_model.list_for_booking(row["id"]),
            }
        )
        people = int(row["people_booked"] or 0)
        totals["bookings"] += 1
        if row["status"] in ACTIVE_STATUSES:
            totals["total_people"] += people
        if row["status"] in FIRM_STATUSES:
            totals["confirmed_people"] += people
        if row["status"] in TENTATIVE_STATUSES:
            totals["tentative_people"] += people
        totals["arrived_total"] += int(row.get("arrived_count") or 0)
        totals["paid_total"] += finance["paid_total"]
        totals["balance_due_total"] += finance["balance_due"]
    return {
        "date": d.isoformat(),
        "weekday": d.weekday(),
        "day_type": pricing.day_type(d, s),
        "is_closed": pricing.is_closed(d, s, season_days),
        "is_avoid": pricing.is_avoid(d, s),
        "is_peak": pricing.is_peak(d, s, season_days),
        "label": pricing.day_label(d, season_days) or holiday_name(d),
        "public_holiday": holiday_name(d),
        "kind": day_kinds.primary_kind(d, s, season_days),
        "kinds": [k["code"] for k in day_kinds.kinds_for(d, s, season_days)],
        "over": totals["total_people"] >= over_threshold(s),
        "capacity_warning": totals["total_people"] >= over_threshold(s),
        "totals": serialize_row(totals),
        "bookings": items,
    }


# ------------------------------------------------------- related read models --

def list_documents(booking_id: int) -> list[dict]:
    """Issued documents for the detail view, newest first when the documents
    service is present (its rows carry ``label`` and ``filename``); a plain
    SELECT otherwise so the page works while that service is absent."""
    try:
        from src.services import documents as documents_service
    except ModuleNotFoundError as exc:
        if exc.name != "src.services.documents":
            raise
    else:
        return documents_service.list_documents(booking_id)
    rows = query(
        """
        SELECT d.id, d.booking_id, d.kind, d.number, d.version, d.total, d.paid, d.due,
               d.issued_at, d.issued_by, d.email_message_id, u.full_name AS issued_by_name
        FROM documents d
        LEFT JOIN users u ON u.id = d.issued_by
        WHERE d.booking_id = %s
        ORDER BY d.issued_at, d.id
        """,
        (booking_id,),
    )
    return [serialize_row(r) for r in rows]


def latest_document(booking_id: int, kind: str | None = None) -> dict | None:
    """Most recent document row (with file_path and snapshot) for attaching/re-use."""
    sql = "SELECT * FROM documents WHERE booking_id = %s"
    params: list = [booking_id]
    if kind:
        sql += " AND kind = %s"
        params.append(kind)
    sql += " ORDER BY issued_at DESC, version DESC, id DESC LIMIT 1"
    return query_one(sql, tuple(params))


def get_document(document_id: int) -> dict | None:
    return query_one("SELECT * FROM documents WHERE id = %s", (document_id,))


def list_emails(booking_id: int) -> list[dict]:
    rows = query(
        """
        SELECT id, direction, kind, subject, from_name, from_email, to_emails, sent_at, snippet,
               has_attachments, send_status, send_error, gmail_thrid, message_id_header
        FROM email_messages
        WHERE booking_id = %s
        ORDER BY sent_at, id
        """,
        (booking_id,),
    )
    out = []
    for r in rows:
        item = serialize_row(r)
        item["to_emails"] = loads(r.get("to_emails"))
        item["has_attachments"] = bool(item.get("has_attachments"))
        out.append(item)
    return out


def latest_message_id_header(booking: Mapping[str, Any]) -> str | None:
    """Message-ID to thread the next outbound email onto (primary thread first)."""
    booking_id = int(booking["id"])
    if booking.get("email_thread_id"):
        row = query_one(
            """
            SELECT message_id_header FROM email_messages
            WHERE booking_id = %s AND gmail_thrid = %s AND message_id_header IS NOT NULL
            ORDER BY sent_at DESC, id DESC LIMIT 1
            """,
            (booking_id, booking["email_thread_id"]),
        )
        if row:
            return row["message_id_header"]
    row = query_one(
        """
        SELECT message_id_header FROM email_messages
        WHERE booking_id = %s AND message_id_header IS NOT NULL
        ORDER BY sent_at DESC, id DESC LIMIT 1
        """,
        (booking_id,),
    )
    return row["message_id_header"] if row else None


def list_reminders(booking_id: int) -> list[dict]:
    rows = query(
        "SELECT * FROM booking_reminders WHERE booking_id = %s ORDER BY due_on, id",
        (booking_id,),
    )
    return [serialize_row(r) for r in rows]


def mark_reminder_sent(booking_id: int, kind: str) -> int:
    return execute(
        "UPDATE booking_reminders SET status = 'sent' WHERE booking_id = %s AND kind = %s AND status = 'due'",
        (booking_id, kind),
    )


def _list_contacts(booking_id: int) -> list[dict]:
    from src.models import booking_contact

    return [serialize_row(r) for r in booking_contact.list_for_booking(booking_id)]


def _pending_pops(booking_id: int) -> list[dict]:
    from src.models import pop as pop_model
    from src.services import pop

    return [pop.serialize(r) for r in pop_model.list_for_booking(booking_id) if r.get("status") == "pending"]


def _unanswered_count(booking_id: int) -> int:
    try:
        from src.services import waiting

        return len(waiting.unanswered_messages(f"b:{int(booking_id)}"))
    except Exception:  # noqa: BLE001 - the mail side must never break the record
        return 0


def get_booking_detail(booking_id: int, settings: Settings | None = None) -> dict:
    """Everything the booking page shows, JSON-safe. Shape documented in
    docs/handoff/bookings.md."""
    booking = _require(booking_id)
    s = settings or get_settings()
    today = get_today()
    if booking["visit_date"] == today and booking["status"] in ("confirmed", "completed"):
        from src.services import arrivals  # the terminals' data, read as the page loads

        if arrivals.refresh_rows([booking], today):
            booking = _require(booking_id)  # completion may have followed the first arrival
    finance = booking_finance(booking, settings=s)
    detail = booking_model.serialize(booking)
    detail.update(
        {
            "status_label": STATUS_LABELS.get(booking["status"], booking["status"]),
            "allowed_transitions": allowed_transitions(booking["status"], booking["visit_date"], today),
            "day_type": pricing.day_type(booking["visit_date"], s),
            "is_peak": pricing.is_peak(booking["visit_date"], s),
            "is_school_holiday": pricing.is_school_holiday(booking["visit_date"], s),
            "rate_day": pricing.rate_day(booking["visit_date"], s),
            "finance": serialize_row(finance),
            # Messages the customer sent that nobody answered: on the detail so the
            # record's badges and Needs attention paint right, without waiting for
            # the conversation to load.
            "unanswered_count": _unanswered_count(booking_id),
            "questions": question_model.list_for_booking(booking_id),
            "payments": payment_model.list_for_booking(booking_id),
            "events": event_model.list_for_booking(booking_id),
            "documents": list_documents(booking_id),
            "emails": list_emails(booking_id),
            "reminders": list_reminders(booking_id),
            # The record's Contacts and Payments tabs (UI round two).
            "contacts": _list_contacts(booking_id),
            "pops": _pending_pops(booking_id),
        }
    )
    return detail


# ------------------------------------------------------------ requests ---


def accept_request(booking_id: int, data: Mapping[str, Any] | None, actor: int | None) -> dict:
    """Review done: apply any edits, put the request on the calendar as an
    enquiry. The proforma is sent by the caller (the API's send-proforma
    action) so the send stays a visible, logged step."""
    booking = _require(booking_id)
    if booking["status"] != "requested":
        raise InvalidTransition("Only a request can be accepted", {"status": "Not a request"})
    changes = {k: v for k, v in dict(data or {}).items() if k != "status"}
    if changes:
        update_booking(booking_id, changes, actor)
    set_status(booking_id, "enquiry", actor, reason="Request accepted")
    return _require(booking_id)


def decline_request(booking_id: int, reason: str | None, actor: int | None) -> dict:
    booking = _require(booking_id)
    if booking["status"] != "requested":
        raise InvalidTransition("Only a request can be declined", {"status": "Not a request"})
    set_status(booking_id, "declined", actor, reason=reason or "Request declined")
    return _require(booking_id)


# ------------------------------------------------------- latest action ---

EMAIL_ACTION_LABELS = {
    # The owner's wording (sheet of 29 Oct 2026): Title Case, past tense.
    "proforma": "Proforma Sent",
    "invoice": "Invoice Sent",
    "final_invoice": "Final Invoice Sent",
    "ticket": "Ticket Sent",
    "payment_confirmation": "Payment Confirmed",
    "deposit_reminder": "Deposit Reminder Sent",
    "still_interested": "Follow-up Sent",
    "final_details": "Final Details Sent",
    "expiry": "Expiry Notice Sent",
    "answers": "Answers Sent",
    "acknowledgement": "Request Acknowledged",
    "bounce_back": "Form Link Sent",
    "convert_enquiry": "Form Link Sent",
    "reply": "Response Sent",
}
STATUS_ACTION_LABELS = {
    "requested": "Request Received",
    "enquiry": "Request Accepted",
    "proforma_sent": "Proforma Sent",
    "confirmed": "Confirmed",
    "completed": "Visit Completed",
    "cancelled": "Cancelled",
    "lapsed": "Expired",
    "no_show": "No Show",
    "declined": "Declined",
}


def latest_actions(booking_ids: list[int] | tuple[int, ...]) -> dict[int, dict]:
    """The most recent thing that happened on each booking, from either side:
    an email we sent (by kind), a customer email, a payment, a WhatsApp
    ticket, a status change or the creation. ``{id: {label, at, who}}``;
    ``who`` is ``us``, ``customer`` or ``system``."""
    ids = sorted({int(b) for b in booking_ids})
    if not ids:
        return {}
    marks = ",".join(["%s"] * len(ids))
    rows = query(
        f"""
        SELECT booking_id, 'email' AS src, direction, kind, sent_at AS at, from_name AS name
        FROM email_messages
        WHERE booking_id IN ({marks}) AND sent_at IS NOT NULL AND is_auto_generated = 0
          AND (direction = 'inbound' OR send_status IS NULL OR send_status = 'sent')
        UNION ALL
        SELECT booking_id, 'payment', NULL, kind, CAST(paid_on AS DATETIME), NULL
        FROM payments WHERE booking_id IN ({marks})
        UNION ALL
        SELECT booking_id, 'event', CASE WHEN summary LIKE 'Imported%%' THEN 'import' ELSE NULL END, kind, created_at,
               JSON_UNQUOTE(JSON_EXTRACT(data, '$.to'))
        FROM booking_events
        WHERE booking_id IN ({marks}) AND kind IN ('status_changed', 'created', 'ticket_sent', 'whatsapp_sent')
        """,
        (*ids, *ids, *ids),
    )
    best: dict[int, dict] = {}
    created: dict[int, dict] = {}
    for r in rows:
        bid = int(r["booking_id"])
        at = r.get("at")
        if at is None:
            continue
        label, who = _action_label(r)
        if label is None:
            continue
        # Creation only counts when nothing else ever happened: an imported
        # booking's "Added" must not outrank the mail it was imported with.
        imported = r["src"] == "event" and (r.get("kind") == "created" or r.get("direction") == "import")
        target = created if imported else best
        current = target.get(bid)
        if current is None or at > current["at"]:
            target[bid] = {"label": label, "at": at, "who": who}
    for bid, row in created.items():
        best.setdefault(bid, row)
    return best


def _action_label(r: dict) -> tuple[str | None, str]:
    src = r["src"]
    kind = r.get("kind") or ""
    if src == "email":
        if r.get("direction") == "inbound":
            return "Customer Reply", "customer"
        return EMAIL_ACTION_LABELS.get(kind, "Response Sent"), "us"
    if src == "payment":
        return ("Cash Received" if kind == "cash" else "Payment Received"), "customer"
    if kind == "status_changed":
        to = r.get("name") or ""
        if to in ("proforma_sent",):
            return None, "us"  # the email row says it better
        return STATUS_ACTION_LABELS.get(to, "Status Changed"), "us"
    if kind == "created":
        return "Added", "us"
    if kind in ("ticket_sent", "whatsapp_sent"):
        return "Ticket Sent", "us"
    # Arrivals are not an action: the gate records them live on the day.
    return None, "system"
