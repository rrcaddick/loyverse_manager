"""Sending rules and the daily pass (6 Nov 2026).

Every send in the app is a button. A row on Settings › Sending rules can make
one automatic: the pass then performs exactly the click, through the same
action, so the outbound row, the activity line and the reminder bookkeeping
are the same as by hand. Three guardrails: the master switch is off until
flipped, the pass sends only on prod (`scripts/sending_pass.py`), and the
settings page shows what the next pass would send before a row is switched.

Expiry itself is automatic regardless of the rules: a pending booking whose
expiry date has passed without the deposit becomes Expired on the pass
(`expire_holds`). The expiry *notice* is the first send meant to go automatic.

A reply from an expired booking is a deposit extension request: Work lists it
(`work._extension_rows`) with "Extend deposit date", which brings the booking
back to Pending (`booking.update_booking` / the hold endpoint), and a deposit
arriving after expiry confirms it (`booking.record_payment`).
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from src.models.base import query
from src.services.settings import get_settings
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("sending")

# key, label, trigger in words, the booking action that performs it, extra data
RULES: tuple[dict[str, Any], ...] = (
    {"key": "expiry", "label": "Expiry notice", "trigger": "the expiry date has passed without the deposit", "action": "send-expiry", "data": {}},
    {"key": "reminder_still_interested", "label": "Still interested?", "trigger": "its reminder falls due", "action": "send-reminder", "data": {"kind": "still_interested"}},
    {"key": "reminder_deposit_reminder", "label": "Deposit reminder", "trigger": "its reminder falls due", "action": "send-reminder", "data": {"kind": "deposit_reminder"}},
    {"key": "reminder_final_details", "label": "Final details", "trigger": "its reminder falls due", "action": "send-reminder", "data": {"kind": "final_details"}},
    {"key": "payment_confirmation", "label": "Payment confirmation", "trigger": "a deposit confirms the booking", "action": "send-payment-confirmation", "data": {}},
    {"key": "ticket", "label": "Vehicle ticket (email)", "trigger": "the visit is this many days away", "action": "send-ticket-email", "data": {}, "parameter": "days_before"},
    {"key": "final_invoice", "label": "Final invoice", "trigger": "the arrivals have been counted", "action": "send-final-invoice", "data": {}},
)
RULE_BY_KEY = {r["key"]: r for r in RULES}
PAID_SQL = "(SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.booking_id = b.id)"
BOOKING_COLS = "b.id, b.reference, b.group_name, b.contact_email, b.visit_date, b.status, b.hold_expires_on, b.deposit_due, b.deposit_waived"


def config() -> dict:
    s = get_settings()["sending"]
    rules = dict(s.get("rules") or {})
    return {"enabled": bool(s.get("enabled")), "rules": rules}


def mode_of(key: str, cfg: dict | None = None) -> str:
    cfg = cfg or config()
    return str((cfg["rules"].get(key) or {}).get("mode") or "manual")


# ------------------------------------------------------------------ expiry

def expired_pending(today: date | None = None) -> list[dict]:
    """Pending bookings whose expiry date has passed with the deposit unpaid."""
    today = today or get_today()
    return query(
        f"""
        SELECT {BOOKING_COLS}, {PAID_SQL} AS paid_total FROM bookings b
        WHERE b.status = 'proforma_sent' AND b.hold_expires_on IS NOT NULL AND b.hold_expires_on < %s
          AND b.deposit_waived = 0 AND {PAID_SQL} < b.deposit_due
        ORDER BY b.hold_expires_on, b.id
        """,
        (today,),
    )


def expire_holds(today: date | None = None, actor: int | None = None) -> list[dict]:
    """Mark them Expired. Nothing is sent here; the notice is a rule."""
    from src.services import booking as booking_service

    today = today or get_today()
    out = []
    for b in expired_pending(today):
        try:
            booking_service.set_status(int(b["id"]), "lapsed", actor, reason=f"Deposit not received by {b['hold_expires_on']:%d %b %Y}")
            out.append({"booking_id": int(b["id"]), "reference": b["reference"], "group_name": b["group_name"]})
        except Exception as exc:  # noqa: BLE001 - one booking must not stop the pass
            logger.error(f"Could not expire {b['reference']}: {exc}")
    if out:
        logger.info(f"Expired {len(out)} booking(s): {', '.join(x['reference'] for x in out)}")
    return out


# -------------------------------------------------------------------- plan

def _cand(rule: dict, b: dict, reason: str, data: dict | None = None) -> dict:
    return {
        "rule": rule["key"],
        "action": rule["action"],
        "data": {**rule["data"], **(data or {})},
        "booking_id": int(b["id"]),
        "reference": b["reference"],
        "group_name": b["group_name"],
        "email": b.get("contact_email"),
        "reason": reason,
    }


def plan(today: date | None = None, cfg: dict | None = None) -> list[dict]:
    """What each rule would send today, whatever its mode. Each candidate
    names the booking action that performs it. Bookings without an address
    are listed with ``email`` None so the page can say so."""
    today = today or get_today()
    cfg = cfg or config()
    out: list[dict] = []

    # Expiry notice: expired recently (including by this pass), no notice yet.
    for b in query(
        f"""
        SELECT {BOOKING_COLS} FROM bookings b
        WHERE b.status = 'lapsed' AND b.lapsed_at >= %s
          AND NOT EXISTS (SELECT 1 FROM email_messages m WHERE m.booking_id = b.id AND m.direction = 'outbound' AND m.kind = 'expiry' AND (m.send_status IS NULL OR m.send_status <> 'failed'))
        ORDER BY b.lapsed_at, b.id
        """,
        (today - timedelta(days=7),),
    ):
        out.append(_cand(RULE_BY_KEY["expiry"], b, f"expired {b['hold_expires_on']:%d %b}" if b.get("hold_expires_on") else "expired"))
    # the bookings the pass is about to expire count too
    for b in expired_pending(today):
        out.append(_cand(RULE_BY_KEY["expiry"], b, f"expires on this pass ({b['hold_expires_on']:%d %b})"))

    # Reminders that fall due.
    for r in query(
        f"""
        SELECT {BOOKING_COLS}, r.kind, r.due_on FROM booking_reminders r JOIN bookings b ON b.id = r.booking_id
        WHERE r.status = 'due' AND r.stale = 0 AND r.due_on <= %s AND r.kind IN ('still_interested', 'deposit_reminder', 'final_details')
          AND b.status IN ('proforma_sent', 'confirmed')
        ORDER BY r.due_on, b.id
        """,
        (today,),
    ):
        rule = RULE_BY_KEY[f"reminder_{r['kind']}"]
        out.append(_cand(rule, r, f"due {r['due_on']:%d %b}"))

    # Payment confirmation: confirmed yesterday or today, none sent.
    for b in query(
        f"""
        SELECT {BOOKING_COLS}, b.confirmed_at FROM bookings b
        WHERE b.status IN ('confirmed', 'completed') AND b.confirmed_at >= %s
          AND NOT EXISTS (SELECT 1 FROM email_messages m WHERE m.booking_id = b.id AND m.direction = 'outbound' AND m.kind = 'payment_confirmation' AND (m.send_status IS NULL OR m.send_status <> 'failed'))
        ORDER BY b.confirmed_at, b.id
        """,
        (today - timedelta(days=1),),
    ):
        out.append(_cand(RULE_BY_KEY["payment_confirmation"], b, f"confirmed {b['confirmed_at']:%d %b}"))

    # Vehicle ticket by email, this many days before the visit.
    days_before = int((cfg["rules"].get("ticket") or {}).get("days_before") or 10)
    for b in query(
        f"""
        SELECT {BOOKING_COLS} FROM bookings b
        WHERE b.status = 'confirmed' AND b.ticket_sent_at IS NULL AND b.ticket_emailed_at IS NULL
          AND b.visit_date >= %s AND b.visit_date <= %s
        ORDER BY b.visit_date, b.id
        """,
        (today, today + timedelta(days=days_before)),
    ):
        out.append(_cand(RULE_BY_KEY["ticket"], b, f"visit {b['visit_date']:%d %b}"))

    # Final invoice once the arrivals are counted.
    for b in query(
        f"""
        SELECT {BOOKING_COLS}, b.arrived_count FROM bookings b
        WHERE b.status = 'completed' AND b.arrived_count IS NOT NULL AND b.final_invoice_sent_at IS NULL
        ORDER BY b.visit_date, b.id
        """
    ):
        out.append(_cand(RULE_BY_KEY["final_invoice"], b, f"{int(b['arrived_count'])} arrived"))
    return out


def preview(today: date | None = None) -> dict:
    """The settings page: each rule with its mode and what the next pass would send."""
    today = today or get_today()
    cfg = config()
    cands = plan(today, cfg)
    rules = []
    for r in RULES:
        mine = [c for c in cands if c["rule"] == r["key"]]
        stored = cfg["rules"].get(r["key"]) or {}
        rules.append(
            {
                "key": r["key"],
                "label": r["label"],
                "trigger": r["trigger"],
                "mode": str(stored.get("mode") or "manual"),
                "parameter": r.get("parameter"),
                "days_before": int(stored.get("days_before") or 10) if r.get("parameter") == "days_before" else None,
                "would_send": [{k: c[k] for k in ("booking_id", "reference", "group_name", "email", "reason")} for c in mine],
            }
        )
    return {
        "enabled": cfg["enabled"],
        "today": today.isoformat(),
        "would_expire": [{"booking_id": int(b["id"]), "reference": b["reference"], "group_name": b["group_name"], "hold_expires_on": b["hold_expires_on"].isoformat() if b.get("hold_expires_on") else None} for b in expired_pending(today)],
        "rules": rules,
    }


def money(value: Any) -> Decimal:
    return Decimal(str(value or 0))
