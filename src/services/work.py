"""The Work list: one list, a rail of kinds, every row the same shape.

docs/research/01 replaced the ten-section queue with a single list whose views
sit in a rail in pipeline order. ``list_work(view, page, page_size)`` is the
one call behind ``GET /work``; ``counts()`` feeds the rail and the sidebar
badge; ``up_next`` merges the most urgent rows across kinds for the default
view and the Today page.

Views, in pipeline order, and what each selects:

    reply          email_threads waiting on us (open, last message inbound,
                   not automated, linked to a booking); falls back to the
                   per-message rule when the threads table is still empty
    new_requests   status enquiry with no proforma sent
    confirm_money  bank credits: every ``suggested`` one, plus ``unmatched``
                   ones from the last MONEY_WINDOW_DAYS; suggested first
    send_tickets   confirmed, no ticket by either channel, visit today or later
    reminders      due today or earlier, not stale, kind other than ``lapse``
                   (holds have their own view); contiguous by kind
    holds          tentative and unpaid with the hold expiring within
                   HOLD_WINDOW_DAYS or already past; hidden once the lapse
                   reminder is dismissed or stale
    arrivals       confirmed, visit today or earlier, no arrivals recorded
    stale          reminders flagged stale by the daily recompute (any kind)
    up_next        the UP_NEXT_SIZE most urgent live rows across kinds

Row shape (identical in every view)::

    {kind, id, booking | null, title, context, amount, age_days, group,
     primary: {verb, action, ...payload}, secondary: [{verb, action, ...payload}],
     sort_key}

``id`` is kind-prefixed (``"reply:1878…"``, ``"reminder:12"``). ``primary`` is
the one filled button; ``action`` names the call the UI makes (see
docs/handoff/work-today.md for the vocabulary) and every other key is its
payload. ``group`` is the kind title for reminder rows (so the reminders view
can show headings) and null elsewhere. ``sort_key`` orders rows within a view
and across kinds in up_next; treat it as opaque.

Urgency (up_next tiers): 1 holds already past, 2 arrivals to record, 3 replies
waiting longest, 4 money oldest, 5 new requests oldest, 6 tickets by visit
date, 7 reminders and upcoming holds by due date.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Mapping

from src.models.base import loads, query, query_one, serialize_row
from src.services.reminders import KIND_TITLES, LIVE_DUE_SQL
from src.services.settings import get_settings
from src.utils.date import get_today

VIEWS = (
    "up_next",
    "reply",
    "new_requests",
    "confirm_money",
    "send_tickets",
    "reminders",
    "holds",
    "arrivals",
    "stale",
)
LIVE_VIEWS = ("reply", "new_requests", "confirm_money", "send_tickets", "reminders", "holds", "arrivals")

UP_NEXT_SIZE = 10
MONEY_WINDOW_DAYS = 30
HOLD_WINDOW_DAYS = 3

TIER_HOLD_PAST = 1
TIER_ARRIVAL = 2
TIER_REPLY = 3
TIER_MONEY = 4
TIER_NEW_REQUEST = 5
TIER_TICKET = 6
TIER_DUE = 7  # reminders and holds not yet past, by due date

REMINDER_ORDER = ("lapse", "deposit_reminder", "still_interested", "final_details")

# date.max.toordinal() is 3 652 059; subtracting from this keeps "newest first" keys positive.
REVERSE_DATE_BASE = 4_000_000

SOURCE_LABELS = {
    "form": "Form request",
    "email": "Email request",
    "import": "Imported",
    "manual": "Added by hand",
}

TENTATIVE = ("enquiry", "proforma_sent")

BOOKING_COLS = (
    "b.id AS booking_id, b.reference, b.group_name, b.visit_date, b.status, b.people_booked"
)
UNPAID_SQL = "NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.amount > 0)"


# ------------------------------------------------------------- formatting ---


def _day(d: date | datetime | None) -> str:
    """``Sat 31 Oct``."""
    if d is None:
        return ""
    if isinstance(d, datetime):
        d = d.date()
    return f"{d:%a} {d.day} {d:%b}"


def _rel(days: int) -> str:
    """Relative day count: ``3 d ago``, ``today``, ``in 2 d``."""
    if days > 0:
        return f"{days} d ago"
    if days == 0:
        return "today"
    return f"in {-days} d"


def _rands(value: Any) -> str:
    """``R3 800`` or ``R3 290.50`` (thousands separated by a space)."""
    amount = Decimal(str(value or 0)).quantize(Decimal("0.01"))
    whole = int(amount)
    cents = int((amount - whole) * 100)
    text = f"{whole:,}".replace(",", " ")
    return f"R{text}" if cents == 0 else f"R{text}.{cents:02d}"


def _money(value: Any) -> float | None:
    return None if value is None else round(float(value), 2)


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _days_since(value: Any, today: date) -> int:
    d = _as_date(value)
    return max(0, (today - d).days) if d else 0


def _key(tier: int, *parts: Any) -> str:
    """Lexicographically sortable key: ``07:2026-10-05:00000012``."""
    out = [f"{tier:02d}"]
    for p in parts:
        if isinstance(p, (date, datetime)):
            out.append(p.isoformat())
        elif isinstance(p, int):
            out.append(f"{p:08d}")
        else:
            out.append(str(p))
    return ":".join(out)


# -------------------------------------------------------------- row shape ---


def _act(verb: str, action: str, **payload: Any) -> dict:
    return {"verb": verb, "action": action, **payload}


def _chip(r: Mapping[str, Any]) -> dict | None:
    if r.get("booking_id") is None:
        return None
    return {
        "id": int(r["booking_id"]),
        "reference": r["reference"],
        "group_name": r["group_name"],
        "visit_date": _as_date(r["visit_date"]).isoformat() if r.get("visit_date") else None,
        "status": r["status"],
        "people_booked": int(r["people_booked"] or 0),
    }


def _row(
    kind: str,
    ident: str,
    *,
    booking: dict | None,
    title: str,
    context: str,
    amount: Any,
    age_days: int,
    primary: dict,
    secondary: list[dict],
    sort_key: str,
    group: str | None = None,
) -> dict:
    return {
        "kind": kind,
        "id": ident,
        "booking": booking,
        "title": title,
        "context": context,
        "amount": _money(amount),
        "age_days": int(age_days),
        "group": group,
        "primary": primary,
        "secondary": secondary,
        "sort_key": sort_key,
    }


def _open(booking_id: int) -> dict:
    return _act("Open", "open_booking", booking_id=int(booking_id))


# ------------------------------------------------------------------ reply ---


def _threads_exist() -> bool:
    return query_one("SELECT 1 AS one FROM email_threads LIMIT 1") is not None


def _reply_threads() -> list[dict]:
    return query(
        f"""
        SELECT {BOOKING_COLS}, t.gmail_thrid, t.counterpart_name, t.counterpart_email,
               t.subject, t.last_inbound_at, t.last_snippet
        FROM email_threads t
        JOIN bookings b ON b.id = t.booking_id
        WHERE t.status = 'open' AND t.last_direction = 'inbound'
          AND t.has_automated_only = 0 AND t.not_booking = 0
        ORDER BY t.last_inbound_at, t.gmail_thrid
        """
    )


def _reply_messages(today: date) -> list[dict]:
    """Per-message fallback: the newest non-automatic message on the booking is
    inbound. Old bookings drop out two weeks after the visit."""
    return query(
        f"""
        WITH ranked AS (
            SELECT m.id, m.booking_id, m.direction, m.gmail_thrid, m.subject, m.from_name,
                   m.from_email, m.sent_at, m.snippet,
                   ROW_NUMBER() OVER (PARTITION BY m.booking_id ORDER BY m.sent_at DESC, m.id DESC) AS rn
            FROM email_messages m
            WHERE m.booking_id IS NOT NULL AND m.is_auto_generated = 0
        )
        SELECT {BOOKING_COLS}, r.gmail_thrid, r.from_name AS counterpart_name,
               r.from_email AS counterpart_email, r.subject, r.sent_at AS last_inbound_at,
               r.snippet AS last_snippet, r.id AS message_id
        FROM ranked r
        JOIN bookings b ON b.id = r.booking_id
        WHERE r.rn = 1 AND r.direction = 'inbound'
          AND (b.status IN ('enquiry', 'proforma_sent', 'confirmed') OR b.visit_date >= %s)
        ORDER BY r.sent_at, r.id
        """,
        (today - timedelta(days=14),),
    )


def _reply_rows(today: date, use_threads: bool | None = None) -> list[dict]:
    if use_threads is None:
        use_threads = _threads_exist()
    rows = _reply_threads() if use_threads else _reply_messages(today)
    out = []
    for r in rows:
        thrid = str(r["gmail_thrid"]) if r.get("gmail_thrid") is not None else None
        ident = f"reply:{thrid}" if thrid else f"reply:m{r['message_id']}"
        waiting = _days_since(r["last_inbound_at"], today)
        who = r.get("counterpart_name") or r.get("counterpart_email") or "Customer"
        primary = _act("Reply", "open_conversation", thrid=thrid, booking_id=int(r["booking_id"]))
        if thrid is None:
            primary["message_id"] = int(r["message_id"])
        out.append(
            _row(
                "reply",
                ident,
                booking=_chip(r),
                title=r["group_name"],
                context=f"{who} · waiting {waiting} d",
                amount=None,
                age_days=waiting,
                primary=primary,
                secondary=[_open(r["booking_id"])],
                sort_key=_key(TIER_REPLY, r["last_inbound_at"] or datetime.min, ident),
            )
        )
    return out


# ----------------------------------------------------------- new requests ---


def _new_request_rows(today: date) -> list[dict]:
    rows = query(
        f"""
        SELECT {BOOKING_COLS}, b.source, b.created_at, b.enquiry_date, b.contact_name,
               b.email_thread_id,
               (SELECT COUNT(*) FROM booking_questions q
                 WHERE q.booking_id = b.id AND q.answer IS NULL) AS unanswered
        FROM bookings b
        WHERE b.status = 'enquiry' AND b.proforma_sent_at IS NULL
        ORDER BY COALESCE(b.enquiry_date, DATE(b.created_at)), b.created_at, b.id
        """
    )
    out = []
    for r in rows:
        since = r.get("enquiry_date") or r.get("created_at")
        waiting = _days_since(since, today)
        bits = [SOURCE_LABELS.get(r["source"], r["source"] or "Request")]
        if r.get("contact_name"):
            bits.append(r["contact_name"])
        if int(r["unanswered"] or 0):
            n = int(r["unanswered"])
            bits.append(f"{n} question{'s' if n != 1 else ''}")
        bits.append(f"waiting {waiting} d")
        secondary: list[dict] = []
        if r.get("email_thread_id"):
            secondary.append(
                _act(
                    "Reply",
                    "open_conversation",
                    thrid=str(r["email_thread_id"]),
                    booking_id=int(r["booking_id"]),
                )
            )
        out.append(
            _row(
                "new_request",
                f"new_request:{r['booking_id']}",
                booking=_chip(r),
                title=r["group_name"],
                context=" · ".join(bits),
                amount=None,
                age_days=waiting,
                primary=_act("Send proforma", "open_booking", booking_id=int(r["booking_id"])),
                secondary=secondary,
                sort_key=_key(TIER_NEW_REQUEST, _as_date(since) or today, int(r["booking_id"])),
            )
        )
    return out


# ------------------------------------------------------------------ money ---


def _reason_text(reason: str | None) -> str:
    if not reason:
        return "possible match"
    text = reason[0].lower() + reason[1:]
    return text[7:] if text.startswith("amount ") else text


def _money_rows(today: date) -> list[dict]:
    rows = query(
        """
        SELECT id, amount, description, booking_date, match_status, suggestions
        FROM bank_transactions
        WHERE credit_debit = 'CREDIT'
          AND (match_status = 'suggested' OR (match_status = 'unmatched' AND booking_date >= %s))
        ORDER BY (match_status = 'suggested') DESC, booking_date, id
        """,
        (today - timedelta(days=MONEY_WINDOW_DAYS),),
    )
    # One lookup for every top suggestion's booking so the chip is canonical.
    tops: dict[int, dict] = {}
    for r in rows:
        if r["match_status"] == "suggested":
            suggestions = loads(r["suggestions"]) or []
            if suggestions:
                tops[int(r["id"])] = suggestions[0]
    chips: dict[int, dict] = {}
    ids = sorted({int(s["booking_id"]) for s in tops.values() if s.get("booking_id")})
    if ids:
        marks = ",".join(["%s"] * len(ids))
        for b in query(f"SELECT {BOOKING_COLS} FROM bookings b WHERE b.id IN ({marks})", ids):
            chips[int(b["booking_id"])] = _chip(b)

    out = []
    for r in rows:
        tx_id = int(r["id"])
        suggested = r["match_status"] == "suggested"
        top = tops.get(tx_id)
        chip = chips.get(int(top["booking_id"])) if top and top.get("booking_id") else None
        age = _days_since(r["booking_date"], today)
        title = " ".join(str(r["description"] or "").split()) or "Bank credit"
        if suggested and chip:
            reasons = top.get("reasons") or []
            suggestions = loads(r["suggestions"]) or []
            context = f"Suggested {chip['reference']} · {_reason_text(reasons[0] if reasons else None)}"
            if len(suggestions) > 1:
                context += f" · {len(suggestions) - 1} more"
            primary = _act("Confirm", "match_transaction", tx_id=tx_id, booking_id=chip["id"])
            secondary = [
                _act("Open", "open_transaction", tx_id=tx_id),
                _act("Ignore", "ignore_transaction", tx_id=tx_id),
            ]
        else:
            context = f"Unmatched credit · {_day(r['booking_date'])}"
            primary = _act("Match", "open_transaction", tx_id=tx_id)
            secondary = [
                _act("Not a booking", "ignore_transaction", tx_id=tx_id, reason="Not a booking")
            ]
        out.append(
            _row(
                "money",
                f"money:{tx_id}",
                booking=chip,
                title=title,
                context=context,
                amount=r["amount"],
                age_days=age,
                primary=primary,
                secondary=secondary,
                sort_key=_key(TIER_MONEY, 0 if suggested else 1, r["booking_date"], tx_id),
            )
        )
    return out


# ---------------------------------------------------------------- tickets ---


def _ticket_rows(today: date) -> list[dict]:
    rows = query(
        f"""
        SELECT {BOOKING_COLS}, b.contact_email, b.contact_mobile, b.vehicles, b.confirmed_at
        FROM bookings b
        WHERE b.status = 'confirmed' AND b.ticket_sent_at IS NULL AND b.ticket_emailed_at IS NULL
          AND b.visit_date >= %s
        ORDER BY b.visit_date, b.group_name, b.id
        """,
        (today,),
    )
    out = []
    for r in rows:
        bid = int(r["booking_id"])
        visit = _as_date(r["visit_date"])
        bits = [f"Visit {_day(visit)}", _rel((today - visit).days)]
        vehicles = int(r["vehicles"] or 0)
        if vehicles:
            bits.append(f"{vehicles} vehicle{'s' if vehicles != 1 else ''}")
        email, mobile = r.get("contact_email"), r.get("contact_mobile")
        secondary: list[dict] = []
        if email:
            primary = _act("Send ticket", "booking_action", booking_id=bid, name="send-ticket-email")
            if mobile:
                secondary.append(
                    _act("WhatsApp", "booking_action", booking_id=bid, name="send-ticket-whatsapp")
                )
        elif mobile:
            primary = _act("Send ticket", "booking_action", booking_id=bid, name="send-ticket-whatsapp")
            bits.append("WhatsApp only")
        else:
            primary = _act("Add contact", "open_booking", booking_id=bid)
            bits.append("no contact details")
        secondary.append(_open(bid))
        out.append(
            _row(
                "ticket",
                f"ticket:{bid}",
                booking=_chip(r),
                title=r["group_name"],
                context=" · ".join(bits),
                amount=None,
                # Tickets are scheduled by visit date, not aged: an imported
                # booking confirmed in January is not "276 days overdue".
                age_days=0,
                primary=primary,
                secondary=secondary,
                sort_key=_key(TIER_TICKET, visit, bid),
            )
        )
    return out


# -------------------------------------------------------------- reminders ---


def _reminder_sql(where: str) -> str:
    return f"""
        SELECT {BOOKING_COLS}, r.id AS reminder_id, r.kind, r.due_on, r.stale,
               b.contact_email, b.deposit_due, b.deposit_waived, b.hold_expires_on,
               (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.booking_id = b.id) AS paid
        FROM booking_reminders r
        JOIN bookings b ON b.id = r.booking_id
        WHERE {where}
        ORDER BY FIELD(r.kind, {", ".join(repr(k) for k in REMINDER_ORDER)}), r.due_on, b.visit_date, r.id
    """


def _reminder_row(r: Mapping[str, Any], today: date, *, stale: bool) -> dict:
    bid = int(r["booking_id"])
    rid = int(r["reminder_id"])
    kind = r["kind"]
    due = _as_date(r["due_on"])
    overdue = (today - due).days
    bits = [f"Due {_rel(overdue)}", f"visit {_day(r['visit_date'])}"]
    outstanding = None
    if kind in ("deposit_reminder", "still_interested", "lapse") and not r.get("deposit_waived"):
        outstanding = max(Decimal(str(r["deposit_due"] or 0)) - Decimal(str(r["paid"] or 0)), Decimal(0))
        if outstanding > 0:
            bits.append(f"deposit {_rands(outstanding)} outstanding")
    if not r.get("contact_email"):
        bits.append("no email on booking")
    if stale:
        bits.append("stale")
        primary = _act("Dismiss", "dismiss_reminders", ids=[rid])
        secondary = [_open(bid)]
        if kind == "lapse":
            hold = _as_date(r.get("hold_expires_on"))
            secondary.append(
                _act("Extend", "extend_hold", booking_id=bid, hold_expires_on=hold.isoformat() if hold else None)
            )
        tier = TIER_DUE
    else:
        if r.get("contact_email"):
            primary = _act("Send reminder", "booking_action", booking_id=bid, name="send-reminder", kind=kind)
        else:
            primary = _act("Add email", "open_booking", booking_id=bid)
        secondary = [_open(bid), _act("Dismiss", "dismiss_reminders", ids=[rid])]
        tier = TIER_DUE
    return _row(
        "reminder",
        f"reminder:{rid}",
        booking=_chip(r),
        title=r["group_name"],
        context=" · ".join(bits),
        amount=outstanding if outstanding and outstanding > 0 else None,
        age_days=max(0, overdue),
        primary=primary,
        secondary=secondary,
        sort_key=_key(tier, due, rid),
        group=KIND_TITLES.get(kind, kind),
    )


def _reminder_rows(today: date) -> list[dict]:
    rows = query(_reminder_sql(f"{LIVE_DUE_SQL} AND r.kind <> 'lapse'"), (today,))
    return [_reminder_row(r, today, stale=False) for r in rows]


def _stale_rows(today: date) -> list[dict]:
    rows = query(_reminder_sql("r.status = 'due' AND r.stale = 1"))
    return [_reminder_row(r, today, stale=True) for r in rows]


# ------------------------------------------------------------------ holds ---


def _hold_rows(today: date, lapse_days_before: int) -> list[dict]:
    rows = query(
        f"""
        SELECT {BOOKING_COLS}, b.contact_email, b.deposit_due, b.deposit_waived,
               COALESCE(b.hold_expires_on, DATE_SUB(b.visit_date, INTERVAL %s DAY)) AS hold_on,
               r.id AS reminder_id
        FROM bookings b
        LEFT JOIN booking_reminders r ON r.booking_id = b.id AND r.kind = 'lapse'
        WHERE b.status IN ('enquiry', 'proforma_sent')
          AND COALESCE(b.hold_expires_on, DATE_SUB(b.visit_date, INTERVAL %s DAY)) <= %s
          AND b.visit_date >= %s
          AND {UNPAID_SQL}
          AND (r.id IS NULL OR (r.status = 'due' AND r.stale = 0))
        ORDER BY hold_on, b.visit_date, b.id
        """,
        (lapse_days_before, lapse_days_before, today + timedelta(days=HOLD_WINDOW_DAYS), today),
    )
    out = []
    for r in rows:
        bid = int(r["booking_id"])
        hold_on = _as_date(r["hold_on"])
        past = (today - hold_on).days
        deposit = Decimal(str(r["deposit_due"] or 0))
        if past > 0:
            bits = [f"Hold expired {_rel(past)}"]
        else:
            bits = [f"Hold expires {_rel(past)}"]
        if deposit > 0 and not r.get("deposit_waived"):
            bits.append(f"deposit {_rands(deposit)} outstanding")
        bits.append(f"visit {_day(r['visit_date'])}")
        secondary: list[dict] = []
        if r.get("contact_email"):
            secondary.append(_act("Send expiry", "booking_action", booking_id=bid, name="send-expiry"))
        secondary.append(_open(bid))
        if r.get("reminder_id"):
            secondary.append(_act("Dismiss", "dismiss_reminders", ids=[int(r["reminder_id"])]))
        tier = TIER_HOLD_PAST if past > 0 else TIER_DUE
        out.append(
            _row(
                "hold",
                f"hold:{bid}",
                booking=_chip(r),
                title=r["group_name"],
                context=" · ".join(bits),
                amount=deposit if deposit > 0 else None,
                age_days=max(0, past),
                primary=_act("Extend", "extend_hold", booking_id=bid, hold_expires_on=hold_on.isoformat()),
                secondary=secondary,
                sort_key=_key(tier, hold_on, bid),
            )
        )
    return out


# --------------------------------------------------------------- arrivals ---


def _arrival_rows(today: date) -> list[dict]:
    rows = query(
        f"""
        SELECT {BOOKING_COLS}
        FROM bookings b
        WHERE b.status = 'confirmed' AND b.visit_date <= %s AND b.arrived_count IS NULL
        ORDER BY b.visit_date DESC, b.group_name, b.id
        """,
        (today,),
    )
    out = []
    for r in rows:
        bid = int(r["booking_id"])
        visit = _as_date(r["visit_date"])
        ago = (today - visit).days
        people = int(r["people_booked"] or 0)
        secondary = [_open(bid)]
        if ago > 0:
            secondary.append(_act("No show", "set_status", booking_id=bid, status="no_show"))
        out.append(
            _row(
                "arrival",
                f"arrival:{bid}",
                booking=_chip(r),
                title=r["group_name"],
                context=f"Visited {_rel(ago)} · {people} booked",
                amount=None,
                age_days=max(0, ago),
                primary=_act("Record", "open_day", date=visit.isoformat(), booking_id=bid),
                secondary=secondary,
                # Most recent visit first: today's groups before last week's.
                # (The base exceeds any date ordinal so the key stays positive.)
                sort_key=_key(TIER_ARRIVAL, REVERSE_DATE_BASE - visit.toordinal(), bid),
            )
        )
    return out


# --------------------------------------------------------------- assembly ---


def _reminder_group_rank(row: dict) -> int:
    title = row.get("group")
    for i, kind in enumerate(REMINDER_ORDER):
        if KIND_TITLES.get(kind) == title:
            return i
    return len(REMINDER_ORDER)


def _view_sorted(view: str, rows: list[dict]) -> list[dict]:
    if view in ("reminders", "stale"):
        return sorted(rows, key=lambda r: (_reminder_group_rank(r), r["sort_key"]))
    return sorted(rows, key=lambda r: r["sort_key"])


def merge_up_next(views: Mapping[str, list[dict]], limit: int = UP_NEXT_SIZE) -> list[dict]:
    """The most urgent live rows across kinds, by tiered sort_key. Pure."""
    live = [row for view in LIVE_VIEWS for row in views.get(view, [])]
    live.sort(key=lambda r: r["sort_key"])
    return live[:limit]


def snapshot(today: date | None = None) -> dict:
    """Every view's rows in one pass (about ten small queries).

    Returns ``{"today", "views": {view: rows}, "counts": {...}, "up_next": [...]}``.
    ``list_work``, ``counts`` and the Today page all build on this so the
    numbers agree everywhere.
    """
    today = today or get_today()
    cfg = get_settings()["reminders"]
    views = {
        "reply": _reply_rows(today),
        "new_requests": _new_request_rows(today),
        "confirm_money": _money_rows(today),
        "send_tickets": _ticket_rows(today),
        "reminders": _reminder_rows(today),
        "holds": _hold_rows(today, int(cfg["lapse_days_before"])),
        "arrivals": _arrival_rows(today),
        "stale": _stale_rows(today),
    }
    views = {view: _view_sorted(view, rows) for view, rows in views.items()}
    up_next = merge_up_next(views)
    counts = {view: len(rows) for view, rows in views.items()}
    counts["up_next"] = len(up_next)
    counts["total"] = sum(len(views[v]) for v in LIVE_VIEWS)
    return {"today": today.isoformat(), "views": views, "counts": counts, "up_next": up_next}


def counts(today: date | None = None) -> dict:
    """Per-view counts for the rail plus ``total`` (live rows, stale excluded)
    and ``up_next``. Zeros are returned; hiding at zero is the UI's job."""
    return snapshot(today)["counts"]


def list_work(view: str, page: int = 1, page_size: int = 50, today: date | None = None) -> dict:
    """One view of the Work list: ``{items, total, page, page_size, view, counts}``."""
    if view not in VIEWS:
        raise ValueError(f"Unknown view: {view}")
    snap = snapshot(today)
    rows = snap["up_next"] if view == "up_next" else snap["views"][view]
    page = max(1, int(page))
    page_size = max(1, int(page_size))
    start = (page - 1) * page_size
    return {
        "view": view,
        "items": rows[start : start + page_size],
        "total": len(rows),
        "page": page,
        "page_size": page_size,
        "counts": snap["counts"],
        "today": snap["today"],
    }


def needs_you(snap: Mapping[str, Any] | None = None) -> dict:
    """The Today tile: how many live rows and how long the oldest has waited."""
    snap = snap or snapshot()
    live = [row for v in LIVE_VIEWS for row in snap["views"][v]]
    return {
        "count": len(live),
        "oldest_days": max((int(r["age_days"]) for r in live), default=0),
    }


def serialize(rows: list[dict]) -> list[dict]:
    """Rows are already JSON-safe; kept for symmetry with the other services."""
    return [serialize_row(r) or {} for r in rows]
