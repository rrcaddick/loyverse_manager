"""Public booking-request form: validation, Turnstile, rate limiting, submission log.

The form is the only unauthenticated write path into the system, so everything
here is defensive: every field is validated against the live settings, dates
are checked against the season and the closed days, Cloudflare Turnstile is
verified server-side, and submissions are counted per IP.

    clean, errors = validate_request(payload, get_settings())
    if not errors and verify_turnstile(token, ip) and not rate_limited(ip):
        booking = create_booking_compat(clean, source="form", actor=None)

This module also carries the thin ``*_compat`` bridge to the bookings service
(``src/services/booking.py``, built in parallel by another agent). The bridge
calls the real service when it is importable and otherwise writes a plain row
itself, so the public form and the sheet import keep working on a branch where
the service has not landed yet.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Mapping

import phonenumbers
import requests
from email_validator import EmailNotValidError, validate_email

import jwt

from config.constants import GAZEBOS
from config.settings import IMAGE_TOKEN_SECRET, SECRET_KEY, TURNSTILE_SECRET_KEY
from src.models.base import dumps, execute, query, query_one, serialize_row, transaction
from src.services.barcode import generate_barcode
from src.services.settings import Settings, get_settings, next_document_number
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("public_form")

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TURNSTILE_TIMEOUT_SECONDS = 10
RATE_LIMIT_PER_HOUR = 5

MAX_TEXT = 255
MAX_ARRIVAL_TIME = 20
MAX_NOTES = 2000
MAX_QUESTION = 500
# The park has a fixed set of gazebos to hire (config/constants.py).
MAX_GAZEBOS = len(GAZEBOS) or 7
DEFAULT_MAX_GROUP_SIZE = 900
DEFAULT_ARRIVAL_SLOTS = (
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "12:00", "12:30", "13:00", "13:30", "14:00", "Not sure yet",
)
# How far ahead to look for the next open day in a closed-day error.
NEXT_OPEN_DAY_HORIZON = 60

# The signed receipt that lets the confirmation page survive a refresh.
RECEIPT_PURPOSE = "request_receipt"
RECEIPT_TTL_DAYS = 7

# Keys that never belong in a stored payload.
_PAYLOAD_DROP = ("turnstile_token", "cf-turnstile-response", "website")

WEEKDAY_NAMES = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)

TRUE_STRINGS = {"true", "1", "yes", "on"}


# ------------------------------------------------------------------ dates ---


def _fmt(d: date) -> str:
    return f"{d.day} {d.strftime('%B %Y')}"


def _fmt_weekday(d: date) -> str:
    """Wednesday 4 November (the year is implied by the season)."""
    return f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"


def _join(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def parse_iso_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def season_days_by_kind(kind: str) -> dict[date, str | None]:
    """``season_days`` rows of one kind as {day: label}."""
    rows = query("SELECT day, label FROM season_days WHERE kind = %s ORDER BY day", (kind,))
    return {r["day"]: r["label"] for r in rows}


def date_problem(
    d: date,
    settings: Settings,
    closed_days: Mapping[date, str | None] | set[date] | None,
    today: date,
) -> str | None:
    """Why ``d`` cannot be booked, or None when it can."""
    season = settings["season"]
    start = parse_iso_date(season.start)
    end = parse_iso_date(season.end)
    if d <= today:
        return "Choose a date after today"
    if start and d < start:
        return f"The season opens on {_fmt(start)}"
    if end and d > end:
        return f"The season ends on {_fmt(end)}"
    closed_weekdays = [int(w) for w in (season.closed_weekdays or [])]
    if d.weekday() in closed_weekdays:
        names = [WEEKDAY_NAMES[w] + "s" for w in sorted(closed_weekdays) if 0 <= w <= 6]
        return f"We are closed on {_join(names)}." + _next_open_sentence(d, settings, closed_days, today)
    if closed_days and d in closed_days:
        label = closed_days.get(d) if isinstance(closed_days, Mapping) else None
        suffix = f" ({label})" if label else ""
        return f"The park is closed on {_fmt(d)}{suffix}." + _next_open_sentence(d, settings, closed_days, today)
    return None


def _next_open_sentence(
    d: date,
    settings: Settings,
    closed_days: Mapping[date, str | None] | set[date] | None,
    today: date,
) -> str:
    nxt = next_open_day_after(d, settings, closed_days, today)
    return f" The next open day is {_fmt_weekday(nxt)}." if nxt else ""


def next_open_day_after(
    d: date,
    settings: Settings,
    closed_days: Mapping[date, str | None] | set[date] | None = None,
    today: date | None = None,
    horizon: int = NEXT_OPEN_DAY_HORIZON,
) -> date | None:
    """The first bookable day after ``d`` (closed weekdays and closures skipped),
    or None when the season ends first."""
    today = today or get_today()
    if closed_days is None:
        closed_days = season_days_by_kind("closed")
    for i in range(1, horizon + 1):
        candidate = d + timedelta(days=i)
        if date_problem(candidate, settings, closed_days, today) is None:
            return candidate
    return None


# ------------------------------------------------------------- validation ---


def normalise_email(value: str) -> str | None:
    try:
        return validate_email(value, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        return None


def normalise_mobile(value: str, region: str = "ZA") -> str | None:
    """E.164 digits without the plus (``27821234567``) or None when invalid."""
    try:
        number = phonenumbers.parse(value, region)
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(number):
        return None
    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164).lstrip("+")


def _as_int(value: Any) -> int | None:
    """Accept ints and numeric strings; reject bools, floats with fractions, junk."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if isinstance(value, str):
        s = value.strip()
        if re.fullmatch(r"-?\d+", s):
            return int(s)
    return None


