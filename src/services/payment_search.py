"""Find a booking's money among the polled bank credits.

The operating account carries the whole business, so there is no global
allocation queue: the automatic reference match (``bank.match_new``) takes
the credits that name a booking, and anything else is found from the booking
by reference, amount or date and allocated from there.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from src.models import bank_transaction as bank_model
from src.models import payment as payment_model
from src.models.base import query
from src.services import matching as mt
from src.utils.date import get_today

OVERPAY_LEEWAY = Decimal("1000")  # a credit may exceed the balance by this much
DEFAULT_TOLERANCE = Decimal("5.00")


def _d(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value).replace(",", "").replace("R", "").strip())
    except Exception:  # noqa: BLE001
        return None


def expected_amounts(booking: dict) -> dict[str, Decimal]:
    """The figures a customer is likely to have paid: deposit, balance, total."""
    from src.services.booking import booking_finance

    try:
        fin = booking_finance(booking)
    except Exception:  # noqa: BLE001
        fin = {}
    out: dict[str, Decimal] = {}
    for key, label in (("deposit_outstanding", "deposit"), ("deposit_due", "deposit"), ("due", "balance"), ("total", "total")):
        v = _d(fin.get(key)) if isinstance(fin, dict) else None
        if v and v > 0 and label not in out:
            out[label] = v
    return out


def search(
    booking: dict,
    *,
    reference: str | None = None,
    amount: Any = None,
    tolerance: Any = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 50,
) -> dict:
    """Credits that could belong to the booking. With no filters, a sensible
    default: the booking's reference and group words, and the expected amounts,
    since a week before the enquiry."""
    today = get_today()
    tol = _d(tolerance) or DEFAULT_TOLERANCE
    amt = _d(amount)
    explicit = bool(reference or amt or date_from or date_to)
    expected = expected_amounts(booking)
    since = date_from or ((booking.get("enquiry_date") or (booking["visit_date"] - timedelta(days=120))) - timedelta(days=7))
    until = date_to or today
    rows = query(
        """
        SELECT t.id, t.booking_date, t.value_date, t.amount, t.description, t.end_to_end_id, t.match_status,
               (SELECT p.booking_id FROM payments p WHERE p.bank_transaction_id = t.id LIMIT 1) AS booking_id
        FROM bank_transactions t
        WHERE t.credit_debit = 'CREDIT' AND t.booking_date BETWEEN %s AND %s
        ORDER BY t.booking_date DESC, t.id DESC
        """,
        (since, until),
    )
    doc = booking.get("doc_number")
    tokens = mt.distinctive_tokens(booking.get("group_name"))
    ref_words = set(mt.words(reference)) if reference else set()
    # Only credits that can still be matched: never one already on a booking
    # (this one included), never more than the outstanding balance plus a
    # little leeway for an overpayment (owner's rule, 29 Oct 2026).
    outstanding = expected.get("balance") or expected.get("total") or Decimal("0")
    cap = outstanding + OVERPAY_LEEWAY
    out: list[dict] = []
    for r in rows:
        if r.get("booking_id") is not None:
            continue
        desc = f"{r.get('description') or ''} {r.get('end_to_end_id') or ''}"
        hay = set(mt.words(desc))
        why: list[str] = []
        value = Decimal(str(r["amount"]))
        if value > cap:
            continue
        if doc and re.search(rf"(?<!\d){int(doc)}(?!\d)", desc):
            why.append("booking reference")
        if ref_words and all(mt.fuzzy_word_in(w, hay) or w in desc.lower() for w in ref_words):
            why.append(f"reference '{reference}'")
        if tokens and any(mt.fuzzy_word_in(t, hay) for t in tokens):
            why.append("group name")
        if amt is not None and abs(value - amt) <= tol:
            why.append(f"amount within R{tol:.0f} of R{amt:,.2f}")
        for label, exp in expected.items():
            if abs(value - exp) <= tol:
                why.append(f"equals the {label}")
                break
        if explicit:
            keep = (
                (amt is not None and abs(value - amt) <= tol)
                or (ref_words and any(w in desc.lower() for w in ref_words))
                or ((date_from or date_to) and not amt and not ref_words)
            )
        else:
            keep = bool(why)
        if keep:
            out.append({**bank_model.serialize(r), "why": why or ["in the date range"]})
        if len(out) >= limit:
            break
    return {
        "items": out,
        "total": len(out),
        "expected": {k: float(v) for k, v in expected.items()},
        "window": {"from": since.isoformat(), "to": until.isoformat()},
        "payments": [dict(p, amount=float(p["amount"])) for p in payment_model.list_for_booking(int(booking["id"]))],
    }


def allocate(tx_id: int, booking_id: int, actor: int | None, method: str = "search") -> dict:
    from src.services import bank

    return bank.confirm_match(int(tx_id), int(booking_id), actor=actor, method=method)
