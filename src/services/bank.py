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
           significant words with the description; top five, each carrying a
           confidence *sentence* ("Equals the deposit", "Part of the balance",
           ...) rather than a score, ordered by that sentence then by the
           nearest visit date. Exactly one top candidate is pre-selected;
           ties pre-select nothing.
none       everything else stays unmatched for an operator.
ignored    description rules (``bank_ignore_rules``) park recurring noise —
           own transfers, card settlements, interest — before matching runs.

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
# Scores below this never become a suggestion (they still rank by sentence).
SUGGESTION_THRESHOLD = 30

# Confidence sentences in rank order (docs/redesign-spec.md §8). ``tone`` is
# the colour the UI gives the sentence: green for "this is the money", grey
# for "plausible, look".
CONFIDENCE = {
    "equals_deposit": {"rank": 1, "sentence": "Equals the deposit", "tone": "green"},
    "equals_balance": {"rank": 2, "sentence": "Equals the balance", "tone": "green"},
    "part_of_balance": {"rank": 3, "sentence": "Part of the balance", "tone": "grey"},
    "exceeds_balance": {"rank": 4, "sentence": "Exceeds the balance", "tone": "grey"},
    "name_matches": {"rank": 5, "sentence": "Name matches", "tone": "grey"},
}

IGNORE_REASONS = bank_model.IGNORE_REASONS
IGNORE_REASON_LABELS = bank_model.IGNORE_REASON_LABELS
# Reasons that may become a description rule; "other" is always one-off.
RULE_REASONS = ("own_transfer", "card_settlement", "interest")
MAX_RULE_PATTERN = 120
MIN_RULE_PATTERN = 4
# Words after which a description turns into the payer's name or a reference.
RULE_STOP_AFTER = frozenset({"FROM", "TO", "REF", "FOR"})
MAX_RULE_WORDS = 5

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
    counts = {"checked": 0, "matched": 0, "suggested": 0, "unmatched": 0, "ignored": 0, "failed": 0}
    rows = bank_model.credits_to_match(since_days, statuses=("unmatched", "suggested"))
    candidates = bank_model.match_candidates()
    rules = bank_model.list_ignore_rules()
    for tx in rows:
        counts["checked"] += 1
        try:
            rule = matching_rule(tx.get("description"), rules)
            if rule is not None:
                _ignore_by_rule(tx, rule)
                counts["ignored"] += 1
                continue
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
    scores: dict[int, int] = {}
    name_only: set[int] = set()

    def suggest(c: dict, score: int, reason: str, *, by_name_only: bool = False) -> None:
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
                "reasons": [],
            }
            scores[c["id"]] = 0
        scores[c["id"]] = min(100, scores[c["id"]] + score)
        if by_name_only:
            name_only.add(c["id"])
        else:
            name_only.discard(c["id"])
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
        if c["id"] in suggestions:
            reason = reason or "found by reference"  # tier 1 already explains it: not name-only
        name_words = significant_words(f"{c.get('group_name') or ''} {c.get('contact_name') or ''}")
        common = words & name_words
        if len(common) >= 2:
            specific = [w for w in common if w not in GENERIC_NAME_WORDS]
            score += min(45, 15 * len(specific) + 5 * (len(common) - len(specific)))
            reasons.append("Name words: " + ", ".join(sorted(w.title() for w in common)))
        if score >= SUGGESTION_THRESHOLD and reasons:
            for r in reasons:
                suggest(c, score if r == reasons[0] else 0, r, by_name_only=reason is None)

    kept = [
        decorate_suggestion(entry, amount, name_only=entry["booking_id"] in name_only)
        for entry in suggestions.values()
        if scores[entry["booking_id"]] >= SUGGESTION_THRESHOLD
    ]
    ranked = rank_suggestions(kept, today)
    if ranked:
        return MatchResult("suggested", suggestions=ranked)
    return MatchResult("none")


# --------------------------------------------------------------- confidence ---