def _truthy(value: Any) -> bool:
    if value is True:
        return True
    if isinstance(value, str):
        return value.strip().lower() in TRUE_STRINGS
    return value == 1


def validate_request(
    payload: Mapping[str, Any] | None,
    settings: Settings,
    *,
    closed_days: Mapping[date, str | None] | set[date] | None = None,
    today: date | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Validate a form payload. Returns ``(clean, errors)``.

    ``clean`` is only complete when ``errors`` is empty. Dates come back as
    ISO strings (the shape the bookings API takes), mobiles as E.164 digits,
    the email lower-cased, and ``people_booked``/``enquiry_date`` are filled.
    ``closed_days`` and ``today`` are injectable for tests; by default the
    closed season days are read from the database and today is SAST.
    """
    data: Mapping[str, Any] = payload if isinstance(payload, Mapping) else {}
    today = today or get_today()
    if closed_days is None:
        closed_days = season_days_by_kind("closed")
    form = settings["form"]
    clean: dict[str, Any] = {}
    errors: dict[str, str] = {}

    def text(field: str, *, required: bool, max_len: int) -> str | None:
        raw = data.get(field)
        value = str(raw).strip() if raw is not None else ""
        if not value:
            clean[field] = None
            if required:
                errors[field] = "This field is required"
            return None
        if len(value) > max_len:
            errors[field] = f"Keep this under {max_len} characters"
            return None
        clean[field] = value
        return value

    text("group_name", required=True, max_len=MAX_TEXT)
    text("area", required=False, max_len=MAX_TEXT)
    text("contact_name", required=True, max_len=MAX_TEXT)
    text("customer_notes", required=False, max_len=MAX_NOTES)

    # arrival time: one of the configured slots (no free text to normalise)
    slots = [str(x) for x in (form.get("arrival_slots") or DEFAULT_ARRIVAL_SLOTS)]
    arrival = text("arrival_time", required=False, max_len=MAX_ARRIVAL_TIME)
    if arrival is not None and slots and arrival not in slots:
        errors["arrival_time"] = "Choose an arrival time from the list"

    # group type: must be a configured code
    codes = {str(g.get("code")) for g in (form.group_types or []) if isinstance(g, Mapping)}
    group_type = text("group_type", required=True, max_len=32)
    if group_type is not None and group_type not in codes:
        errors["group_type"] = "Choose a group type from the list"

    email_raw = text("contact_email", required=True, max_len=MAX_TEXT)
    if email_raw is not None:
        normalised = normalise_email(email_raw)
        if normalised is None:
            errors["contact_email"] = "Enter a valid email address"
        else:
            clean["contact_email"] = normalised

    mobile_raw = text("contact_mobile", required=True, max_len=40)
    if mobile_raw is not None:
        mobile = normalise_mobile(mobile_raw)
        if mobile is None:
            errors["contact_mobile"] = "Enter a valid mobile number, e.g. 082 123 4567"
        else:
            clean["contact_mobile"] = mobile

    # dates
    visit_raw = data.get("visit_date")
    visit = parse_iso_date(visit_raw) if visit_raw not in (None, "") else None
    if visit is None:
        errors["visit_date"] = (
            "This field is required" if visit_raw in (None, "") else "Enter a date as YYYY-MM-DD"
        )
        clean["visit_date"] = None
    else:
        problem = date_problem(visit, settings, closed_days, today)
        if problem:
            errors["visit_date"] = problem
        clean["visit_date"] = visit.isoformat()

    alt_raw = data.get("alternative_date")
    clean["alternative_date"] = None
    if alt_raw not in (None, ""):
        alt = parse_iso_date(alt_raw)
        if alt is None:
            errors["alternative_date"] = "Enter a date as YYYY-MM-DD"
        else:
            problem = date_problem(alt, settings, closed_days, today)
            if problem:
                errors["alternative_date"] = problem
            elif visit is not None and alt == visit:
                errors["alternative_date"] = "Choose a different date from your first choice"
            clean["alternative_date"] = alt.isoformat()

    # counts
    def count(field: str, *, default: int | None) -> int | None:
        raw = data.get(field)
        if raw in (None, ""):
            if default is None:
                errors[field] = "This field is required"
                return None
            clean[field] = default
            return default
        value = _as_int(raw)
        if value is None:
            errors[field] = "Enter a whole number"
            return None
        if value < 0:
            errors[field] = "Must be 0 or more"
            return None
        clean[field] = value
        return value

    # A booking counts visitors only. "visitors" is the field the form sends;
    # adults + children is accepted as a fallback for older clients.
    visitors = count("visitors", default=None) if data.get("visitors") not in (None, "") else None
    adults = count("adults", default=0)
    children = count("children", default=0)
    count("vehicles", default=0)
    gazebos = count("gazebos", default=0)
    if gazebos is not None and gazebos > MAX_GAZEBOS:
        errors["gazebos"] = f"We have {MAX_GAZEBOS} gazebos to hire"
    min_size = int(form.get("min_group_size") or 0)
    max_size = int(form.get("max_group_size") or DEFAULT_MAX_GROUP_SIZE)
    phone = str(settings["email"].get("phone") or "").strip()
    too_small = (
        f"Group bookings are for {min_size} or more people. "
        "For smaller groups, buy day tickets on Quicket."
    )
    too_big = f"For more than {max_size} people please phone us" + (f" on {phone}" if phone else "") + "."
    people: int | None = None
    if visitors is not None:
        people = visitors
        clean.pop("visitors", None)
    elif adults is not None and children is not None and data.get("visitors") in (None, ""):
        people = adults + children
    if people is not None:
        clean["people_booked"] = people
        if people < min_size:
            errors["visitors"] = too_small
        elif max_size and people > max_size:
            errors["visitors"] = too_big

    # questions
    max_q = int(form.get("max_questions") or 0)
    raw_q = data.get("questions")
    if raw_q in (None, ""):
        raw_q = []
    elif isinstance(raw_q, str):
        raw_q = [raw_q]
    questions: list[str] = []
    if not isinstance(raw_q, (list, tuple)):
        errors["questions"] = "Questions must be a list"
    else:
        for item in raw_q:
            q = str(item).strip() if item is not None else ""
            if not q:
                continue
            if len(q) > MAX_QUESTION:
                errors["questions"] = f"Keep each question under {MAX_QUESTION} characters"
                break
            questions.append(q)
        if "questions" not in errors and len(questions) > max_q:
            errors["questions"] = f"You can ask up to {max_q} questions"
    clean["questions"] = questions

    # policy + honeypot
    if not _truthy(data.get("policy_accepted")):
        errors["policy_accepted"] = "Agree to the booking terms to send your request"
    clean["policy_accepted"] = True
    if str(data.get("website") or "").strip():
        errors["website"] = "Leave this field empty"

    clean["enquiry_date"] = today.isoformat()
    return clean, errors


# -------------------------------------------------------------- turnstile ---


def verify_turnstile(token: str | None, remote_ip: str | None) -> bool:
    """Server-side Turnstile check. Always True when no secret is configured.

    Network trouble fails closed: the honeypot and rate limit are not enough on
    their own, and a retry costs the visitor one click.
    """
    if not TURNSTILE_SECRET_KEY:
        return True
    if not token:
        return False
    try:
        response = requests.post(
            TURNSTILE_VERIFY_URL,
            data={"secret": TURNSTILE_SECRET_KEY, "response": token, "remoteip": remote_ip or ""},
            timeout=TURNSTILE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        body = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning(f"Turnstile verification failed to complete: {type(exc).__name__}: {exc}")
        return False
    if not body.get("success"):
        logger.info(f"Turnstile rejected a token: {body.get('error-codes')}")
        return False
    return True


# ------------------------------------------------------------- rate limit ---


def rate_limited(ip: str | None) -> bool:
    if not ip:
        return False
    row = query_one(
        """
        SELECT COUNT(*) AS n FROM form_submissions
        WHERE ip = %s AND created_at >= NOW() - INTERVAL 1 HOUR
        """,
        (ip[:64],),
    )
    return bool(row and int(row["n"]) >= RATE_LIMIT_PER_HOUR)


def record_submission(
    booking_id: int | None,
    payload: Mapping[str, Any] | None,
    ip: str | None,
    user_agent: str | None,
    turnstile_ok: bool,
) -> int:
    stored = {k: v for k, v in (payload or {}).items() if k not in _PAYLOAD_DROP}
    return execute(
        """
        INSERT INTO form_submissions (booking_id, payload, ip, user_agent, turnstile_ok)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (
            booking_id,
            dumps(stored),
            (ip or "")[:64] or None,
            (user_agent or "")[:255] or None,
            int(bool(turnstile_ok)),
        ),
    )


