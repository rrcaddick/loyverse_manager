"""Waiting on us, decided per PERSON (docs/handoff/waiting-v3-contract.md).

A party is a booking (``b:<id>``: all its contacts, all its threads) or, for
a sender not attached to a booking, the sender address (``e:<address>``).
Copied recipients count as written to.

    build_snapshot()                    # one pass over threads + messages (3 queries); every
                                        # function below takes an optional ``snap`` so a request
                                        # builds it once. Nothing is cached across requests.
    party_key_for_thread(thread)        # "b:124" | "e:jen@example.com" | None
    party_addresses(key)                # booking: contact_email + every counterpart and inbound
                                        # sender of its threads; address party: the address
    last_handled(key)                   # max(latest outbound to any party address / on the
                                        # booking / in a party thread, latest done_at of its threads)
    unanswered_messages(key)            # inbound, not automated, newer than last_handled and than
                                        # the containing thread's done_at
    party_summary(key)                  # the contract's party item
    waiting_parties(q=None)             # parties with unanswered_count > 0, oldest first
    mark_done(key, actor) / reopen(key, actor)
    party_stream(key)                   # every thread of the party merged, ``unanswered`` marked

Thread ``status``/``done_at`` stay the storage of the manual mark; a new
inbound reopens a thread but keeps ``done_at`` (conversations.refresh_thread),
so "everything handled up to the mark" survives the reopen.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

from config.settings import GMAIL_ADDRESS
from src.models import email_message as em
from src.models import email_thread as et
from src.models.base import loads, query, serialize_row
from src.utils.logging import setup_logger

logger = setup_logger("waiting")

PARTY_KEY_RE = re.compile(r"^(b:\d+|e:[^\s/@]+@[^\s/@]+)$")

BOOKING_COLS = "id, reference, group_name, status, visit_date, contact_name, contact_email, email_thread_id"


class PartyNotFound(LookupError):
    """No booking / no thread behind the key. Maps to 404."""


class PartyError(ValueError):
    """Malformed key or an action that cannot apply. Maps to 422."""


# ------------------------------------------------------------------ helpers ---


def _own_address() -> str:
    return (GMAIL_ADDRESS or "").lower()


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = loads(value)
    return [str(v).strip().lower() for v in (value or []) if v]


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if value is None:
        return None
    return str(value)


def _later(a: datetime | None, b: datetime | None) -> datetime | None:
    if a is None:
        return b
    if b is None:
        return a
    return a if a >= b else b


def parse_party_key(key: str | None) -> tuple[str, Any]:
    """``"b:124"`` → ("b", 124); ``"e:Jen@Example.com"`` → ("e", "jen@example.com")."""
    text = (key or "").strip()
    if text.startswith("e:"):
        text = "e:" + text[2:].lower()
    if not PARTY_KEY_RE.match(text):
        raise PartyError("party_key must be b:<booking id> or e:<address>")
    kind, _, value = text.partition(":")
    return (kind, int(value)) if kind == "b" else (kind, value)


def normalise_party_key(key: str | None) -> str:
    kind, value = parse_party_key(key)
    return f"{kind}:{value}"


def party_key_for_thread(thread: dict | None, messages: Iterable[dict] | None = None) -> str | None:
    """The party a thread belongs to: its booking, else the newest linked
    message's booking, else its counterpart address."""
    if not thread:
        return None
    if thread.get("booking_id"):
        return f"b:{int(thread['booking_id'])}"
    for m in sorted(messages or [], key=lambda m: (m.get("sent_at") or datetime.min, m.get("id") or 0), reverse=True):
        if m.get("booking_id"):
            return f"b:{int(m['booking_id'])}"
    addr = (thread.get("counterpart_email") or "").strip().lower()
    return f"e:{addr}" if addr else None


# ----------------------------------------------------------------- snapshot ---


@dataclass
class Snapshot:
    threads: dict[int, dict] = field(default_factory=dict)
    messages_by_thread: dict[int, list[dict]] = field(default_factory=dict)
    thread_party: dict[int, str] = field(default_factory=dict)
    party_threads: dict[str, list[int]] = field(default_factory=dict)
    bookings: dict[int, dict] = field(default_factory=dict)
    addresses: dict[str, set[str]] = field(default_factory=dict)
    last_handled: dict[str, datetime | None] = field(default_factory=dict)
    unanswered: dict[str, list[dict]] = field(default_factory=dict)
    unanswered_by_thread: dict[int, int] = field(default_factory=dict)
    own_address: str = ""

    def unanswered_ids(self, key: str) -> set[int]:
        return {int(m["id"]) for m in self.unanswered.get(key, [])}

    def thread_rows(self, key: str) -> list[dict]:
        rows = [self.threads[t] for t in self.party_threads.get(key, []) if t in self.threads]
        rows.sort(key=lambda t: (t.get("last_message_at") or datetime.min, int(t["gmail_thrid"])))
        return rows


