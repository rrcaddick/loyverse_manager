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
MAX_NOTES = 2000
MAX_QUESTION = 500
DEFAULT_MAX_GROUP_SIZE = 900
# How far ahead to look for the next open day in a closed-day error.
NEXT_OPEN_DAY_HORIZON = 60

# The signed receipt that lets the confirmation page survive a refresh.
RECEIPT_PURPOSE = "request_receipt"
RECEIPT_TTL_DAYS = 7
COMPLETE_TTL_DAYS = 30  # a saved request waits for the customer to finish the form
COMPLETE_PURPOSE = "request-complete"

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
    # No weekday is closed to groups (31 Oct 2026); only explicit closures are.
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
    """The first bookable day after ``d`` (closures skipped), or None when the
    season ends first."""
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
    text("area", required=True, max_len=MAX_TEXT)  # the area tells same-named churches apart (2 Nov 2026)
    text("contact_name", required=True, max_len=MAX_TEXT)
    text("customer_notes", required=False, max_len=MAX_NOTES)
    text("previous_visit_name", required=False, max_len=MAX_TEXT)  # older clients; the did-you-mean pick replaced it (3 Nov 2026)

    # The customer's own answer to "which group are you?": a pick from the
    # suggestions (group_id) or "none of these" (group_choice = none).
    gid_raw = data.get("group_id")
    clean["group_id"] = None
    if gid_raw not in (None, "", 0, "0"):
        gid = _as_int(gid_raw)
        if gid is None or gid < 1 or query_one("SELECT 1 AS x FROM booking_groups WHERE id = %s", (gid,)) is None:
            errors["group_name"] = "Choose the group from the list again"
        else:
            clean["group_id"] = gid
    choice = str(data.get("group_choice") or "").strip().lower()
    clean["group_choice"] = choice if choice in ("picked", "none") else None

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


def request_complete_token(booking_id: int, ttl_days: int = COMPLETE_TTL_DAYS) -> str | None:
    """A signed token for the form link on a saved request (2 Nov 2026): the
    form opens with what we have and the answers complete that request."""
    secret = _receipt_secret()
    if not secret:
        return None
    now = datetime.now(timezone.utc)
    payload = {"booking_id": int(booking_id), "purpose": COMPLETE_PURPOSE, "iat": now, "exp": now + timedelta(days=ttl_days)}
    token = jwt.encode(payload, secret, algorithm="HS256")
    return token.decode() if isinstance(token, bytes) else token


def booking_id_from_complete_token(token: str | None) -> int | None:
    """The request a completion token belongs to, or None when it is not valid."""
    secret = _receipt_secret()
    if not secret or not token:
        return None
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"])
    except Exception:  # noqa: BLE001 - expired, tampered, wrong secret
        return None
    if claims.get("purpose") != COMPLETE_PURPOSE:
        return None
    try:
        return int(claims["booking_id"])
    except (KeyError, TypeError, ValueError):
        return None


def prefill_for_request(booking: dict) -> dict:
    """What the public form shows already filled for a saved request."""
    questions = []
    try:
        from src.models import booking_question

        questions = [q["question"] for q in booking_question.list_for_booking(int(booking["id"])) if q.get("question")]
    except Exception:  # noqa: BLE001
        questions = []
    return {
        "reference": booking.get("reference"),
        "group_name": booking.get("group_name") or "",
        "group_type": booking.get("group_type") or "",
        "area": booking.get("area") or "",
        "contact_name": booking.get("contact_name") or "",
        "contact_email": booking.get("contact_email") or "",
        "contact_mobile": booking.get("contact_mobile") or "",
        "visit_date": booking["visit_date"].isoformat() if booking.get("visit_date") else "",
        "alternative_date": booking["alternative_date"].isoformat() if booking.get("alternative_date") else "",
        "visitors": int(booking.get("people_booked") or 0) or "",
        "customer_notes": booking.get("customer_notes") or "",
        "previous_visit_name": booking.get("previous_visit_name") or "",
        "questions": questions,
    }


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
    from src.services import booking as booking_service  # lazy: booking imports this module

    return booking_service


def create_booking_compat(
    data: dict[str, Any], source: str, actor: int | None, doc_number: int | None = None
) -> dict:
    """``booking.create_booking`` by its public-form name (the fallback insert
    from the parallel build is gone; ``data["questions"]`` is stored with it)."""
    booking = _booking_service().create_booking(data, source=source, actor=actor, doc_number=doc_number)
    return dict(booking) if isinstance(booking, Mapping) else _row(int(booking["id"]))


def add_question_compat(booking_id: int, question: str, actor: int | None = None) -> int:
    result = _booking_service().add_question(booking_id, question, actor)
    return int(result["id"]) if isinstance(result, Mapping) else int(result or 0)