# ---------------------------------------------------------- receipt token ---


def _receipt_secret() -> str | None:
    return IMAGE_TOKEN_SECRET or SECRET_KEY or None


def request_receipt_token(booking_id: int, ttl_days: int = RECEIPT_TTL_DAYS) -> str | None:
    """A signed token for ``GET /public/requests/<id>`` (the confirmation page).

    Same pattern as ``TokenService.generate_ticket_image_token``: HS256, a
    purpose claim and an expiry. None when no secret is configured.
    """
    secret = _receipt_secret()
    if not secret:
        return None
    now = datetime.now(timezone.utc)
    payload = {
        "booking_id": int(booking_id),
        "purpose": RECEIPT_PURPOSE,
        "iat": now,
        "exp": now + timedelta(days=ttl_days),
    }
    token = jwt.encode(payload, secret, algorithm="HS256")
    return token.decode() if isinstance(token, bytes) else token


def verify_request_receipt_token(token: str | None, booking_id: int) -> tuple[bool, str]:
    """``(ok, error)`` where error ∈ config | missing | expired | invalid | purpose | mismatch."""
    secret = _receipt_secret()
    if not secret:
        return False, "config"
    if not token:
        return False, "missing"
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return False, "expired"
    except jwt.InvalidTokenError:
        return False, "invalid"
    if payload.get("purpose") != RECEIPT_PURPOSE:
        return False, "purpose"
    if int(payload.get("booking_id") or 0) != int(booking_id):
        return False, "mismatch"
    return True, ""


