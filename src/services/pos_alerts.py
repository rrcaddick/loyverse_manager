"""Alerts on reductions and voids of saved tickets.

Reductions are flagged rather than blocked: the money trail is already complete (every ticket
version, who changed it, the sale that followed and how it was paid), so a reduction by a role
that can take payments is reported the moment it arrives, and a cash sale that follows any
reduction (by anyone: a marshal's correction and a cashier's cash sale is the pairing to watch)
within ``follow_minutes`` is reported too. One such alert proves nothing; the pattern over weeks
does. Whole-ticket voids are blocked on the terminal for everyone but a Manager, so the rare
one that happens is reported as well.

Hooked from ``PosStaffService.record_events`` for every event the terminals upload. Sending
runs on a thread so the terminal's upload never waits on SMTP or WhatsApp.
"""

import threading
from datetime import timedelta

from config.settings import (
    POS_ALERT_EMAILS,
    POS_ALERT_WHATSAPP,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_SERVER,
    SMTP_TIMEOUT,
    SMTP_USE_SSL,
    SMTP_USERNAME,
)
from src.models.pos_staff import PosEmployee, PosEmployeeEvent, PosRole
from src.utils.logging import setup_logger

logger = setup_logger("pos_alerts")

CHARGING_PERMISSION = "ACCESS_ACCEPT_PAYMENTS"
REDUCTION_EVENTS = ("ticket_reduced", "ticket_replaced")
FOLLOW_MINUTES = 10
SUBJECT = "Farmyard POS: ticket reduced"
VOID_SUBJECT = "Farmyard POS: ticket voided"
REENTRY_SUBJECT = "Farmyard POS: re-entry flagged"
# Loyverse's reasons for deleting an open ticket; only a deliberate delete is a void.
VOID_REASONS = ("deleted_by_user",)


def _rands(minor_units):
    return f"R{int(minor_units or 0) / 100:.2f}"


def _quantity(thousandths):
    q = int(thousandths or 0) / 1000
    return str(int(q)) if q == int(q) else f"{q:g}"