def record_payment_compat(
    booking_id: int,
    kind: str,
    amount: Decimal,
    paid_on: date,
    reference: str | None,
    note: str | None,
    actor: int | None,
) -> dict:
    payment = _booking_service().record_payment(booking_id, kind, amount, paid_on, reference, note, actor)
    return dict(payment) if isinstance(payment, Mapping) else {"id": payment}


def _row(booking_id: int) -> dict:
    row = query_one("SELECT * FROM bookings WHERE id = %s", (booking_id,))
    if row is None:
        raise LookupError(f"Booking {booking_id} vanished")
    return row


def booking_row(booking_id: int) -> dict | None:
    return query_one("SELECT * FROM bookings WHERE id = %s", (booking_id,))




# ------------------------------------------------------------ did you mean ---

SUGGEST_MIN_CHARS = 3
SUGGEST_LIMIT = 6
# Groups booked under a person's name never appear on the public list.
PRIVATE_GROUP_TYPES = ("family",)
PRIVATE_NAME_RE = re.compile(r"\b(family|familie|birthday|party|friends|vriende)\b", re.I)


def _public_group(row: Mapping[str, Any]) -> bool:
    if (row.get("group_type") or "") in PRIVATE_GROUP_TYPES:
        return False
    return not PRIVATE_NAME_RE.search(str(row.get("name") or ""))


def _group_item(row: Mapping[str, Any]) -> dict:
    return {"id": int(row["id"]), "name": row["name"], "area": row.get("area"), "group_type": row.get("group_type")}


def suggest_groups(q: str | None, email: str | None, mobile: str | None) -> dict:
    """``mine``: the groups this address or number has booked for ("Did you
    mean"); ``matches``: organisations whose spelling starts with the typed
    word (three letters on). Names and areas only, never a contact."""
    from src.services import matching as mt

    mine: list[dict] = []
    seen: set[int] = set()
    e = normalise_email(email or "") if email else None
    m = mt.normalise_za_mobile(mobile) if mobile else None
    if e or m:
        rows = query(
            """
            SELECT DISTINCT g.id, g.name, g.area, g.group_type, MAX(b.visit_date) AS last_visit
            FROM booking_groups g
            JOIN bookings b ON b.group_id = g.id
            LEFT JOIN booking_contacts c ON c.booking_id = b.id
            WHERE (%s IS NOT NULL AND (LOWER(b.contact_email) = %s OR c.email = %s))
               OR (%s IS NOT NULL AND (b.contact_mobile = %s OR c.mobile = %s))
            GROUP BY g.id, g.name, g.area, g.group_type
            ORDER BY last_visit DESC
            LIMIT %s
            """,
            (e, e, e, m, m, m, SUGGEST_LIMIT),
        )
        for r in rows:
            if _public_group(r) and int(r["id"]) not in seen:
                mine.append(_group_item(r))
                seen.add(int(r["id"]))
    matches: list[dict] = []
    text = (q or "").strip()
    if len(text) >= SUGGEST_MIN_CHARS:
        like_start = f"{text}%"
        like_word = f"% {text}%"
        rows = query(
            """
            SELECT g.id, g.name, g.area, g.group_type, MAX(b.visit_date) AS last_visit
            FROM booking_groups g
            LEFT JOIN bookings b ON b.group_id = g.id
            WHERE g.name LIKE %s OR g.name LIKE %s
               OR EXISTS (SELECT 1 FROM booking_group_aliases a WHERE a.group_id = g.id AND (a.name LIKE %s OR a.name LIKE %s))
            GROUP BY g.id, g.name, g.area, g.group_type
            ORDER BY last_visit DESC, g.name
            LIMIT %s
            """,
            (like_start, like_word, like_start, like_word, SUGGEST_LIMIT * 3),
        )
        for r in rows:
            if _public_group(r) and int(r["id"]) not in seen:
                matches.append(_group_item(r))
                seen.add(int(r["id"]))
            if len(matches) >= SUGGEST_LIMIT:
                break
    return {"mine": mine, "matches": matches}


_SUGGEST_HITS: dict[str, list[float]] = {}
SUGGEST_PER_MINUTE = 60


def suggest_rate_limited(ip: str | None, now: float | None = None) -> bool:
    """A small per-process limiter for the suggestion lookups (the form's
    submit limit does not see them): sixty a minute per address."""
    import time as _time

    if not ip:
        return False
    t = now if now is not None else _time.monotonic()
    hits = [h for h in _SUGGEST_HITS.get(ip, []) if t - h < 60]
    hits.append(t)
    _SUGGEST_HITS[ip] = hits
    if len(_SUGGEST_HITS) > 5000:  # never grow without bound
        _SUGGEST_HITS.clear()
        _SUGGEST_HITS[ip] = hits
    return len(hits) > SUGGEST_PER_MINUTE