def acknowledgement_sent(booking_id: int) -> bool:
    row = query_one(
        """
        SELECT 1 AS x FROM email_messages
        WHERE booking_id = %s AND direction = 'outbound' AND kind = 'acknowledgement'
          AND COALESCE(send_status, 'sent') = 'sent'
        LIMIT 1
        """,
        (booking_id,),
    )
    return row is not None


def public_summary(booking: Mapping[str, Any]) -> dict[str, Any]:
    """What the confirmation page may show: no phone, no prices, no notes."""
    visit = booking.get("visit_date")
    created = booking.get("created_at")
    return {
        "id": int(booking["id"]),
        "reference": booking.get("reference"),
        "group_name": booking.get("group_name"),
        "visit_date": visit.isoformat() if hasattr(visit, "isoformat") else (str(visit)[:10] if visit else None),
        "contact_email": booking.get("contact_email"),
        "visitors": int(booking.get("people_booked") or 0),
        "acknowledged": acknowledgement_sent(int(booking["id"])),
        "submitted_at": created.isoformat(timespec="seconds") if hasattr(created, "isoformat") else None,
    }


def send_acknowledgement_if_enabled(booking: Mapping[str, Any], settings: Settings | None = None) -> dict | None:
    """Email the acknowledgement when ``settings.form.acknowledgement_enabled``.

    The one deliberate exception to "nothing sends automatically", and off by
    default. Sent through ``mail_send.send_email`` (lazy import), so the dev
    recipient rewrite applies and the send is recorded as an outbound
    ``email_messages`` row plus a booking event. A failure is logged, never
    raised: the request has already been saved.
    """
    settings = settings or get_settings()
    if not bool(settings["form"].get("acknowledgement_enabled")):
        return None
    to = booking.get("contact_email")
    if not to:
        return None
    try:
        from config.settings import BOOKING_FORM_URL
        from src.services import mail_send
        from src.services.email_templates import render_email

        rendered = render_email(
            "acknowledgement", dict(booking), settings, form_url=BOOKING_FORM_URL, logo_url=mail_send.logo_url()
        )
        result = mail_send.send_email(
            to=[str(to)],
            rendered=rendered,
            booking_id=int(booking["id"]),
            kind="acknowledgement",
            actor=None,
        )
    except Exception as exc:  # noqa: BLE001 - the enquiry is saved; the send is best effort
        logger.error(f"Acknowledgement for booking {booking.get('reference')} not sent: {type(exc).__name__}: {exc}")
        return None
    status = (result or {}).get("send_status") if isinstance(result, Mapping) else None
    logger.info(f"Acknowledgement for booking {booking.get('reference')}: {status or 'sent'}")
    return dict(result) if isinstance(result, Mapping) else {"send_status": "sent"}