class ReductionAlerts:
    """``consider`` returns the alert text sent for an event, or None when it needed none."""

    _default = None

    def __init__(self, emails=None, whatsapp=None, follow_minutes=FOLLOW_MINUTES, can_charge=None, events_since=None,
                 deliver=None):
        self.emails = list(emails or [])
        self.whatsapp = whatsapp or ""
        self.follow_minutes = follow_minutes
        self._can_charge = can_charge or self._role_can_charge
        self._events_since = events_since or PosEmployeeEvent.since
        self._deliver = deliver or self._send

    @classmethod
    def default(cls):
        """Recipients come only from POS_ALERT_EMAILS / POS_ALERT_WHATSAPP. Never the general
        notification list: staff audit alerts are for the owner, not the managers they concern."""
        if cls._default is None:
            cls._default = cls(POS_ALERT_EMAILS or [], POS_ALERT_WHATSAPP)
        return cls._default

    def enabled(self):
        return bool(self.emails or self.whatsapp)

    # ---- deciding ---------------------------------------------------------------------------

    def consider(self, device_id, employee_id, employee_name, event, detail, occurred_at):
        if not self.enabled():
            return None
        text = None
        subject = SUBJECT
        if event in REDUCTION_EVENTS:
            if self._can_charge(employee_id):
                text = self._reduction_text(device_id, employee_name, event, detail, occurred_at)
        elif event == "sale":
            text = self._cash_after_reduction_text(device_id, employee_name, detail, occurred_at)
        elif event == "ticket_voided":
            text = self._void_text(device_id, employee_name, detail, occurred_at)
            subject = VOID_SUBJECT
        elif event == "reentry_issued":
            text = self._reentry_text(device_id, employee_name, detail, occurred_at)
            subject = REENTRY_SUBJECT
        if text:
            self._deliver(subject, text)
        return text

    @staticmethod
    def _reentry_text(device_id, employee_name, detail, occurred_at):
        """Only the flagged passes: more heads than paid for (manager-approved), a typed plate,
        or an anchor with no countable heads. An ordinary pass is silent."""
        flags = detail.get("flags") or []
        if not flags:
            return None
        plate = detail.get("plate") or "unknown plate"
        heads = detail.get("heads")
        anchor = detail.get("anchor_heads")
        what = []
        if "over_anchor" in flags:
            what.append(f"{heads} heads against an admission for {anchor}")
        if "zero_count_anchor" in flags:
            what.append("an admission with no countable heads")
        if "typed_plate" in flags:
            what.append("a typed registration")
        approver = detail.get("approved_by_name")
        by = f"{employee_name or 'unknown'}" + (f", approved by {approver}'s PIN" if approver else "")
        return f"{by} issued a re-entry for {plate} at {occurred_at.strftime('%H:%M')} on {device_id}: {'; '.join(what)}."

    @staticmethod
    def _void_text(device_id, employee_name, detail, occurred_at):
        if str(detail.get("reason") or "") not in VOID_REASONS:
            return None
        ticket = detail.get("ticket") or f"sync {detail.get('sync_id')}"
        approver = detail.get("approved_by_name")
        by = f"{employee_name or 'unknown'}" + (f", approved by {approver}'s PIN" if approver else "")
        return f"{by} voided ticket {ticket} at {occurred_at.strftime('%H:%M')} on {device_id}."

    def _reduction_text(self, device_id, employee_name, event, detail, occurred_at):
        when = occurred_at.strftime("%H:%M")
        ticket = detail.get("ticket") or detail.get("plate") or f"sync {detail.get('sync_id')}"
        if event == "ticket_reduced":
            what = f"removed {_quantity(detail.get('quantity'))} x {detail.get('item')} from ticket {ticket}"
        else:
            what = f"replaced the items on ticket {ticket} with {detail.get('lines')} rung up"
        return (
            f"{employee_name or 'unknown'} (a role that takes payments) {what} at {when} on {device_id}. "
            f"Watch for a cash sale on this ticket in the next {self.follow_minutes} minutes."
        )

    def _cash_after_reduction_text(self, device_id, employee_name, detail, occurred_at):
        sync_id = detail.get("open_sync_id")
        payments = detail.get("payments") or []
        cash = [p for p in payments if str(p.get("payment_method") or "").upper() == "CASH"]
        if sync_id in (None, "") or not cash:
            return None
        since = occurred_at - timedelta(minutes=self.follow_minutes)
        reductions = [
            r for r in self._events_since(since, list(REDUCTION_EVENTS))
            if str((r.get("detail") or {}).get("sync_id")) == str(sync_id)
            and r["occurred_at"] <= occurred_at
        ]
        if not reductions:
            return None
        first = reductions[0]
        minutes = max(0, int((occurred_at - first["occurred_at"]).total_seconds() // 60))
        paid = sum(int(p.get("amount_paid") or 0) for p in cash)
        return (
            f"CASH SALE of {_rands(paid)} by {employee_name or 'unknown'} on {device_id} at {occurred_at.strftime('%H:%M')} "
            f"on ticket sync {sync_id}, {minutes} min after {first.get('employee_name') or 'unknown'} reduced it "
            f"({first['event'].replace('_', ' ')}). Receipt #{detail.get('printed_no')}."
        )

    @staticmethod
    def _role_can_charge(employee_id):
        if employee_id in (None, ""):
            return False
        employee = PosEmployee.get(int(employee_id))
        if not employee:
            return False
        role = PosRole.get(employee["role_id"])
        return bool(role) and CHARGING_PERMISSION in (role.get("permissions") or [])

    # ---- sending ----------------------------------------------------------------------------

    def _send(self, subject, text):
        threading.Thread(target=self._send_now, args=(subject, text), name="pos-alert", daemon=True).start()

    def _send_now(self, subject, text):
        logger.warning(f"POS alert: {text}")
        if self.emails:
            try:
                from src.services.notification import NoticifationService

                NoticifationService(
                    SMTP_SERVER, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_USERNAME,
                    use_ssl=SMTP_USE_SSL, timeout=SMTP_TIMEOUT,
                ).send_notification(self.emails, subject, text)
            except Exception as e:
                logger.error(f"POS alert e-mail failed: {e}")
        if self.whatsapp:
            try:
                from src.services.meta_whatsapp import MetaWhatsappService

                MetaWhatsappService().client.send_text(to=self.whatsapp, text=f"{subject}\n{text}")
            except Exception as e:
                logger.error(f"POS alert WhatsApp failed: {e}")
