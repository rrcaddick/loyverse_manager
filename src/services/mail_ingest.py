"""Mailbox ingest: IMAP sync, MIME parsing, booking matching and suggestions.

    sync_mailbox()                      # incremental, called every minute by cron
    sync_mailbox(full=True, since=d)    # the import's first pass
    match_message(row)                  # (booking_id, method) or (None, None)
    suggest_bookings(row)               # up to 5 scored candidates
    link_current_threads(review_days)   # the import's "link current threads" pass

The IMAP side is read-only (see src/clients/gmail.py). Nothing here sends mail.

Matching order (docs/booking-system.md §7): reference > thread > email > phone.
"""

from __future__ import annotations

import difflib
import email
import email.policy
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

import html2text
import phonenumbers
from phonenumbers import PhoneNumberMatcher, PhoneNumberType

from config.settings import DATA_DIR, GMAIL_ADDRESS, GMAIL_IMPORT_SINCE
from src.clients.gmail import INBOX, SENT, GmailImap
from src.models import email_message as em
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("mail_ingest")

SAST = ZoneInfo("Africa/Johannesburg")

FOLDERS: dict[str, str] = {INBOX: "inbound", SENT: "outbound"}

REFERENCE_RE = re.compile(r"\b(FY|INV)[\s-]?(\d{3,5})\b", re.IGNORECASE)
AUTO_SENDER_RE = re.compile(
    r"(mailer-daemon|postmaster|noreply|no-reply|no_reply|donotreply|do-not-reply|notification"
    r"|messaging-service|newsletter|marketing|alert)",
    re.IGNORECASE,
)
FREE_MAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
    "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me",
    "mweb.co.za", "telkomsa.net", "vodamail.co.za", "webmail.co.za", "iafrica.com",
}

MAX_HTML_BYTES = 1_000_000
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
MIN_INLINE_IMAGE_BYTES = 10 * 1024
SNIPPET_CHARS = 200
SUBJECT_MAX = 500
PHONE_SCAN_CHARS = 20_000

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._ \-()]+")


# ================================================================ parsing ===


@dataclass
class ParsedAttachment:
    filename: str
    content_type: str
    payload: bytes
    inline: bool = False
    content_id: str | None = None

    @property
    def size(self) -> int:
        return len(self.payload)


@dataclass
class ParsedMessage:
    message_id: str | None
    in_reply_to: str | None
    references: str | None
    from_name: str | None
    from_email: str | None
    to: list[str]
    cc: list[str]
    subject: str
    date: datetime | None
    text: str
    html: str | None
    snippet: str
    attachments: list[ParsedAttachment] = field(default_factory=list)
    skipped_attachments: list[dict] = field(default_factory=list)
    headers: dict[str, str] = field(default_factory=dict)

    @property
    def participant_emails(self) -> set[str]:
        out = {e for e in (self.from_email, *self.to, *self.cc) if e}
        return {e.lower() for e in out}


def _header(msg: EmailMessage, name: str) -> str | None:
    """A decoded header as a plain string, tolerant of malformed encodings."""
    try:
        value = msg.get(name)
    except Exception:  # noqa: BLE001 - header parsing can blow up on junk
        value = None
    if value is None:
        raw = msg.get_all(name, failobj=None)
        if not raw:
            return None
        value = raw[0]
    try:
        text = str(value)
    except Exception:  # noqa: BLE001
        return None
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def _addresses(msg: EmailMessage, name: str) -> list[tuple[str, str]]:
    try:
        values = msg.get_all(name, [])
    except Exception:  # noqa: BLE001
        values = []
    pairs: list[tuple[str, str]] = []
    try:
        for realname, addr in getaddresses([str(v) for v in values]):
            addr = (addr or "").strip()
            if not addr or "@" not in addr:
                continue
            pairs.append((realname.strip().strip('"'), addr.lower()))
    except Exception:  # noqa: BLE001
        pass
    return pairs