def _booking_rows(ids: Iterable[int]) -> dict[int, dict]:
    wanted = sorted({int(i) for i in ids})
    if not wanted:
        return {}
    marks = ",".join(["%s"] * len(wanted))
    return {int(r["id"]): r for r in query(f"SELECT {BOOKING_COLS} FROM bookings WHERE id IN ({marks})", wanted)}


def compute(threads: list[dict], messages: list[dict], bookings: dict[int, dict], own_address: str) -> Snapshot:
    """Pure: the party computation over plain rows (tests feed dicts)."""
    own = (own_address or "").lower()
    snap = Snapshot(own_address=own)
    by_thread: dict[int, list[dict]] = defaultdict(list)
    out_by_addr: dict[str, datetime] = {}
    out_by_booking: dict[int, datetime] = {}
    out_by_thrid: dict[int, datetime] = {}
    for m in messages:
        thrid = int(m["gmail_thrid"]) if m.get("gmail_thrid") else None
        if thrid:
            by_thread[thrid].append(m)
        if m.get("direction") != "outbound" or m.get("send_status") not in (None, "sent") or not m.get("sent_at"):
            continue
        at = m["sent_at"]
        for addr in _as_list(m.get("to_emails")) + _as_list(m.get("cc_emails")):
            if addr != own:
                out_by_addr[addr] = _later(out_by_addr.get(addr), at)
        if m.get("booking_id"):
            out_by_booking[int(m["booking_id"])] = _later(out_by_booking.get(int(m["booking_id"])), at)
        if thrid:
            out_by_thrid[thrid] = _later(out_by_thrid.get(thrid), at)
    for rows in by_thread.values():
        rows.sort(key=lambda m: (m.get("sent_at") or datetime.min, int(m.get("id") or 0)))
    snap.messages_by_thread = dict(by_thread)

    for t in threads:
        thrid = int(t["gmail_thrid"])
        snap.threads[thrid] = t
        key = party_key_for_thread(t, by_thread.get(thrid, []))
        if key is None:
            continue
        snap.thread_party[thrid] = key
        snap.party_threads.setdefault(key, []).append(thrid)
    snap.bookings = dict(bookings)

    for key, thrids in snap.party_threads.items():
        kind, value = parse_party_key(key)
        addresses: set[str] = set()
        if kind == "e":
            addresses.add(value)
        else:
            booking = bookings.get(int(value)) or {}
            if booking.get("contact_email"):
                addresses.add(str(booking["contact_email"]).strip().lower())
            for thrid in thrids:
                t = snap.threads[thrid]
                if t.get("counterpart_email"):
                    addresses.add(str(t["counterpart_email"]).strip().lower())
                for m in by_thread.get(thrid, []):
                    if m.get("direction") == "inbound" and not m.get("is_auto_generated") and m.get("from_email"):
                        addresses.add(str(m["from_email"]).strip().lower())
        addresses.discard(own)
        addresses.discard("")
        snap.addresses[key] = addresses

        handled: datetime | None = None
        for addr in addresses:
            handled = _later(handled, out_by_addr.get(addr))
        if kind == "b":
            handled = _later(handled, out_by_booking.get(int(value)))
        for thrid in thrids:
            handled = _later(handled, out_by_thrid.get(thrid))
            handled = _later(handled, snap.threads[thrid].get("done_at"))
        snap.last_handled[key] = handled

        pending: list[dict] = []
        for thrid in thrids:
            done_at = snap.threads[thrid].get("done_at")
            count = 0
            for m in by_thread.get(thrid, []):
                if m.get("direction") != "inbound" or m.get("is_auto_generated") or not m.get("sent_at"):
                    continue
                if (m.get("from_email") or "").lower() == own:
                    continue
                at = m["sent_at"]
                if handled is not None and at <= handled:
                    continue
                if done_at is not None and at <= done_at:
                    continue
                pending.append(m)
                count += 1
            snap.unanswered_by_thread[thrid] = count
        pending.sort(key=lambda m: (m["sent_at"], int(m["id"])))
        snap.unanswered[key] = pending
    return snap


def build_snapshot() -> Snapshot:
    """Load every thread and the light message rows, then ``compute``."""
    threads = et.all_rows()
    messages = em.messages_for_waiting()
    booking_ids = {int(t["booking_id"]) for t in threads if t.get("booking_id")}
    booking_ids |= {int(m["booking_id"]) for m in messages if m.get("booking_id")}
    return compute(threads, messages, _booking_rows(booking_ids), _own_address())


def _snap(snap: Snapshot | None) -> Snapshot:
    return snap if snap is not None else build_snapshot()


