"""Pull booking-form fields out of an enquiry email with Claude.

    fields = extract_booking_fields(message.body_text, subject=message.subject)

Returns ``{}`` when ANTHROPIC_API_KEY is unset and ``{"error": "..."}`` on any
failure; it never raises. The model is forced onto a JSON schema through
structured outputs (``output_config.format``), so a successful call always
yields exactly the keys below. Field names match the public booking form.
"""

from __future__ import annotations

import json
from typing import Any

from config.settings import ANTHROPIC_API_KEY
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("extraction")

MODEL = "claude-opus-5-5"
MAX_INPUT_CHARS = 6000
MAX_OUTPUT_TOKENS = 2048

GROUP_TYPES = ("school", "creche", "church", "nonprofit", "family", "corporate", "pensioners", "other")

FIELD_KEYS = (
    "group_name",
    "group_type",
    "area",
    "contact_name",
    "contact_email",
    "contact_mobile",
    "visit_date",
    "alternative_date",
    "adults",
    "children",
    "people_booked",
    "vehicles",
    "gazebos",
    "arrival_time",
    "questions",
    "notes",
)

_nullable_string = {"type": ["string", "null"]}
_nullable_int = {"type": ["integer", "null"]}

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "group_name": _nullable_string,
        "group_type": {"type": "string", "enum": [*GROUP_TYPES, "unknown"]},
        "area": _nullable_string,
        "contact_name": _nullable_string,
        "contact_email": _nullable_string,
        "contact_mobile": _nullable_string,
        "visit_date": _nullable_string,
        "alternative_date": _nullable_string,
        "adults": _nullable_int,
        "children": _nullable_int,
        "people_booked": _nullable_int,
        "vehicles": _nullable_int,
        "gazebos": _nullable_int,
        "arrival_time": _nullable_string,
        "questions": {"type": "array", "items": {"type": "string"}},
        "notes": _nullable_string,
    },
    "required": list(FIELD_KEYS),
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You extract group-booking details from emails sent to The Farmyard Park, a recreation park in Klapmuts, Western Cape, South Africa. Groups (schools, creches, churches, clubs, families, companies, pensioners) email to book a day visit.

Fill the JSON fields from the email only. Use null for anything not stated; never guess or invent. Rules:
- group_type: one of school, creche, church, nonprofit, family, corporate, pensioners, other; "unknown" if unclear.
- area: the town or suburb the group comes from.
- contact_email / contact_mobile: the customer's details as written (the signature usually has them).
- visit_date and alternative_date: ISO dates (YYYY-MM-DD). Today is {today}; resolve relative dates ("next Saturday", "the 14th") to the next such date on or after today. If only a month is given, leave the field null and mention it in notes.
- adults, children: counts if stated. people_booked: the total headcount if stated or clearly implied (adults + children); otherwise null.
- vehicles: buses/cars/taxis the group arrives in. gazebos: gazebos requested.
- arrival_time: as written, e.g. "09:30" or "around 10am".
- questions: each distinct question the customer asks, as a short self-contained sentence. Empty list if none.
- notes: anything else the booking team should know, in one or two sentences. Null if nothing.
Ignore quoted earlier messages and our own replies when they conflict with the customer's latest words."""


def _client():
    import anthropic

    return anthropic.Anthropic(api_key=ANTHROPIC_API_KEY, max_retries=2, timeout=60.0)


def _prepare_input(text: str, subject: str) -> str:
    body = (text or "").strip()
    if len(body) > MAX_INPUT_CHARS:
        body = body[:MAX_INPUT_CHARS] + "\n[truncated]"
    parts = []
    if subject:
        parts.append(f"Subject: {subject.strip()[:300]}")
    parts.append("Email:\n" + (body or "(empty body)"))
    return "\n\n".join(parts)


def _clean(data: dict) -> dict:
    out: dict[str, Any] = {}
    for key in FIELD_KEYS:
        value = data.get(key)
        if key == "questions":
            out[key] = [str(q).strip() for q in (value or []) if str(q).strip()]
        elif key in ("adults", "children", "people_booked", "vehicles", "gazebos"):
            try:
                out[key] = int(value) if value is not None else None
            except (TypeError, ValueError):
                out[key] = None
        elif key == "group_type":
            out[key] = value if value in GROUP_TYPES else None
        else:
            out[key] = str(value).strip() or None if value is not None else None
    return out


def _request(client, prompt: str, use_fallbacks: bool):
    kwargs: dict[str, Any] = dict(
        model=MODEL,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=SYSTEM_PROMPT.format(today=get_today().isoformat()),
        messages=[{"role": "user", "content": prompt}],
        output_config={
            "effort": "low",
            "format": {"type": "json_schema", "schema": SCHEMA},
        },
    )
    if use_fallbacks:
        # Server-side fallback onto another model if a safety classifier declines.
        return client.beta.messages.create(
            betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs
        )
    return client.messages.create(**kwargs)


def extract_booking_fields(text: str, subject: str = "") -> dict:
    """Extract form fields from an email body. Never raises."""
    if not ANTHROPIC_API_KEY:
        return {}
    if not (text or "").strip() and not (subject or "").strip():
        return {"error": "Nothing to extract"}
    try:
        import anthropic
    except ImportError:
        return {"error": "The anthropic package is not installed"}

    prompt = _prepare_input(text, subject)
    try:
        client = _client()
        try:
            response = _request(client, prompt, use_fallbacks=True)
        except anthropic.BadRequestError as exc:
            logger.warning(f"Extraction fallback request rejected, retrying plainly: {exc.message}")
            response = _request(client, prompt, use_fallbacks=False)
    except anthropic.AuthenticationError:
        return {"error": "Anthropic API key was rejected"}
    except anthropic.RateLimitError:
        return {"error": "Anthropic rate limit reached, try again shortly"}
    except anthropic.APIStatusError as exc:
        logger.error(f"Extraction API error {exc.status_code}: {exc.message}")
        return {"error": f"Anthropic API error ({exc.status_code})"}
    except anthropic.APIConnectionError as exc:
        logger.error(f"Extraction connection error: {exc}")
        return {"error": "Could not reach the Anthropic API"}
    except Exception as exc:  # noqa: BLE001 - never raise to the caller
        logger.error(f"Extraction failed: {exc}", exc_info=True)
        return {"error": f"Extraction failed: {exc}"}

    if response.stop_reason == "refusal":
        return {"error": "The model declined to process this email"}
    if response.stop_reason == "max_tokens":
        return {"error": "The extraction was cut off; the email may be too long"}
    text_block = next((b.text for b in response.content if getattr(b, "type", "") == "text"), None)
    if not text_block:
        return {"error": "The model returned no text"}
    try:
        data = json.loads(text_block)
    except ValueError:
        return {"error": "The model returned invalid JSON"}
    if not isinstance(data, dict):
        return {"error": "The model returned an unexpected shape"}
    return _clean(data)