def _part_text(part: Any) -> str:
    try:
        content = part.get_content()
        if isinstance(content, bytes):
            return content.decode("utf-8", "replace")
        return str(content)
    except Exception:  # noqa: BLE001 - unknown charset etc.
        decoded = part.get_payload(decode=True)
        payload = decoded if isinstance(decoded, bytes) else b""
        charset = (part.get_content_charset() or "utf-8").lower()
        for enc in (charset, "utf-8", "cp1252", "latin-1"):
            try:
                return payload.decode(enc)
            except (LookupError, UnicodeDecodeError):
                continue
        return payload.decode("utf-8", "replace")


def html_to_text(html: str) -> str:
    h = html2text.HTML2Text()
    h.body_width = 0
    h.ignore_images = True
    h.ignore_emphasis = True
    h.ignore_tables = False
    h.single_line_break = True
    try:
        text = h.handle(html)
    except Exception:  # noqa: BLE001
        text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


_STRIP_BLOCK_RE = re.compile(
    r"<(script|style|head|title|iframe|object|embed|noscript)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_STRIP_TAG_RE = re.compile(
    r"</?(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|option|html|body|!doctype)\b[^>]*>",
    re.IGNORECASE,
)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_EVENT_ATTR_RE = re.compile(r"""\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
_JS_URL_RE = re.compile(r"""(href|src|action)\s*=\s*(["']?)\s*javascript:[^"'>\s]*""", re.IGNORECASE)


def sanitize_html(html: str | None) -> str | None:
    """Drop scripts, styles, frames, forms and event handlers; keep inline formatting.

    The result is capped at MAX_HTML_BYTES. It is still untrusted content and the
    frontend should render it in a sandboxed iframe or with a CSP.
    """
    if not html:
        return None
    out = _COMMENT_RE.sub("", html)
    out = _STRIP_BLOCK_RE.sub("", out)
    out = _STRIP_TAG_RE.sub("", out)
    out = _EVENT_ATTR_RE.sub("", out)
    out = _JS_URL_RE.sub(r'\1=\2#', out)
    out = out.strip()
    if len(out.encode("utf-8")) > MAX_HTML_BYTES:
        out = out.encode("utf-8")[:MAX_HTML_BYTES].decode("utf-8", "ignore")
        out += "\n<p><em>[message truncated]</em></p>"
    return out or None


def make_snippet(text: str, limit: int = SNIPPET_CHARS) -> str:
    collapsed = re.sub(r"\s+", " ", text or "").strip()
    return collapsed[:limit]


def safe_filename(name: str | None, fallback: str = "attachment") -> str:
    base = (name or "").strip().replace("\\", "/").split("/")[-1]
    base = _SAFE_NAME_RE.sub("_", base).strip(" .")
    if not base:
        base = fallback
    if len(base) > 120:
        stem, dot, ext = base.rpartition(".")
        if dot and len(ext) <= 10:
            base = stem[: 120 - len(ext) - 1] + "." + ext
        else:
            base = base[:120]
    return base


def to_sast_naive(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(SAST).replace(tzinfo=None, microsecond=0)


def _parse_date(msg: EmailMessage, internaldate: datetime | None) -> datetime | None:
    raw = _header(msg, "Date")
    if raw:
        try:
            parsed = parsedate_to_datetime(raw)
            if parsed is not None:
                return to_sast_naive(parsed)
        except (TypeError, ValueError, IndexError):
            pass
    return to_sast_naive(internaldate)


def parse_message(raw: bytes, internaldate: datetime | None = None) -> ParsedMessage:
    """Parse an RFC822 message into the fields we store."""
    msg = email.message_from_bytes(raw, policy=email.policy.default)

    from_pairs = _addresses(msg, "From")
    from_name, from_email = (from_pairs[0] if from_pairs else (None, None))
    to = [a for _n, a in _addresses(msg, "To")]
    cc = [a for _n, a in _addresses(msg, "Cc")]
    subject = (_header(msg, "Subject") or "")[:SUBJECT_MAX]

    body_plain = body_html = None
    try:
        body_plain = msg.get_body(preferencelist=("plain",))
    except Exception:  # noqa: BLE001
        body_plain = None
    try:
        body_html = msg.get_body(preferencelist=("html",))
    except Exception:  # noqa: BLE001
        body_html = None

    text = _part_text(body_plain).strip() if body_plain is not None else ""
    html = sanitize_html(_part_text(body_html)) if body_html is not None else None
    if not text and html:
        text = html_to_text(html)

    attachments: list[ParsedAttachment] = []
    skipped: list[dict] = []
    seen_names: set[str] = set()
    body_parts = {id(p) for p in (body_plain, body_html) if p is not None}
    for part in msg.walk():
        if part.is_multipart() or id(part) in body_parts:
            continue
        ctype = part.get_content_type()
        disposition = part.get_content_disposition()
        filename = part.get_filename()
        content_id = (part.get("Content-ID") or "").strip("<> ") or None
        if ctype.startswith("text/") and disposition != "attachment" and not filename:
            continue  # the other half of an alternative body, or a stray text part
        if disposition is None and not filename and not content_id:
            continue
        try:
            decoded = part.get_payload(decode=True)
        except Exception:  # noqa: BLE001
            decoded = None
        payload = decoded if isinstance(decoded, bytes) else b""
        inline = disposition == "inline" or (disposition is None and content_id is not None)
        if inline and ctype.startswith("image/") and len(payload) < MIN_INLINE_IMAGE_BYTES:
            continue
        name = safe_filename(filename, fallback=f"part.{ctype.split('/')[-1][:8]}")
        if len(payload) > MAX_ATTACHMENT_BYTES:
            skipped.append({"filename": name, "size": len(payload), "reason": "too_large"})
            continue
        stem, dot, ext = name.rpartition(".")
        n = 2
        while name.lower() in seen_names:
            name = f"{stem}-{n}.{ext}" if dot else f"{name}-{n}"
            n += 1
        seen_names.add(name.lower())
        attachments.append(ParsedAttachment(name, ctype, payload, inline, content_id))

    headers = {}
    for name in (
        "Auto-Submitted", "Precedence", "List-Id", "List-Unsubscribe", "X-Autoreply",
        "X-Auto-Response-Suppress", "Return-Path", "X-Failed-Recipients",
    ):
        value = _header(msg, name)
        if value is not None:
            headers[name.lower()] = value

    return ParsedMessage(
        message_id=_header(msg, "Message-ID"),
        in_reply_to=_header(msg, "In-Reply-To"),
        references=_header(msg, "References"),
        from_name=from_name or None,
        from_email=from_email,
        to=to,
        cc=cc,
        subject=subject,
        date=_parse_date(msg, internaldate),
        text=text,
        html=html,
        snippet=make_snippet(text),
        attachments=attachments,
        skipped_attachments=skipped,
        headers=headers,
    )


# ====================================================== classification ===


def detect_auto_generated(
    headers: dict[str, str], from_email: str | None, folder: str, own_address: str | None = None
) -> bool:
    """Bulk, list, bounce and notification traffic, or our own address in INBOX."""
    h = {k.lower(): (v or "").strip() for k, v in headers.items()}
    auto = h.get("auto-submitted", "").lower()
    if auto and auto != "no":
        return True
    if h.get("precedence", "").lower() in ("bulk", "list", "junk"):
        return True
    if "list-id" in h or "list-unsubscribe" in h:
        return True
    if "x-failed-recipients" in h:
        return True
    sender = (from_email or "").lower()
    if sender and AUTO_SENDER_RE.search(sender.split("@")[0]):
        return True
    own = (own_address or GMAIL_ADDRESS or "").lower()
    if folder == INBOX and own and sender == own:
        return True
    return False


def find_references(*texts: str | None) -> list[int]:
    """Document numbers mentioned as FY1703 / INV 1703 / fy-1703, in order of appearance."""
    found: list[int] = []
    for text in texts:
        if not text:
            continue
        for m in REFERENCE_RE.finditer(text):
            number = int(m.group(2))
            if number not in found:
                found.append(number)
    return found


def extract_za_mobiles(text: str | None) -> set[str]:
    """ZA mobile numbers in ``text`` as E.164 digits without the plus (27XXXXXXXXX)."""
    if not text:
        return set()
    out: set[str] = set()
    try:
        for match in PhoneNumberMatcher(text[:PHONE_SCAN_CHARS], "ZA"):
            number = match.number
            if number.country_code != 27:
                continue
            if phonenumbers.number_type(number) not in (
                PhoneNumberType.MOBILE,
                PhoneNumberType.FIXED_LINE_OR_MOBILE,
            ):
                continue
            out.add(f"27{number.national_number}")
    except Exception:  # noqa: BLE001 - never let the matcher break ingest
        return out
    return out


def normalise_mobile(value: str | None) -> str | None:
    """'081 461 4246' / '+27 81 461 4246' / '27814614246' -> '27814614246'."""
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("0"):
        digits = "27" + digits[1:]
    if len(digits) == 12 and digits.startswith("270"):
        digits = "27" + digits[3:]
    if len(digits) == 11 and digits.startswith("27") and digits[2] in "678":
        return digits
    return None


# ============================================================= matching ===


def _booking_email_set(row: dict) -> set[str]:
    emails = {(row.get("from_email") or "").lower()}
    for col in ("to_emails", "cc_emails"):
        val = row.get(col)
        if isinstance(val, str):
            val = em.loads(val)
        for e in val or []:
            emails.add(str(e).lower())
    emails.discard("")
    own = (GMAIL_ADDRESS or "").lower()
    emails.discard(own)
    return emails


def match_message(row: dict) -> tuple[int | None, str | None]:
    """Find the booking a stored message belongs to.

    Order: (1) FY/INV reference in subject or body, (2) same Gmail thread as a
    linked message or a booking's primary thread, (3) a participant address
    equal to a booking's contact_email, (4) a ZA mobile in the body equal to a
    booking's contact_mobile. Returns (booking_id, method) or (None, None).
    """
    subject = row.get("subject") or ""
    body = row.get("body_text") or ""

    for number in find_references(subject, body):
        booking = em.booking_by_doc_number(number)
        if booking:
            return booking["id"], "reference"

    thrid = row.get("gmail_thrid")
    if thrid:
        booking = em.booking_by_thread(int(thrid))
        if booking:
            return booking["id"], "thread"

    if row.get("direction") == "outbound":
        candidates = sorted(_booking_email_set(row))
    else:
        candidates = [row["from_email"].lower()] if row.get("from_email") else []
    for address in candidates:
        booking = em.booking_by_contact_email(address)
        if booking:
            return booking["id"], "email"

    for digits in sorted(extract_za_mobiles(body)):
        booking = em.booking_by_contact_mobile(digits)
        if booking:
            return booking["id"], "phone"

    return None, None


def add_booking_event(
    booking_id: int, kind: str, summary: str, data: dict | None = None, actor: int | None = None
) -> None:
    """Write a booking_events row via the bookings service when it exists."""
    add_event: Any = None
    try:
        from src.services.booking import add_event  # type: ignore[import-not-found,no-redef]
    except Exception:  # noqa: BLE001 - module not built yet / import error
        pass
    try:
        if add_event is not None:
            add_event(booking_id, kind, summary, data=data, actor=actor)
        else:
            em.insert_booking_event(booking_id, kind, summary, data, actor)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Could not write booking event {kind} for booking {booking_id}: {exc}")


def _review_window_days() -> int:
    try:
        from src.services.settings import get_settings

        return int(get_settings().email.review_window_days)  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Falling back to a 14-day review window: {exc}")
        return 14


def _in_review_window(sent_at: datetime | None, window_days: int) -> bool:
    if sent_at is None:
        return True
    cutoff = datetime.combine(get_today() - timedelta(days=window_days), datetime.min.time())
    return sent_at >= cutoff


def apply_match(message_id: int, row: dict, window_days: int) -> tuple[int | None, str | None, bool]:
    """Run match_message on a stored row and persist the outcome.

    Returns (booking_id, method, pending) where pending says whether the row
    was flagged for review.
    """
    booking_id, method = match_message(row)
    if booking_id:
        em.update(message_id, booking_id=booking_id, match_method=method, review_status="none")
        if row.get("gmail_thrid"):
            em.set_booking_thread_if_null(booking_id, int(row["gmail_thrid"]))
        if row.get("direction") == "inbound" and not row.get("is_auto_generated"):
            add_booking_event(
                booking_id,
                "email_received",
                (row.get("subject") or "(no subject)")[:255],
                {
                    "email_message_id": message_id,
                    "from": row.get("from_email"),
                    "match_method": method,
                },
            )
        return booking_id, method, False

    pending = (
        row.get("direction") == "inbound"
        and not row.get("is_auto_generated")
        and (row.get("review_status") or "none") == "none"
        and _in_review_window(row.get("sent_at"), window_days)
    )
    if pending:
        em.update(message_id, review_status="pending")
    return None, None, bool(pending)


# ========================================================== suggestions ===


def _ratio(a: str | None, b: str | None) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _words(text: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{3,}", (text or "").lower()) if w not in _STOPWORDS}


_STOPWORDS = {
    "the", "and", "for", "booking", "group", "visit", "enquiry", "inquiry", "quote",
    "quotation", "farmyard", "park", "please", "request", "trip", "outing", "date",
    "with", "from", "our", "your", "day", "fwd", "re", "about",
}


def score_booking(row: dict, booking: dict, mobiles: set[str] | None = None) -> tuple[float, list[str]]:
    """Score how likely ``row`` belongs to ``booking``; returns (score, reasons)."""
    score = 0.0
    reasons: list[str] = []
    from_email = (row.get("from_email") or "").lower()
    contact_email = (booking.get("contact_email") or "").lower()
    if from_email and contact_email and from_email == contact_email:
        score += 0.8
        reasons.append("Sender is the booking contact email")
    elif from_email and contact_email:
        d1, d2 = from_email.rsplit("@", 1)[-1], contact_email.rsplit("@", 1)[-1]
        if d1 == d2 and d1 not in FREE_MAIL_DOMAINS:
            score += 0.35
            reasons.append(f"Same email domain ({d1})")

    from_name = row.get("from_name") or ""
    best_name, best_field = 0.0, ""
    for field_name in ("contact_name", "group_name"):
        r = _ratio(from_name, booking.get(field_name))
        if r > best_name:
            best_name, best_field = r, field_name
    if best_name >= 0.6:
        score += 0.6 * best_name
        reasons.append(f"Sender name resembles {best_field.replace('_', ' ')} '{booking.get(best_field)}'")

    subject_words = _words(row.get("subject"))
    group_words = _words(booking.get("group_name")) | _words(booking.get("contact_name"))
    if subject_words and group_words:
        overlap = subject_words & group_words
        if overlap:
            frac = len(overlap) / len(group_words)
            score += 0.5 * frac
            reasons.append("Subject mentions " + ", ".join(sorted(overlap)))

    if mobiles is None:
        mobiles = extract_za_mobiles(row.get("body_text"))
    mobile = booking.get("contact_mobile")
    if mobile and mobile in mobiles:
        score += 0.7
        reasons.append("Body contains the booking contact mobile")

    return round(min(score, 1.0), 2), reasons


def suggest_bookings(row: dict, limit: int = 5) -> list[dict]:
    """Likely bookings for an unmatched message, best first."""
    mobiles = extract_za_mobiles(row.get("body_text"))
    scored = []
    for booking in em.candidate_bookings():
        score, reasons = score_booking(row, booking, mobiles)
        if score >= 0.15:
            scored.append(
                {
                    "booking_id": booking["id"],
                    "reference": booking.get("reference"),
                    "group_name": booking.get("group_name"),
                    "contact_name": booking.get("contact_name"),
                    "visit_date": booking["visit_date"].isoformat()
                    if isinstance(booking.get("visit_date"), date)
                    else booking.get("visit_date"),
                    "status": booking.get("status"),
                    "score": score,
                    "reasons": reasons,
                }
            )
    scored.sort(key=lambda s: (-s["score"], s["visit_date"] or ""))
    return scored[:limit]


# ================================================================= sync ===


def attachments_dir(gmail_msgid: int | str) -> Path:
    return DATA_DIR / "attachments" / str(gmail_msgid)


def store_attachments(message_id: int, gmail_msgid: int | str, parsed: ParsedMessage) -> list[dict]:
    """Write attachments under DATA_DIR/attachments/<gmail_msgid>/ and record them."""
    if not parsed.attachments:
        return []
    folder = attachments_dir(gmail_msgid)
    folder.mkdir(parents=True, exist_ok=True)
    meta = []
    for att in parsed.attachments:
        path = folder / att.filename
        path.write_bytes(att.payload)
        rel = str(path.relative_to(DATA_DIR))
        em.add_attachment(message_id, att.filename, att.content_type, att.size, rel)
        meta.append({"filename": att.filename, "size": att.size, "content_type": att.content_type})
    return meta


def build_row(item: dict, parsed: ParsedMessage, folder: str) -> dict:
    """Turn a fetched+parsed message into an email_messages row dict."""
    direction = FOLDERS.get(folder, "inbound")
    is_auto = detect_auto_generated(parsed.headers, parsed.from_email, folder)
    own = (GMAIL_ADDRESS or "").lower()
    if folder == INBOX and own and (parsed.from_email or "") == own:
        direction = "outbound"  # a copy of something we sent that landed back in INBOX
    attachments_meta = [
        {"filename": a.filename, "size": a.size, "content_type": a.content_type}
        for a in parsed.attachments
    ] + [dict(s, skipped=True) for s in parsed.skipped_attachments]
    return {
        "gmail_msgid": item.get("gmail_msgid"),
        "gmail_thrid": item.get("gmail_thrid"),
        "gmail_uid": item.get("uid"),
        "folder": folder,
        "message_id_header": (parsed.message_id or None),
        "in_reply_to": (parsed.in_reply_to or None),
        "references_header": parsed.references,
        "direction": direction,
        "kind": None,
        "from_name": (parsed.from_name or None),
        "from_email": parsed.from_email,
        "to_emails": parsed.to,
        "cc_emails": parsed.cc,
        "subject": parsed.subject or None,
        "sent_at": parsed.date or to_sast_naive(item.get("internaldate")),
        "snippet": parsed.snippet or None,
        "body_text": parsed.text or None,
        "body_html": parsed.html,
        "has_attachments": bool(parsed.attachments),
        "booking_id": None,
        "match_method": None,
        "review_status": "none",
        "is_auto_generated": is_auto,
        "attachments_meta": attachments_meta or None,
    }


def _import_since(since: date | None) -> date:
    if since:
        return since
    try:
        return date.fromisoformat(GMAIL_IMPORT_SINCE)
    except (TypeError, ValueError):
        return get_today() - timedelta(days=120)


def _sync_folder(
    imap: GmailImap, folder: str, full: bool, since: date | None, window_days: int
) -> dict:
    stats: dict[str, Any] = {
        "folder": folder, "mode": "incremental", "fetched": 0, "inserted": 0, "updated": 0,
        "claimed": 0, "matched": 0, "pending": 0, "errors": 0, "attachments": 0,
    }
    uidvalidity = imap.select(folder, readonly=True)
    state = em.get_sync_state(folder)
    last_uid = int(state["last_uid"]) if state else 0
    reset = state is not None and state.get("uidvalidity") not in (None, uidvalidity)
    if full or state is None or reset:
        stats["mode"] = "full" if (full or state is None) else "uidvalidity_reset"
        if reset:
            logger.warning(f"{folder}: UIDVALIDITY changed, resyncing from {_import_since(since)}")
        uids = imap.search_since(_import_since(since))
        if not full and not reset and state is None:
            last_uid = 0
    else:
        uids = imap.search_above_uid(last_uid)
    stats["uidvalidity"] = uidvalidity
    stats["from_uid"] = last_uid
    stats["to_fetch"] = len(uids)

    max_uid = last_uid if stats["mode"] == "incremental" else 0
    for item in imap.fetch(uids):
        stats["fetched"] += 1
        uid = int(item["uid"])
        try:
            parsed = parse_message(item["raw"], item.get("internaldate"))
            row = build_row(item, parsed, folder)
            message_id, outcome = em.upsert_by_gmail_msgid(row)
            stats[outcome] += 1
            if outcome in ("inserted", "claimed") and parsed.attachments:
                if not em.list_attachments(message_id):
                    stats["attachments"] += len(store_attachments(message_id, item["gmail_msgid"], parsed))
                    if outcome == "claimed":
                        em.update(message_id, has_attachments=True)
            if outcome == "inserted":
                row["id"] = message_id
                booking_id, _method, pending = apply_match(message_id, row, window_days)
                stats["matched"] += int(bool(booking_id))
                stats["pending"] += int(pending)
        except Exception as exc:  # noqa: BLE001 - one bad message must not stall the folder
            stats["errors"] += 1
            logger.error(f"{folder} uid {uid}: {exc}", exc_info=True)
        max_uid = max(max_uid, uid)
        if stats["fetched"] % 50 == 0:
            em.set_sync_state(folder, uidvalidity, max_uid)
    em.set_sync_state(folder, uidvalidity, max(max_uid, last_uid if stats["mode"] == "incremental" else 0))
    stats["last_uid"] = max(max_uid, last_uid if stats["mode"] == "incremental" else 0)
    return stats


def match_unlinked(window_days: int | None = None, limit: int = 300) -> int:
    """Re-run matching for recent unmatched inbound mail (bookings created after
    the email arrived now get their mail). Returns the number newly linked."""
    window_days = window_days if window_days is not None else _review_window_days()
    cutoff = datetime.combine(get_today() - timedelta(days=window_days), datetime.min.time())
    rows = em.query(
        """
        SELECT id, gmail_thrid, direction, from_email, to_emails, cc_emails, subject, body_text,
               sent_at, is_auto_generated, review_status
        FROM email_messages
        WHERE booking_id IS NULL AND direction = 'inbound' AND is_auto_generated = 0
          AND review_status IN ('none', 'pending') AND sent_at >= %s
        ORDER BY sent_at DESC LIMIT %s
        """,
        (cutoff, limit),
    )
    linked = 0
    for row in rows:
        booking_id, _m, _p = apply_match(row["id"], row, window_days)
        linked += int(bool(booking_id))
    return linked


def sync_mailbox(full: bool = False, since: date | None = None) -> dict:
    """Pull new mail from INBOX and Sent Mail, store, match, flag for review.

    Incremental by UID per folder; a UIDVALIDITY change or ``full=True`` resyncs
    everything since ``since`` (default GMAIL_IMPORT_SINCE). Never raises for a
    single folder's failure: it is recorded in the summary and mail_sync_state.
    """
    started = time.monotonic()
    summary: dict[str, Any] = {
        "started_at": datetime.now().replace(microsecond=0).isoformat(),
        "mode": "full" if full else "incremental",
        "folders": {},
        "fetched": 0, "inserted": 0, "updated": 0, "claimed": 0, "matched": 0,
        "pending": 0, "errors": [],
    }
    window_days = _review_window_days()
    try:
        with GmailImap() as imap:
            for folder in FOLDERS:
                try:
                    stats = _sync_folder(imap, folder, full, since, window_days)
                except Exception as exc:  # noqa: BLE001
                    logger.error(f"Sync of {folder} failed: {exc}", exc_info=True)
                    summary["errors"].append(f"{folder}: {exc}")
                    state = em.get_sync_state(folder)
                    em.set_sync_state(
                        folder,
                        state.get("uidvalidity") if state else None,
                        state["last_uid"] if state else 0,
                        str(exc)[:2000],
                    )
                    continue
                summary["folders"][folder] = stats
                for key in ("fetched", "inserted", "updated", "claimed", "matched", "pending"):
                    summary[key] += stats[key]
                if stats["errors"]:
                    summary["errors"].append(f"{folder}: {stats['errors']} message(s) failed to parse")
    except Exception as exc:  # noqa: BLE001 - connection/login failure
        logger.error(f"Mailbox sync failed: {exc}", exc_info=True)
        summary["errors"].append(str(exc))
    try:
        summary["rematched"] = match_unlinked(window_days)
    except Exception as exc:  # noqa: BLE001
        summary["errors"].append(f"rematch: {exc}")
    summary["duration_s"] = round(time.monotonic() - started, 2)
    summary["ok"] = not summary["errors"]
    logger.info(
        f"Mail sync ({summary['mode']}): fetched={summary['fetched']} inserted={summary['inserted']} "
        f"matched={summary['matched']} pending={summary['pending']} errors={len(summary['errors'])}"
    )
    return summary


# ===================================================== import linking ===


def _message_features(row: dict) -> dict:
    emails = _booking_email_set(row)
    return {
        "id": row["id"],
        "thrid": int(row["gmail_thrid"]),
        "sent_at": row.get("sent_at"),
        "emails": emails,
        "mobiles": extract_za_mobiles((row.get("body_text") or "")[:5000]),
        "from_name": row.get("from_name") or "",
        "subject": row.get("subject") or "",
        "booking_id": row.get("booking_id"),
    }


def _fuzzy_hit(feature: dict, booking: dict, threshold: float = 0.85) -> bool:
    names = [booking.get("group_name"), booking.get("contact_name")]
    for candidate in (feature["from_name"], feature["subject"]):
        if not candidate:
            continue
        for name in names:
            if name and _ratio(candidate, name) >= threshold:
                return True
    return False


def plan_thread_links(bookings: Iterable[dict], messages: Iterable[dict]) -> list[dict]:
    """Pure planning for the import: which thread each current booking should own.

    For each booking, candidate messages share its contact email, contain its
    mobile, or fuzzy-match its names (ratio >= 0.85). The most recent candidate
    thread wins; a thread is given to one booking only (earliest visit first).
    """
    features = [_message_features(m) for m in messages if m.get("gmail_thrid")]
    taken: set[int] = set()
    plan: list[dict] = []
    for booking in sorted(bookings, key=lambda b: (b.get("visit_date") or date.max, b["id"])):
        contact_email = (booking.get("contact_email") or "").lower()
        mobile = booking.get("contact_mobile")
        by_thread: dict[int, dict] = {}
        for f in features:
            reasons = []
            if contact_email and contact_email in f["emails"]:
                reasons.append("email")
            if mobile and mobile in f["mobiles"]:
                reasons.append("mobile")
            if not reasons and _fuzzy_hit(f, booking):
                reasons.append("name")
            if not reasons:
                continue
            current = by_thread.get(f["thrid"])
            if current is None or (f["sent_at"] or datetime.min) > (current["latest"] or datetime.min):
                by_thread[f["thrid"]] = {
                    "latest": f["sent_at"],
                    "reasons": sorted(set(reasons) | set(current["reasons"] if current else [])),
                    "messages": (current["messages"] if current else 0) + 1,
                }
            else:
                current["messages"] += 1
                current["reasons"] = sorted(set(current["reasons"]) | set(reasons))
        ordered = sorted(by_thread.items(), key=lambda kv: kv[1]["latest"] or datetime.min, reverse=True)
        for thrid, info in ordered:
            if thrid in taken:
                continue
            taken.add(thrid)
            plan.append(
                {
                    "booking_id": booking["id"],
                    "reference": booking.get("reference"),
                    "group_name": booking.get("group_name"),
                    "gmail_thrid": thrid,
                    "latest": info["latest"],
                    "messages": info["messages"],
                    "reasons": info["reasons"],
                    "skipped_threads": len(ordered) - 1,
                }
            )
            break
    return plan


def link_current_threads(review_days: int = 14, dry_run: bool = False) -> dict:
    """The import's second pass: give each current booking its most recent thread,
    then flag recent unmatched inbound mail for review. Idempotent."""
    bookings = em.current_bookings()
    messages = em.messages_for_linking()
    plan = plan_thread_links(bookings, messages)
    linked_messages = 0
    if not dry_run:
        for entry in plan:
            linked_messages += em.link_thread(entry["gmail_thrid"], entry["booking_id"], "import")
            em.set_booking_thread(entry["booking_id"], entry["gmail_thrid"])
        pending = em.mark_pending_reviews(review_days)
    else:
        pending = None
    return {
        "bookings_considered": len(bookings),
        "messages_considered": len(messages),
        "threads_linked": len(plan),
        "messages_linked": linked_messages,
        "pending_flagged": pending,
        "dry_run": dry_run,
        "plan": [
            {**p, "latest": p["latest"].isoformat() if isinstance(p["latest"], datetime) else p["latest"]}
            for p in plan
        ],
    }