# ---------------------------------------------------------------- queries ---


def party_threads(party_key: str, snap: Snapshot | None = None) -> list[dict]:
    """Thread rows of the party, oldest activity first."""
    return _snap(snap).thread_rows(normalise_party_key(party_key))


def party_addresses(party_key: str, snap: Snapshot | None = None) -> set[str]:
    key = normalise_party_key(party_key)
    s = _snap(snap)
    if key in s.addresses:
        return set(s.addresses[key])
    kind, value = parse_party_key(key)
    if kind == "e":
        return {value}
    booking = s.bookings.get(int(value)) or em.booking_by_id(int(value))
    if booking is None:
        raise PartyNotFound(f"Booking {value} not found")
    out = {str(booking.get("contact_email") or "").strip().lower()}
    out.discard("")
    out.discard(s.own_address)
    return out


def last_handled(party_key: str, snap: Snapshot | None = None) -> datetime | None:
    return _snap(snap).last_handled.get(normalise_party_key(party_key))


def unanswered_messages(party_key: str, snap: Snapshot | None = None) -> list[dict]:
    """The unanswered inbound rows (light shape, oldest first)."""
    return list(_snap(snap).unanswered.get(normalise_party_key(party_key), []))


def unanswered_count_for_thread(gmail_thrid: int, snap: Snapshot | None = None) -> int:
    return int(_snap(snap).unanswered_by_thread.get(int(gmail_thrid), 0))


def _booking_for(key: str, snap: Snapshot) -> dict | None:
    kind, value = parse_party_key(key)
    if kind != "b":
        return None
    booking = snap.bookings.get(int(value))
    if booking is None:
        booking = em.booking_by_id(int(value))
        if booking is None:
            raise PartyNotFound(f"Booking {value} not found")
        snap.bookings[int(value)] = booking
    return booking


def booking_chip(booking: dict | None) -> dict | None:
    if not booking:
        return None
    b = serialize_row(booking) or {}
    return {
        "id": int(b["id"]),
        "reference": b.get("reference"),
        "group_name": b.get("group_name"),
        "status": b.get("status"),
        "visit_date": b.get("visit_date"),
        "contact_name": b.get("contact_name"),
    }


def party_summary(party_key: str, snap: Snapshot | None = None) -> dict:
    """The contract's party item. Works for a party that is not waiting
    (``unanswered_count`` 0) and for a booking without any thread yet."""
    s = _snap(snap)
    key = normalise_party_key(party_key)
    kind, value = parse_party_key(key)
    threads = s.thread_rows(key)
    booking = _booking_for(key, s)
    if kind == "e" and not threads:
        raise PartyNotFound(f"No conversation with {value}")
    newest = threads[-1] if threads else None
    if kind == "b":
        counterpart_email = (booking or {}).get("contact_email") or (newest or {}).get("counterpart_email")
        counterpart_name = (booking or {}).get("contact_name") or (newest or {}).get("counterpart_name")
    else:
        counterpart_email = value
        counterpart_name = next((t.get("counterpart_name") for t in reversed(threads) if t.get("counterpart_name")), None)
    pending = s.unanswered.get(key, [])
    return {
        "party_key": key,
        "booking": booking_chip(booking),
        "counterpart_name": counterpart_name or None,
        "counterpart_email": (counterpart_email or "").lower() or None,
        "unanswered_count": len(pending),
        "oldest_unanswered_at": _iso(pending[0]["sent_at"]) if pending else None,
        "last_message_at": _iso((newest or {}).get("last_message_at")),
        "last_snippet": (newest or {}).get("last_snippet"),
        "subject": (newest or {}).get("subject"),
        "thread_count": len(threads),
        "primary_thrid": str(int(newest["gmail_thrid"])) if newest else None,
        "has_attachments": any(bool(t.get("has_attachments")) for t in threads),
    }


def _matches_query(item: dict, q: str) -> bool:
    needle = q.strip().lower()
    if not needle:
        return True
    booking = item.get("booking") or {}
    haystack = [
        item.get("counterpart_name"), item.get("counterpart_email"), item.get("subject"),
        item.get("last_snippet"), booking.get("reference"), booking.get("group_name"),
    ]
    return any(needle in str(v).lower() for v in haystack if v)


def waiting_parties(q: str | None = None, snap: Snapshot | None = None) -> list[dict]:
    """Every party with unanswered_count > 0, oldest unanswered message first."""
    s = _snap(snap)
    items = []
    for key, pending in s.unanswered.items():
        if not pending:
            continue
        try:
            item = party_summary(key, s)
        except PartyNotFound:
            continue  # a thread linked to a booking that no longer exists
        if q and not _matches_query(item, q):
            continue
        items.append(item)
    items.sort(key=lambda i: (i["oldest_unanswered_at"] or "", i["party_key"]))
    return items