# -------------------------------------------------- bookings service bridge ---


def _booking_service():
    try:
        from src.services import booking as booking_service  # noqa: WPS433 (lazy by design)
    except ModuleNotFoundError as exc:
        if exc.name in ("src.services.booking", "src.services.pricing"):
            return None
        raise
    return booking_service


def create_booking_compat(
    data: dict[str, Any], source: str, actor: int | None, doc_number: int | None = None
) -> dict:
    """``booking.create_booking`` when available, else a plain row insert.

    ``data["questions"]`` (list of str) is stored with the booking on both paths.
    """
    service = _booking_service()
    if service is not None and hasattr(service, "create_booking"):
        booking = service.create_booking(data, source=source, actor=actor, doc_number=doc_number)
        return dict(booking) if isinstance(booking, Mapping) else _row(int(booking["id"]))
    logger.warning("src.services.booking not available; using the fallback insert")
    return _fallback_create_booking(data, source, actor, doc_number)


def add_question_compat(booking_id: int, question: str, actor: int | None = None) -> int:
    service = _booking_service()
    if service is not None and hasattr(service, "add_question"):
        result = service.add_question(booking_id, question, actor)
        return int(result["id"]) if isinstance(result, Mapping) else int(result or 0)
    row = query_one(
        "SELECT COALESCE(MAX(sort_order), 0) AS n FROM booking_questions WHERE booking_id = %s",
        (booking_id,),
    )
    return execute(
        "INSERT INTO booking_questions (booking_id, question, sort_order) VALUES (%s, %s, %s)",
        (booking_id, question, int(row["n"]) + 1 if row else 1),
    )