def confidence_for(amount: Decimal, fin: dict, *, name_only: bool = False) -> dict:
    """The sentence that describes how ``amount`` relates to the booking's money.

    ``name_only`` candidates (found by the payer's name, with an amount that
    neither equals the deposit nor the balance) read "Name matches": the
    arithmetic alone would say nothing useful about them.
    """
    deposit = Decimal(str(fin["deposit_due"]))
    balance = Decimal(str(fin["balance_due"]))
    if deposit > 0 and abs(amount - deposit) <= AMOUNT_TOLERANCE:
        key = "equals_deposit"
    elif balance > 0 and abs(amount - balance) <= AMOUNT_TOLERANCE:
        key = "equals_balance"
    elif name_only:
        key = "name_matches"
    elif amount < balance:
        key = "part_of_balance"
    else:
        key = "exceeds_balance"
    return {"key": key, **CONFIDENCE[key]}


def rands(value: Decimal | float | int) -> str:
    """R3 800 / R3 800.50: thin-space thousands, cents only when there are any."""
    amount = Decimal(str(value)).quantize(Decimal("0.01"))
    whole, _, frac = f"{abs(amount):.2f}".partition(".")
    grouped = f"{int(whole):,}".replace(",", "\u00a0")  # the same NBSP documents.money uses
    text = f"R{grouped}" + (f".{frac}" if frac != "00" else "")
    return ("\u2212" if amount < 0 else "") + text


def arithmetic_line(amount: Decimal, fin: dict) -> str:
    """One line of arithmetic for the proposal card: ``R3 800 = deposit · R0 paid · R11 400 total``."""
    deposit = Decimal(str(fin["deposit_due"]))
    balance = Decimal(str(fin["balance_due"]))
    paid = Decimal(str(fin["paid_total"]))
    total = Decimal(str(fin["total_amount"]))
    if deposit > 0 and abs(amount - deposit) <= AMOUNT_TOLERANCE:
        head = f"{rands(amount)} = deposit"
    elif balance > 0 and abs(amount - balance) <= AMOUNT_TOLERANCE:
        head = f"{rands(amount)} = balance"
    elif balance > 0:
        head = f"{rands(amount)} of {rands(balance)} balance"
    else:
        head = rands(amount)
    return f"{head} · {rands(paid)} paid · {rands(total)} total"


def decorate_suggestion(entry: dict, amount: Decimal, *, name_only: bool = False) -> dict:
    """Attach the confidence sentence, its tone and the arithmetic line."""
    fin = {
        "deposit_due": entry["deposit_due"],
        "balance_due": entry["balance_due"],
        "paid_total": entry["paid_total"],
        "total_amount": entry["total_amount"],
    }
    conf = confidence_for(amount, fin, name_only=name_only)
    return {
        **entry,
        "confidence": conf["sentence"],
        "confidence_key": conf["key"],
        "tone": conf["tone"],
        "rank": conf["rank"],
        "arithmetic": arithmetic_line(amount, fin),
        "preselected": False,
    }


def rank_suggestions(suggestions: list[dict], today: date | None = None) -> list[dict]:
    """Order by sentence rank, then the visit date nearest today, then id; cut
    to five; pre-select the first only when it is alone at the top rank."""
    today = today or get_today()

    def distance(entry: dict) -> int:
        visit = _parse_date(entry.get("visit_date"))
        return abs((visit - today).days) if visit else 10_000

    ranked = sorted(suggestions, key=lambda e: (e["rank"], distance(e), e["booking_id"]))[:MAX_SUGGESTIONS]
    for entry in ranked:
        entry["preselected"] = False
    if ranked:
        top = [e for e in ranked if e["rank"] == ranked[0]["rank"]]
        if len(top) == 1:
            top[0]["preselected"] = True
    return ranked


# ------------------------------------------------------------- ignore rules ---