def waiting_count(snap: Snapshot | None = None) -> int:
    return sum(1 for pending in _snap(snap).unanswered.values() if pending)


# --------------------------------------------------------------- shaping ---


def annotate_threads(items: list[dict], snap: Snapshot | None = None) -> list[dict]:
    """Add ``party_key`` and the thread's own ``unanswered_count`` to thread API items."""
    s = _snap(snap)
    for item in items:
        try:
            thrid = int(item.get("thrid") or 0)
        except (TypeError, ValueError):
            thrid = 0
        item["party_key"] = s.thread_party.get(thrid)
        item["unanswered_count"] = int(s.unanswered_by_thread.get(thrid, 0))
    return items


def mark_unanswered(items: list[dict], party_key: str | None, snap: Snapshot | None = None) -> list[dict]:
    """Set ``unanswered`` on message items (inbound/outbound) of a stream."""
    ids = _snap(snap).unanswered_ids(normalise_party_key(party_key)) if party_key else set()
    for item in items:
        if item.get("type") in ("inbound", "outbound"):
            item["unanswered"] = item["type"] == "inbound" and int(item.get("id") or 0) in ids
    return items


def party_stream(party_key: str, snap: Snapshot | None = None) -> dict:
    """``{party_key, booking|null, counterpart_*, unanswered_count, threads, items}``.

    Booking parties reuse ``conversations.booking_conversation`` (every thread
    merged with the booking's events); address parties merge their threads'
    messages and notes.
    """
    from src.services import conversations as cv

    s = _snap(snap)
    key = normalise_party_key(party_key)
    kind, value = parse_party_key(key)
    summary = party_summary(key, s)
    if kind == "b":
        base = cv.booking_conversation(int(value), snap=s)
        booking = base["booking"]
        threads = base["threads"]
        items = base["items"]
    else:
        thrids = [int(t["gmail_thrid"]) for t in s.thread_rows(key)]
        booking = None
        threads = [cv.thread_to_api(t) for t in s.thread_rows(key)]
        items = cv.build_stream(em.messages_for_threads(thrids), et.list_notes(thrids), [])
        mark_unanswered(items, key, s)
    annotate_threads(threads, s)
    return {
        "party_key": key,
        "booking": booking,
        "counterpart_name": summary["counterpart_name"],
        "counterpart_email": summary["counterpart_email"],
        "unanswered_count": summary["unanswered_count"],
        "threads": threads,
        "items": items,
    }


# ---------------------------------------------------------------- actions ---


def _thrids_or_404(key: str, snap: Snapshot) -> list[int]:
    kind, value = parse_party_key(key)
    thrids = list(snap.party_threads.get(key, []))
    if kind == "b":
        _booking_for(key, snap)  # 404 for an unknown booking; an empty party is fine
    elif not thrids:
        raise PartyNotFound(f"No conversation with {value}")
    return thrids


def mark_done(party_key: str, actor: int | None) -> dict:
    """Done on every thread of the party (``done_at = now``): everything so
    far is handled; a later inbound makes the party waiting again."""
    snap = build_snapshot()
    key = normalise_party_key(party_key)
    thrids = _thrids_or_404(key, snap)
    if thrids:
        et.set_status_many(thrids, "done", actor)
        for thrid in thrids:
            em.set_review_status_for_thread(thrid, "resolved", actor, only_pending=True)
        logger.info(f"Party {key} marked done on {len(thrids)} thread(s)")
    return party_summary(key, build_snapshot())


def reopen(party_key: str, actor: int | None) -> dict:
    """Undo the mark: every thread open again with ``done_at`` cleared."""
    snap = build_snapshot()
    key = normalise_party_key(party_key)
    thrids = _thrids_or_404(key, snap)
    if thrids:
        et.set_status_many(thrids, "open", actor)
        logger.info(f"Party {key} reopened ({len(thrids)} thread(s))")
    return party_summary(key, build_snapshot())


def primary_thrid(party_key: str, snap: Snapshot | None = None) -> int | None:
    rows = party_threads(party_key, snap)
    return int(rows[-1]["gmail_thrid"]) if rows else None


__all__ = [
    "PARTY_KEY_RE",
    "PartyError",
    "PartyNotFound",
    "Snapshot",
    "annotate_threads",
    "booking_chip",
    "build_snapshot",
    "compute",
    "last_handled",
    "mark_done",
    "mark_unanswered",
    "normalise_party_key",
    "parse_party_key",
    "party_addresses",
    "party_key_for_thread",
    "party_stream",
    "party_summary",
    "party_threads",
    "primary_thrid",
    "reopen",
    "unanswered_count_for_thread",
    "unanswered_messages",
    "waiting_count",
    "waiting_parties",
]
