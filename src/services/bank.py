"""Bank feed: poll FNB, store each entry once, match credits to bookings.

    poll_transactions()            # cron every 5 minutes, and POST /payments/sync
    match_transaction(tx) -> MatchResult
    confirm_match(tx_id, booking_id, actor, method)   # records the payment
    unmatch(tx_id, actor) / ignore(tx_id, reason, actor)

Matching tiers (docs/handoff/payments.md has the worked examples):

strong     a booking reference in the description or endToEndId — ``FY1703``,
           ``INV 1703``, ``fy-1703`` — whose booking is live (not cancelled /
           lapsed / no_show) and whose total covers the amount (+R1). A bare
           4-digit number is also strong when the amount equals that booking's
           deposit or balance within R1. Exactly one candidate, or it is not strong.
suggested  bookings with a visit in the last 7 days or later whose deposit or
           balance equals the amount within R1, or that share two or more
           significant words with the description; scored, top five.
none       everything else stays unmatched for an operator.

Automatic strong matches record the payment through the bookings service
(which confirms the booking once the deposit is covered) and nothing else:
no email, no WhatsApp. Every send stays a button.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Iterable

from src.clients.fnb import (
    FNBClient,
    check_balance_chain,
    fingerprint_entries,
    flatten,
)
from src.models import bank_transaction as bank_model
from src.models.base import dumps, execute, query_one, serialize_row
from src.services.settings import get_settings
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("bank")

# Production transaction history has a floor (README §13.5).
HISTORY_FLOOR = date(2026, 7, 1)
# Re-read this many days before the newest stored entry to catch late bookings.
OVERLAP_DAYS = 3
# On an empty table, start this far before the season so early deposits land.
SEASON_LEAD_DAYS = 120
# The gateway caches a (account, from, to) window for 30-70 min; rotate toDate.
WINDOW_VARIANTS = 28
# Credits older than this are left alone by the automatic matcher.
MATCH_LOOKBACK_DAYS = 120
# Visits this far in the past still take payments (balance settled late).
SUGGEST_VISIT_GRACE_DAYS = 7
AMOUNT_TOLERANCE = Decimal("1.00")
MAX_SUGGESTIONS = 5

ACTIVE_STATUSES = ("enquiry", "proforma_sent", "confirmed", "completed")

REFERENCE_RE = re.compile(r"(?:FY|INV)[\s-]?(\d{3,5})", re.IGNORECASE)
BARE_NUMBER_RE = re.compile(r"(?<!\d)(\d{4})(?!\d)")
WORD_RE = re.compile(r"[A-Za-z]{4,}")
BOILERPLATE = frozenset(
    {
        "ABSA", "CAPITEC", "FNB", "NEDBANK", "STANDARD", "TYME", "TYMEBANK",
        "INVESTEC", "DISCOVERY", "AFRICAN", "BIDVEST", "BANK", "PAYMENT", "PAYMENTS",
        "TRANSFER", "DEPOSIT", "CREDIT", "PAYSHAP", "IMMEDIATE", "INTERNET", "ONLINE",
        "CASH", "FROM", "WITH", "THANK", "THANKS", "BOOKING", "FARMYARD", "PARK",
        "FARM", "YARD", "RTC", "ACB", "MAGTAPE", "SETTLEMENT",
    }
)
# Generic group words: they count towards the two-word rule but score less.
GENERIC_NAME_WORDS = frozenset(
    {"SCHOOL", "CHURCH", "PRIMARY", "CRECHE", "GROUP", "CLUB", "YOUTH", "FAMILY",
     "HIGH", "COLLEGE", "ACADEMY", "MINISTRIES", "MINISTRY", "TRUST", "FOUNDATION"}
)


class BankError(Exception):
    """Operator-facing problem. ``status`` maps to the HTTP code."""

    def __init__(self, message: str, status: int = 400, code: str = "bank_error"):
        super().__init__(message)
        self.status = status
        self.code = code


class BankPollError(BankError):
    """The poll itself failed; the bank_poll_log row says why."""

    def __init__(self, message: str):
        super().__init__(message, status=502, code="bank_poll_failed")


@dataclass
class MatchResult:
    kind: str  # strong | suggested | none
    booking_id: int | None = None
    suggestions: list[dict] = field(default_factory=list)
    method: str | None = None  # reference | reference_amount | manual


# ------------------------------------------------------------------ parsing ---

def parse_reference_numbers(*texts: str | None) -> tuple[list[int], list[int]]:
    """``(prefixed, bare)`` document numbers found in the texts, de-duplicated.

    Prefixed: ``FY1703`` / ``INV 1703`` / ``inv-1703``. Bare: any standalone
    4-digit number not already claimed by a prefixed match.
    """
    text = " ".join(t for t in texts if t)
    prefixed: list[int] = []
    for m in REFERENCE_RE.finditer(text):
        n = int(m.group(1))
        if n not in prefixed:
            prefixed.append(n)
    stripped = REFERENCE_RE.sub(" ", text)
    bare: list[int] = []
    for m in BARE_NUMBER_RE.finditer(stripped):
        n = int(m.group(1))
        if n not in prefixed and n not in bare:
            bare.append(n)
    return prefixed, bare


def significant_words(text: str | None) -> set[str]:
    """Upper-case words of four or more letters that are not bank boilerplate."""
    if not text:
        return set()
    return {w.upper() for w in WORD_RE.findall(text) if w.upper() not in BOILERPLATE}


# ------------------------------------------------------------------- window ---

def poll_window(
    today: date,
    latest_booking_date: date | None,
    season_start: date,
    poll_number: int,
) -> tuple[date, date]:
    """``(fromDate, toDate)`` for one poll.

    fromDate is the newest stored entry minus the overlap, never earlier than
    the production history floor or 120 days before the season. toDate rotates
    through 28 future dates so the gateway's result cache is never reused.
    """
    floors = [HISTORY_FLOOR, season_start - timedelta(days=SEASON_LEAD_DAYS)]
    if latest_booking_date is not None:
        floors.append(latest_booking_date - timedelta(days=OVERLAP_DAYS))
    window_from = max(floors)
    if window_from > today:
        window_from = today
    window_to = today + timedelta(days=1 + (poll_number % WINDOW_VARIANTS))
    return window_from, window_to


# --------------------------------------------------------------------- poll ---

def poll_transactions(client: FNBClient | None = None) -> dict:
    """Fetch the window, insert what is new, then run the matcher.

    Always writes a ``bank_poll_log`` row. Raises ``BankPollError`` when the
    fetch fails (after recording it); matcher failures are counted, not raised.
    """
    today = get_today()
    settings = get_settings()
    season_start = date.fromisoformat(str(settings["season"]["start"]))
    latest = bank_model.latest_booking_date()
    poll_number = bank_model.poll_count()
    window_from, window_to = poll_window(today, latest, season_start, poll_number)
    poll_id = bank_model.start_poll(window_from, window_to)
    logger.info(
        f"Bank poll #{poll_id} window {window_from}..{window_to} (poll number {poll_number})"
    )

    try:
        client = client or FNBClient.from_settings()
        account = client.account or ""
        entries = list(
            client.iter_transactions(account, window_from.isoformat(), window_to.isoformat())
        )
        breaks = check_balance_chain(entries)
        if breaks:
            logger.warning(
                f"Bank poll #{poll_id}: balance chain breaks at "
                f"{', '.join(str(b['entry_id']) for b in breaks[:5])}"
                f"{' ...' if len(breaks) > 5 else ''}"
            )
        new_entries = 0
        credits = debits = 0
        for fp, entry in fingerprint_entries(account, entries):
            row = entry_to_row(account, fp, entry)
            _, created = bank_model.upsert_by_fingerprint(row)
            if created:
                new_entries += 1
                if row["credit_debit"] == "CREDIT":
                    credits += 1
                else:
                    debits += 1
        bank_model.finish_poll(poll_id, "success", len(entries), new_entries)
    except Exception as exc:  # noqa: BLE001 - recorded on the poll row, then raised
        message = f"{type(exc).__name__}: {exc}"
        bank_model.finish_poll(poll_id, "failed", error=message[:2000])
        logger.error(f"Bank poll #{poll_id} failed: {message}")
        raise BankPollError(message) from exc

    logger.info(
        f"Bank poll #{poll_id}: {len(entries)} entries, {new_entries} new "
        f"({credits} credits, {debits} debits), {len(breaks)} chain breaks, "
        f"{client.request_count} HTTP calls"
    )
    matching = match_new()
    return {
        "poll_id": poll_id,
        "status": "success",
        "window_from": window_from.isoformat(),
        "window_to": window_to.isoformat(),
        "entries": len(entries),
        "new_entries": new_entries,
        "new_credits": credits,
        "new_debits": debits,
        "chain_breaks": len(breaks),
        "http_calls": client.request_count,
        "matching": matching,
    }


def entry_to_row(account: str, fp: str, entry: dict) -> dict:
    """A ``bank_transactions`` row from one raw API entry."""
    flat = flatten(entry)
    booking_date = _parse_date(flat["booking_date"]) or _parse_date(flat["value_date"]) or get_today()
    balance = _decimal_or_none(flat["balance"])
    if balance is not None and balance == 0:
        balance = None  # 0.00 means "not booked yet", not a real balance
    return {
        "fingerprint": fp,
        "account_number": account[:32],
        "entry_id": (flat["entry_id"] or None) and str(flat["entry_id"])[:32],
        "booking_date": booking_date,
        "value_date": _parse_date(flat["value_date"]),
        "description": (flat["description"] or "").strip()[:255] or None,
        "end_to_end_id": (flat["end_to_end_id"] or "").strip()[:255] or None,
        "amount": Decimal(flat["amount"]),
        "credit_debit": "CREDIT" if flat["credit_debit"] == "CREDIT" else "DEBIT",
        "balance_after": balance,
        "raw": dumps(entry),
    }


# ----------------------------------------------------------------- matching ---

def match_new(since_days: int = MATCH_LOOKBACK_DAYS) -> dict:
    """Re-evaluate every unmatched or suggested credit in the lookback window.

    Suggested rows are re-evaluated too, so a booking created after its deposit
    landed is picked up on the next poll. Strong matches are confirmed one at
    a time with a fresh candidate list, because each payment changes the
    balance the next amount test compares against.
    """
    today = get_today()
    counts = {"checked": 0, "matched": 0, "suggested": 0, "unmatched": 0, "failed": 0}
    rows = bank_model.credits_to_match(since_days, statuses=("unmatched", "suggested"))
    candidates = bank_model.match_candidates()
    for tx in rows:
        counts["checked"] += 1
        try:
            result = match_transaction(tx, candidates, today)
            if result.kind == "strong" and result.booking_id is not None:
                confirm_match(
                    tx["id"], result.booking_id, actor=None, method=result.method or "reference"
                )
                counts["matched"] += 1
                candidates = bank_model.match_candidates()
            elif result.kind == "suggested":
                bank_model.set_match(tx["id"], "suggested", suggestions=result.suggestions)
                counts["suggested"] += 1
            else:
                if tx["match_status"] != "unmatched":
                    bank_model.set_match(tx["id"], "unmatched")
                counts["unmatched"] += 1
        except Exception as exc:  # noqa: BLE001 - one bad row must not stop the rest
            counts["failed"] += 1
            logger.error(f"Matching bank transaction {tx['id']} failed: {exc}")
    if counts["checked"]:
        logger.info(f"Bank matching: {counts}")
    return counts


def candidate_finance(booking: dict) -> dict:
    """The money figures the matcher compares (same formulas as booking_finance)."""
    price = Decimal(str(booking.get("price_per_person") or 0))
    people = int(booking.get("people_booked") or 0)
    total = (price * people).quantize(Decimal("0.01"))
    deposit = Decimal("0") if booking.get("deposit_waived") else Decimal(str(booking.get("deposit_due") or 0))
    paid = Decimal(str(booking.get("paid_total") or 0))
    return {
        "total_amount": total,
        "deposit_due": deposit.quantize(Decimal("0.01")),
        "paid_total": paid.quantize(Decimal("0.01")),
        "balance_due": (total - paid).quantize(Decimal("0.01")),
    }


def match_transaction(
    tx: dict,
    candidates: Iterable[dict] | None = None,
    today: date | None = None,
) -> MatchResult:
    """Decide what a credit is. Pure given ``candidates``; loads them otherwise."""
    if tx.get("credit_debit") != "CREDIT":
        return MatchResult("none")
    amount = Decimal(str(tx["amount"]))
    today = today or get_today()
    cands = list(candidates) if candidates is not None else bank_model.match_candidates()
    by_number = {int(c["doc_number"]): c for c in cands if c.get("doc_number")}
    description = tx.get("description") or ""
    prefixed, bare = parse_reference_numbers(description, tx.get("end_to_end_id"))

    suggestions: dict[int, dict] = {}

    def suggest(c: dict, score: int, reason: str) -> None:
        fin = candidate_finance(c)
        entry = suggestions.get(c["id"])
        if entry is None:
            entry = suggestions[c["id"]] = {
                "booking_id": c["id"],
                "reference": c["reference"],
                "group_name": c["group_name"],
                "contact_name": c.get("contact_name"),
                "visit_date": c["visit_date"].isoformat() if c.get("visit_date") else None,
                "status": c["status"],
                "total_amount": float(fin["total_amount"]),
                "deposit_due": float(fin["deposit_due"]),
                "paid_total": float(fin["paid_total"]),
                "balance_due": float(fin["balance_due"]),
                "score": 0,
                "reasons": [],
            }
        entry["score"] = min(100, entry["score"] + score)
        if reason not in entry["reasons"]:
            entry["reasons"].append(reason)

    def amount_fits(fin: dict) -> str | None:
        if fin["deposit_due"] > 0 and abs(amount - fin["deposit_due"]) <= AMOUNT_TOLERANCE:
            return "Amount equals the deposit"
        if fin["balance_due"] > 0 and abs(amount - fin["balance_due"]) <= AMOUNT_TOLERANCE:
            return "Amount equals the balance"
        return None

    # Tier 1: an explicit reference. Prefer the prefixed form.
    strong: list[dict] = []
    for n in prefixed:
        c = by_number.get(n)
        if c is None:
            continue
        fin = candidate_finance(c)
        if c["status"] not in ACTIVE_STATUSES:
            suggest(c, 30, f"Reference {c['reference']} but the booking is {c['status']}")
        elif amount > fin["total_amount"] + AMOUNT_TOLERANCE:
            suggest(c, 35, f"Reference {c['reference']} but the amount exceeds the total")
        else:
            strong.append(c)
    if len(strong) == 1:
        return MatchResult("strong", strong[0]["id"], method="reference")
    for c in strong:  # several live references in one payment: a person decides
        suggest(c, 70, f"Reference {c['reference']} (one of several in the description)")

    # Tier 1b: a bare number is only strong when the amount agrees as well.
    bare_strong: list[dict] = []
    for n in bare:
        c = by_number.get(n)
        if c is None or c["status"] not in ACTIVE_STATUSES:
            continue
        fin = candidate_finance(c)
        reason = amount_fits(fin)
        if reason and not strong:
            bare_strong.append(c)
        elif amount <= fin["total_amount"] + AMOUNT_TOLERANCE:
            suggest(c, 50, f"Number {n} matches {c['reference']}")
    if len(bare_strong) == 1 and not strong:
        return MatchResult("strong", bare_strong[0]["id"], method="reference_amount")
    for c in bare_strong:
        suggest(c, 60, f"Number matches {c['reference']} and the amount fits")

    # Tier 2: amount or name agreement on recent and upcoming bookings.
    words = significant_words(description)
    cutoff = today - timedelta(days=SUGGEST_VISIT_GRACE_DAYS)
    for c in cands:
        if c["status"] not in ACTIVE_STATUSES:
            continue
        visit = c.get("visit_date")
        if visit is None or visit < cutoff:
            continue
        fin = candidate_finance(c)
        score = 0
        reasons: list[str] = []
        reason = amount_fits(fin)
        if reason:
            score += 40
            reasons.append(reason)
        name_words = significant_words(f"{c.get('group_name') or ''} {c.get('contact_name') or ''}")
        common = words & name_words
        if len(common) >= 2:
            specific = [w for w in common if w not in GENERIC_NAME_WORDS]
            score += min(45, 15 * len(specific) + 5 * (len(common) - len(specific)))
            reasons.append("Name words: " + ", ".join(sorted(w.title() for w in common)))
        if score >= 30 and reasons:
            for r in reasons:
                suggest(c, score if r == reasons[0] else 0, r)

    ranked = sorted(
        suggestions.values(), key=lambda s: (-s["score"], s["visit_date"] or "", s["booking_id"])
    )[:MAX_SUGGESTIONS]
    if ranked:
        return MatchResult("suggested", suggestions=ranked)
    return MatchResult("none")



IMPORT_PLACEHOLDER_REF = "Imported from booking sheet"


def _absorb_import_placeholder(booking_id: int, amount: Decimal) -> dict | None:
    """Fold a bank credit into the deposit the sheet import recorded.

    The one-off import wrote a placeholder payment per booking for the deposit
    the old sheet said had been paid. When the bank later shows the real
    credit, that money must not count twice: the placeholder shrinks by the
    credit and disappears once the bank has accounted for all of it.
    Returns what was done, or None when there was no placeholder.
    """
    row = query_one(
        """
        SELECT id, amount FROM payments
        WHERE booking_id = %s AND bank_transaction_id IS NULL AND reference = %s
        ORDER BY id LIMIT 1
        """,
        (booking_id, IMPORT_PLACEHOLDER_REF),
    )
    if row is None:
        return None
    remaining = Decimal(str(row["amount"])) - amount
    if remaining <= 0:
        execute("DELETE FROM payments WHERE id = %s", (row["id"],))
        return {"payment_id": row["id"], "action": "removed", "was": float(row["amount"])}
    execute(
        "UPDATE payments SET amount = %s, note = %s WHERE id = %s",
        (remaining, "Remainder of the deposit recorded on the booking sheet", row["id"]),
    )
    return {"payment_id": row["id"], "action": "reduced", "was": float(row["amount"]), "now": float(remaining)}

# ------------------------------------------------------------------ actions ---

def confirm_match(
    tx_id: int,
    booking_id: int,
    actor: int | None = None,
    method: str = "manual",
) -> dict:
    """Record the credit as an EFT payment on the booking and mark it matched.

    Idempotent: a payment already linked to the transaction is reused. The
    bookings service confirms the booking when the deposit is covered; nothing
    here sends a message.
    """
    tx = bank_model.get(tx_id)
    if tx is None:
        raise BankError("Bank transaction not found", 404, "not_found")
    if tx["credit_debit"] != "CREDIT":
        raise BankError("Only credits can be matched to a booking", 422, "validation_error")
    if tx["match_status"] == "matched" and tx["matched_booking_id"] != booking_id:
        raise BankError(
            f"Already matched to booking {tx.get('booking_reference') or tx['matched_booking_id']}; "
            "unmatch it first",
            409,
            "conflict",
        )
    booking = query_one("SELECT id, reference, status FROM bookings WHERE id = %s", (booking_id,))
    if booking is None:
        raise BankError("Booking not found", 404, "not_found")

    amount = Decimal(str(tx["amount"]))
    existing = bank_model.payment_for_transaction(tx_id)
    if existing is not None and existing["booking_id"] != booking_id:
        raise BankError(
            "A payment for this bank transaction exists on another booking; unmatch it first",
            409,
            "conflict",
        )
    if existing is not None:
        payment = serialize_row(existing) or {}
    else:
        absorbed = _absorb_import_placeholder(booking_id, amount)
        payment = _record_payment(
            booking_id,
            amount=amount,
            paid_on=tx["booking_date"],
            reference=(tx.get("description") or tx.get("end_to_end_id") or "")[:120] or None,
            actor=actor,
            tx_id=tx_id,
        )

    bank_model.set_match(tx_id, "matched", booking_id, method, actor)
    _add_event(
        booking_id,
        "payment_matched",
        f"Bank credit of R{amount:.2f} on {tx['booking_date']} matched ({method})",
        {
            "bank_transaction_id": tx_id,
            "amount": float(amount),
            "booking_date": tx["booking_date"].isoformat(),
            "description": tx.get("description"),
            "method": method,
            "payment_id": payment.get("id") if payment else None,
            "placeholder_adjusted": absorbed if existing is None else None,
        },
        actor,
    )
    logger.info(
        f"Bank transaction {tx_id} (R{amount:.2f}) matched to booking "
        f"{booking['reference']} by {method}"
    )
    return payment


def unmatch(tx_id: int, actor: int | None = None) -> dict:
    """Remove the payment created by the match and return the credit to the queue.

    Also clears an ``ignored`` or ``suggested`` row back to ``unmatched``. The
    booking's status is left as it is: a booking confirmed by this deposit has
    no legal transition back (see the handoff).
    """
    tx = bank_model.get(tx_id)
    if tx is None:
        raise BankError("Bank transaction not found", 404, "not_found")
    booking_id = tx.get("matched_booking_id")
    payment = bank_model.payment_for_transaction(tx_id)
    if payment is not None:
        _delete_payment(payment, actor, tx_id)
        booking_id = booking_id or payment["booking_id"]
    bank_model.set_match(tx_id, "unmatched")
    if booking_id and tx["match_status"] == "matched":
        _add_event(
            booking_id,
            "payment_unmatched",
            f"Bank credit of R{Decimal(str(tx['amount'])):.2f} on {tx['booking_date']} unmatched",
            {"bank_transaction_id": tx_id, "payment_id": payment["id"] if payment else None},
            actor,
        )
    logger.info(f"Bank transaction {tx_id} unmatched (was {tx['match_status']})")
    return bank_model.serialize(bank_model.get(tx_id)) or {}


def ignore(tx_id: int, reason: str | None, actor: int | None = None) -> dict:
    tx = bank_model.get(tx_id)
    if tx is None:
        raise BankError("Bank transaction not found", 404, "not_found")
    if tx["match_status"] == "matched":
        raise BankError("Unmatch this transaction before ignoring it", 409, "conflict")
    reason = (reason or "").strip()[:255] or None
    bank_model.set_match(tx_id, "ignored", matched_by=actor, ignore_reason=reason)
    logger.info(f"Bank transaction {tx_id} ignored: {reason or '-'}")
    return bank_model.serialize(bank_model.get(tx_id)) or {}


def summary() -> dict:
    last = bank_model.last_poll()
    return {
        "counts": bank_model.status_counts(),
        "unmatched_credits_30d": bank_model.unmatched_credits_summary(30),
        "last_poll": (
            {
                "id": last["id"],
                "started_at": last["started_at"],
                "finished_at": last["finished_at"],
                "status": last["status"],
                "window_from": last["window_from"],
                "window_to": last["window_to"],
                "entries": last["entries"],
                "new_entries": last["new_entries"],
                "error": last.get("error"),
            }
            if last
            else None
        ),
    }


# ------------------------------------------------- bookings service bridge ---

def _booking_service():
    try:
        from src.services import booking as service

        return service
    except ImportError:  # pragma: no cover - only while the module is being built
        return None


def _record_payment(
    booking_id: int,
    *,
    amount: Decimal,
    paid_on: date,
    reference: str | None,
    actor: int | None,
    tx_id: int,
) -> dict:
    service = _booking_service()
    if service is not None:
        try:
            return service.record_payment(
                booking_id,
                "eft",
                amount,
                paid_on,
                reference,
                "Matched from FNB",
                actor,
                bank_transaction_id=tx_id,
            )
        except service.BookingError as exc:
            raise BankError(str(exc), 422, "validation_error") from exc
    # Fallback for a checkout without the bookings service: the row only.
    payment_id = execute(
        """
        INSERT INTO payments (booking_id, kind, amount, paid_on, reference, bank_transaction_id, note, recorded_by)
        VALUES (%s, 'eft', %s, %s, %s, %s, 'Matched from FNB', %s)
        """,
        (booking_id, amount, paid_on, reference, tx_id, actor),
    )
    return serialize_row(query_one("SELECT * FROM payments WHERE id = %s", (payment_id,))) or {}


def _delete_payment(payment: dict, actor: int | None, tx_id: int) -> None:
    """Delete a bank-linked payment directly: ``booking.delete_payment`` refuses them."""
    try:
        from src.models import payment as payment_model

        payment_model.delete(payment["id"])
    except ImportError:  # pragma: no cover
        execute("DELETE FROM payments WHERE id = %s", (payment["id"],))
    _add_event(
        payment["booking_id"],
        "payment_deleted",
        f"EFT payment of R{Decimal(str(payment['amount'])):.2f} removed (bank transaction unmatched)",
        {"payment": serialize_row(payment), "bank_transaction_id": tx_id},
        actor,
    )


def _add_event(booking_id: int, kind: str, summary_text: str, data: dict | None, actor: int | None) -> None:
    service = _booking_service()
    try:
        if service is not None:
            service.add_event(booking_id, kind, summary_text, data, actor)
        else:  # pragma: no cover
            execute(
                "INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id) VALUES (%s, %s, %s, %s, %s)",
                (booking_id, kind, summary_text[:255], dumps(data) if data else None, actor),
            )
    except Exception as exc:  # noqa: BLE001 - the timeline must never block the match
        logger.error(f"Could not write booking event {kind} for booking {booking_id}: {exc}")


# ------------------------------------------------------------------ helpers ---

def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _decimal_or_none(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except Exception:  # noqa: BLE001
        return None