def record_payment_compat(
    booking_id: int,
    kind: str,
    amount: Decimal,
    paid_on: date,
    reference: str | None,
    note: str | None,
    actor: int | None,
) -> dict:
    service = _booking_service()
    if service is not None and hasattr(service, "record_payment"):
        payment = service.record_payment(booking_id, kind, amount, paid_on, reference, note, actor)
        return dict(payment) if isinstance(payment, Mapping) else {"id": payment}
    return _fallback_record_payment(booking_id, kind, amount, paid_on, reference, note, actor)


def _row(booking_id: int) -> dict:
    row = query_one("SELECT * FROM bookings WHERE id = %s", (booking_id,))
    if row is None:
        raise LookupError(f"Booking {booking_id} vanished")
    return row


def booking_row(booking_id: int) -> dict | None:
    return query_one("SELECT * FROM bookings WHERE id = %s", (booking_id,))


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _fallback_price(data: Mapping[str, Any], visit: date, settings: Settings) -> tuple[Decimal, str | None]:
    """Approximate the pricing service: tier by group type and weekday/weekend.

    Public holidays are not considered here (that is the pricing service's job);
    the fallback exists so a row can be written at all.
    """
    pricing = settings["pricing"]
    peak = season_days_by_kind("peak")
    if visit in peak:
        return _money(pricing.peak_price), "peak"
    season = settings["season"]
    try:
        nd_start = tuple(int(x) for x in str(season.no_discount_start).split("-"))
        nd_end = tuple(int(x) for x in str(season.no_discount_end).split("-"))
        md = (visit.month, visit.day)
        in_window = (md >= nd_start or md <= nd_end) if nd_start > nd_end else nd_start <= md <= nd_end
    except (ValueError, AttributeError):
        in_window = False
    if in_window:
        return _money(pricing.public_weekend_price), "public_weekend"
    weekend = visit.weekday() >= 5
    tier_code = None
    for g in settings["form"].group_types or []:
        if isinstance(g, Mapping) and g.get("code") == data.get("group_type"):
            tier_code = g.get("weekend_tier" if weekend else "weekday_tier")
            break
    if tier_code:
        tier = query_one("SELECT price FROM price_tiers WHERE code = %s AND is_active = 1", (tier_code,))
        if tier:
            return _money(tier["price"]), str(tier_code)
    return _money(pricing.public_weekend_price), "public_weekend"


def _fallback_deposit(people: int, price: Decimal, settings: Settings) -> Decimal:
    dep = settings["deposit"]
    total = _money(people * price)
    by_min = _money(int(dep.min_people) * price)
    by_pct = _money(int(Decimal(people * int(dep.percent)) / 100 + Decimal("0.5")) * price)
    return min(max(by_min, by_pct), total) if total > 0 else Decimal("0.00")