def derive_rule_pattern(description: str | None) -> str | None:
    """The significant prefix of a bank description, for a description rule.

    ``FNB APP TRANSFER FROM RAY`` → ``FNB APP TRANSFER FROM`` (stops after
    FROM/TO/REF/FOR, where the payer's name or a reference starts);
    ``ADDPAY-PSP31240029671426092600`` → ``ADDPAY-PSP`` (a token is cut at its
    first digit); ``NETCASH161CPP:THE FARMYARD`` → ``NETCASH``; at most five
    words. None when nothing usable is left.
    """
    words = (description or "").split()
    prefix: list[str] = []
    for word in words:
        if any(ch.isdigit() for ch in word):
            head = ""
            for ch in word:
                if ch.isdigit():
                    break
                head += ch
            head = head.rstrip("-/:_.,")
            if len(head) >= 3:
                prefix.append(head)
            break
        prefix.append(word)
        if word.upper() in RULE_STOP_AFTER or len(prefix) >= MAX_RULE_WORDS:
            break
    pattern = " ".join(prefix).strip()
    if len(pattern) < MIN_RULE_PATTERN:
        pattern = " ".join(words).strip()
    pattern = pattern[:MAX_RULE_PATTERN].strip()
    return pattern or None


def matching_rule(description: str | None, rules: list[dict]) -> dict | None:
    """The first rule whose pattern the description starts with (case-insensitive)."""
    text = (description or "").strip().upper()
    if not text:
        return None
    for rule in rules:
        pattern = str(rule.get("pattern") or "").strip().upper()
        if pattern and text.startswith(pattern):
            return rule
    return None


def _ignore_by_rule(tx: dict, rule: dict) -> None:
    reason = bank_model.format_ignore_reason(
        str(rule["reason"]), f"rule: {rule['pattern']}"
    )
    bank_model.set_match(tx["id"], "ignored", ignore_reason=reason)
    logger.info(f"Bank transaction {tx['id']} ignored by rule {rule['id']} ({rule['pattern']})")


def create_ignore_rule(
    pattern: str,
    reason: str,
    note: str | None = None,
    actor: int | None = None,
    *,
    apply: bool = True,
) -> dict:
    """Store a description rule and park every queued credit it already covers.

    Returns ``{"rule", "created", "applied"}`` where ``applied`` is the number
    of unmatched/suggested credits ignored right away.
    """
    pattern = " ".join(str(pattern or "").split())[:MAX_RULE_PATTERN].strip()
    if len(pattern) < MIN_RULE_PATTERN:
        raise BankError(
            f"A rule pattern needs at least {MIN_RULE_PATTERN} characters", 422, "validation_error"
        )
    if reason not in RULE_REASONS:
        raise BankError(
            "Only own transfers, card settlements and interest become rules", 422, "validation_error"
        )
    note = (note or "").strip()[:255] or None
    rule, created = bank_model.insert_ignore_rule(pattern, reason, note, actor)
    applied = 0
    if apply:
        for tx in bank_model.credits_for_rule(pattern):
            _ignore_by_rule(tx, rule)
            applied += 1
    logger.info(
        f"Bank ignore rule {'created' if created else 'exists'}: '{pattern}' ({reason}), "
        f"{applied} queued credits ignored"
    )
    return {"rule": rule, "created": created, "applied": applied}


def list_ignore_rules() -> list[dict]:
    return bank_model.list_ignore_rules()


def delete_ignore_rule(rule_id: int) -> dict:
    """Remove a rule. Rows it already ignored stay ignored (unmatch them one by one)."""
    rule = bank_model.get_ignore_rule(rule_id)
    if rule is None:
        raise BankError("Ignore rule not found", 404, "not_found")
    bank_model.delete_ignore_rule(rule_id)
    logger.info(f"Bank ignore rule {rule_id} deleted ('{rule['pattern']}')")
    return rule



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

    Also clears an ``ignored`` or ``suggested`` row back to ``unmatched``. A
    booking that this deposit had confirmed goes back to ``proforma_sent``
    when the remaining payments no longer cover the deposit; the serialized
    transaction carries ``booking_reverted`` so the UI can say so.
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
    reverted: dict | None = None
    if booking_id and tx["match_status"] == "matched":
        _add_event(
            booking_id,
            "payment_unmatched",
            f"Bank credit of R{Decimal(str(tx['amount'])):.2f} on {tx['booking_date']} unmatched",
            {"bank_transaction_id": tx_id, "payment_id": payment["id"] if payment else None},
            actor,
        )
        reverted = _revert_if_uncovered(booking_id, actor)
    logger.info(f"Bank transaction {tx_id} unmatched (was {tx['match_status']})")
    out = bank_model.serialize(bank_model.get(tx_id)) or {}
    out["booking_reverted"] = reverted
    return out