def _fallback_create_booking(
    data: dict[str, Any], source: str, actor: int | None, doc_number: int | None = None
) -> dict:
    settings = get_settings()
    visit = parse_iso_date(data.get("visit_date"))
    if visit is None:
        raise ValueError("visit_date is required")
    people = int(data.get("people_booked") or (int(data.get("adults") or 0) + int(data.get("children") or 0)))
    if data.get("price_per_person") not in (None, ""):
        price = _money(data["price_per_person"])
        tier_code = data.get("price_tier_code")
    else:
        price, tier_code = _fallback_price(data, visit, settings)
    waived = int(bool(data.get("deposit_waived")))
    deposit = Decimal("0.00") if waived else _fallback_deposit(people, price, settings)
    if doc_number is None:
        doc_number = next_document_number()
    reference = f"{settings["documents"].proforma_prefix}{doc_number}"
    hold = visit - timedelta(days=int(settings["reminders"].lapse_days_before))
    enquiry = parse_iso_date(data.get("enquiry_date")) or get_today()

    barcode = generate_barcode()
    for _ in range(5):
        if query_one("SELECT 1 FROM bookings WHERE barcode = %s", (barcode,)) is None:
            break
        barcode = generate_barcode()

    legacy = data.get("legacy_sheet_row")
    with transaction() as conn:
        booking_id = execute(
            """
            INSERT INTO bookings
                (reference, doc_number, status, group_name, group_type, area, contact_name,
                 contact_email, contact_mobile, visit_date, alternative_date, arrival_time,
                 adults, children, people_booked, vehicles, gazebos, price_tier_code,
                 price_per_person, price_overridden, price_override_reason, deposit_due,
                 deposit_waived, barcode, source, enquiry_date, hold_expires_on,
                 customer_notes, internal_notes, legacy_sheet_row, created_by)
            VALUES (%s, %s, 'enquiry', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                reference,
                doc_number,
                data.get("group_name"),
                data.get("group_type"),
                data.get("area"),
                data.get("contact_name") or data.get("group_name"),
                data.get("contact_email"),
                data.get("contact_mobile"),
                visit,
                parse_iso_date(data.get("alternative_date")),
                data.get("arrival_time"),
                int(data.get("adults") or 0),
                int(data.get("children") or 0),
                people,
                int(data.get("vehicles") or 0),
                int(data.get("gazebos") or 0),
                tier_code,
                price,
                int(bool(data.get("price_overridden"))),
                data.get("price_override_reason"),
                deposit,
                waived,
                barcode,
                source,
                enquiry,
                hold,
                data.get("customer_notes"),
                data.get("internal_notes"),
                dumps(legacy) if legacy is not None else None,
                actor,
            ),
            conn=conn,
        )
        execute(
            """
            INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id)
            VALUES (%s, 'created', %s, %s, %s)
            """,
            (booking_id, f"Booking {reference} created from {source}", dumps({"source": source}), actor),
            conn=conn,
        )
        questions = data.get("questions") or []
        for i, question in enumerate([str(q).strip() for q in questions if str(q).strip()], start=1):
            execute(
                "INSERT INTO booking_questions (booking_id, question, sort_order) VALUES (%s, %s, %s)",
                (booking_id, question, i),
                conn=conn,
            )
    return _row(booking_id)


def _fallback_record_payment(
    booking_id: int,
    kind: str,
    amount: Decimal,
    paid_on: date,
    reference: str | None,
    note: str | None,
    actor: int | None,
) -> dict:
    amount = _money(amount)
    with transaction() as conn:
        payment_id = execute(
            """
            INSERT INTO payments (booking_id, kind, amount, paid_on, reference, note, recorded_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (booking_id, kind, amount, paid_on, reference, note, actor),
            conn=conn,
        )
        execute(
            """
            INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id)
            VALUES (%s, 'payment_recorded', %s, %s, %s)
            """,
            (
                booking_id,
                f"Payment of R{amount:,.2f} recorded ({kind})",
                dumps({"payment_id": payment_id, "amount": amount, "kind": kind, "paid_on": paid_on}),
                actor,
            ),
            conn=conn,
        )
        booking = query_one(
            """
            SELECT b.status, b.deposit_due, b.deposit_waived,
                   (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.booking_id = b.id) AS paid_total
            FROM bookings b WHERE b.id = %s
            """,
            (booking_id,),
            conn=conn,
        )
        if booking and booking["status"] in ("enquiry", "proforma_sent"):
            covered = booking["deposit_waived"] or Decimal(booking["paid_total"]) >= Decimal(booking["deposit_due"])
            if covered:
                execute(
                    "UPDATE bookings SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, NOW()) WHERE id = %s",
                    (booking_id,),
                    conn=conn,
                )
                execute(
                    """
                    INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id)
                    VALUES (%s, 'status_changed', 'Confirmed: deposit covered', %s, %s)
                    """,
                    (booking_id, dumps({"from": booking["status"], "to": "confirmed"}), actor),
                    conn=conn,
                )
    row = query_one("SELECT * FROM payments WHERE id = %s", (payment_id,))
    return serialize_row(row) or {"id": payment_id}


__all__ = [
    "validate_request",
    "date_problem",
    "next_open_day_after",
    "request_receipt_token",
    "verify_request_receipt_token",
    "public_summary",
    "acknowledgement_sent",
    "send_acknowledgement_if_enabled",
    "normalise_email",
    "normalise_mobile",
    "parse_iso_date",
    "season_days_by_kind",
    "verify_turnstile",
    "rate_limited",
    "record_submission",
    "create_booking_compat",
    "add_question_compat",
    "record_payment_compat",
]