def _revert_if_uncovered(booking_id: int, actor: int | None) -> dict | None:
    """confirmed → proforma_sent when Σ payments no longer covers the deposit."""
    booking = query_one(
        """
        SELECT b.id, b.reference, b.status, b.deposit_due, b.deposit_waived,
               COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id), 0) AS paid_total
        FROM bookings b WHERE b.id = %s
        """,
        (booking_id,),
    )
    if booking is None or booking["status"] != "confirmed" or booking["deposit_waived"]:
        return None
    deposit = Decimal(str(booking["deposit_due"] or 0))
    paid = Decimal(str(booking["paid_total"] or 0))
    if deposit <= 0 or paid >= deposit:
        return None
    service = _booking_service()
    try:
        if service is not None:
            service.set_status(booking_id, "proforma_sent", actor, reason="Payment unmatched")
        else:  # pragma: no cover
            execute(
                "UPDATE bookings SET status = 'proforma_sent', confirmed_at = NULL WHERE id = %s",
                (booking_id,),
            )
    except Exception as exc:  # noqa: BLE001 - the unmatch itself has happened; say why the revert did not
        logger.error(f"Could not revert booking {booking_id} after unmatch: {exc}")
        return None
    logger.info(
        f"Booking {booking['reference']} reverted to proforma_sent: deposit R{deposit:.2f} "
        f"no longer covered (R{paid:.2f} paid)"
    )
    return {
        "id": booking_id,
        "reference": booking["reference"],
        "from": "confirmed",
        "to": "proforma_sent",
        "deposit_due": float(deposit),
        "paid_total": float(paid),
    }


def ignore(
    tx_id: int,
    reason: str | None,
    actor: int | None = None,
    *,
    note: str | None = None,
    create_rule: bool = False,
    pattern: str | None = None,
) -> dict:
    """Park a credit. ``reason`` is one of ``IGNORE_REASONS`` (free text is
    kept as "other" with the text as the note). With ``create_rule`` the
    description's significant prefix (or ``pattern``) becomes a rule that
    ignores every later entry starting with it; the serialized transaction
    carries ``rule`` (``{"rule", "created", "applied"}``) when one was made.
    """
    tx = bank_model.get(tx_id)
    if tx is None:
        raise BankError("Bank transaction not found", 404, "not_found")
    if tx["match_status"] == "matched":
        raise BankError("Unmatch this transaction before ignoring it", 409, "conflict")
    code = (reason or "").strip()
    if code not in IGNORE_REASONS:
        note = code or note
        code = "other"
    stored = bank_model.format_ignore_reason(code, note)
    bank_model.set_match(tx_id, "ignored", matched_by=actor, ignore_reason=stored)
    logger.info(f"Bank transaction {tx_id} ignored: {stored}")
    rule_result: dict | None = None
    if create_rule and code in RULE_REASONS:
        rule_pattern = pattern or derive_rule_pattern(tx.get("description"))
        if rule_pattern:
            rule_result = create_ignore_rule(rule_pattern, code, note, actor)
    out = bank_model.serialize(bank_model.get(tx_id)) or {}
    out["rule"] = rule_result
    return out


def summary() -> dict:
    """The Bank page's one summary line: ``needs_attention`` = suggested credits
    + unmatched credits of the last 30 days; ``last_poll`` keeps its shape."""
    last = bank_model.last_poll()
    unmatched_30d = bank_model.unmatched_credits_summary(30)
    to_confirm = bank_model.suggested_credit_count()
    return {
        "counts": bank_model.status_counts(),
        "to_confirm": to_confirm,
        "unmatched_credits_30d": unmatched_30d,
        "needs_attention": to_confirm + int(unmatched_30d["count"]),
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
