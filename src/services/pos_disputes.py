"""Refund disputes: what a terminal could not refund, logged for the owner to investigate.

A dispute is created by the terminal (event ``refund_disputed``; ``PosStaffService.record_events``
hands it to :meth:`PosDisputeService.record`) and resolved here. The customer already holds a
printed slip with the dispute number. Nothing in this module moves money: an approved dispute
is paid out by EFT (or on the terminal that took the card payment) and then marked ``refunded``.

The owner's pages (and ``pos-staff disputes``) use :meth:`list`, :meth:`get`, :meth:`resolve`
and :meth:`reply`; they never touch ``pos_refund_disputes`` directly. These are owner-only: a
dispute carries the ticket's reduction and void history for that day, which managers must not see.
"""

from datetime import datetime, timedelta

from src.models.pos_disputes import PosRefundDispute
from src.utils.logging import setup_logger

logger = setup_logger(__name__)

STATUSES = ("open", "investigating", "approved", "declined", "refunded")
OPEN_STATUSES = ("open", "investigating", "approved")
REPLY_PROMISE = "reviewed personally, answer within 2 working days"


def _rands(cents):
    return "R%.2f" % (int(cents) / 100) if cents is not None else "R?"


class PosDisputeService:
    # ---- from the terminal -------------------------------------------------------------------

    @staticmethod
    def record(device_id, employee_id, employee_name, event_uuid, detail, occurred_at):
        """Mirror a ``refund_disputed`` event into pos_refund_disputes. Returns the dispute number,
        or None when the event was malformed (the audit row still exists either way)."""
        detail = detail or {}
        number = str(detail.get("dispute_number") or "").strip().upper()
        if not number:
            logger.error(f"refund_disputed event {event_uuid} without a dispute number")
            return None
        receipt = detail.get("receipt") or {}
        customer = detail.get("customer") or {}
        sale_at = receipt.get("closed_at")
        try:
            sale_at = datetime.fromtimestamp(int(sale_at) / 1000) if sale_at else None
        except (TypeError, ValueError, OverflowError):
            sale_at = None
        values = {
            "dispute_number": number[:16],
            "event_uuid": event_uuid,
            "device_id": device_id,
            "employee_id": employee_id,
            "employee_name": employee_name,
            "logged_at": occurred_at,
            "trigger_kind": str(detail.get("trigger") or "unknown")[:24],
            "refusal": str(detail.get("refusal") or "")[:255],
            "receipt_id": _str(receipt.get("receipt_id"), 40),
            "printed_no": _str(receipt.get("printed_no"), 32),
            "order_number": _str(receipt.get("order_number"), 32),
            "plate": _str(receipt.get("name"), 32),
            "sale_at": sale_at,
            "register": _str(receipt.get("register"), 64),
            "sold_by": _str(receipt.get("employee_name"), 100),
            "amount_cents": _int(receipt.get("amount")),
            "payment_summary": _str(receipt.get("payment_summary"), 120),
            "transaction_code": _str(receipt.get("transaction_code"), 64),
            "customer_name": _str(customer.get("name"), 100) or "",
            "customer_email": _str(customer.get("email"), 160) or "",
            "customer_mobile": _str(customer.get("mobile"), 32) or "",
            "reason": customer.get("reason"),
            "detail": detail,
        }
        PosRefundDispute.create(values)
        return values["dispute_number"]

    @staticmethod
    def alert_text(device_id, employee_name, detail, occurred_at):
        """One paragraph for the owner's alert channel (never the managers')."""
        receipt = detail.get("receipt") or {}
        customer = detail.get("customer") or {}
        return (
            f"Refund dispute {detail.get('dispute_number')} logged {occurred_at:%H:%M} on {device_id} by "
            f"{employee_name or '?'}: receipt {receipt.get('printed_no') or '?'} {receipt.get('name') or ''} "
            f"{_rands(receipt.get('amount'))} {receipt.get('payment_summary') or ''}, sold {_when(receipt.get('closed_at'))} "
            f"on {receipt.get('register') or '?'}. {detail.get('refusal') or ''}\n"
            f"Customer {customer.get('name') or '?'} ({customer.get('mobile') or '-'} / {customer.get('email') or '-'}): "
            f"\"{(customer.get('reason') or '').strip()}\""
        )

    # ---- for the owner -----------------------------------------------------------------------

    @staticmethod
    def list(open_only=True, since=None, limit=200):
        return PosRefundDispute.list(OPEN_STATUSES if open_only else None, since, limit)

    @classmethod
    def get(cls, dispute_number, with_history=True):
        """The dispute plus, when asked, every terminal event about that plate on the day of the
        sale (reductions, voids, re-entries, the sale, refunds): the investigation in one read."""
        row = PosRefundDispute.get(dispute_number.strip().upper())
        if row and with_history:
            row["history"] = cls.history(row)
        return row

    @staticmethod
    def history(dispute):
        plate = dispute.get("plate")
        when = dispute.get("sale_at") or dispute.get("logged_at")
        if not plate or not when:
            return []
        start = when.replace(hour=0, minute=0, second=0, microsecond=0)
        return PosRefundDispute.events_for_plate(plate, start, start + timedelta(days=1))

    @staticmethod
    def resolve(dispute_number, status, note=None, by=None):
        status = (status or "").strip().lower()
        if status not in STATUSES:
            raise ValueError(f"status must be one of {', '.join(STATUSES)}")
        fields = {"status": status}
        if note is not None:
            fields["resolution"] = note
        if status != "open":
            fields["resolved_by"] = by
            fields["resolved_at"] = datetime.now()
        if not PosRefundDispute.update(dispute_number.strip().upper(), **fields):
            raise LookupError(f"no dispute {dispute_number}")
        return PosRefundDispute.get(dispute_number.strip().upper())

    @staticmethod
    def reply(dispute_number, text, by=None, send=True):
        """Record the owner's answer and e-mail it to the customer when an address was given.
        WhatsApp needs an approved template outside a 24-hour customer window, so it is not sent
        from here; the mobile number is for the owner to use. Returns the channels used."""
        number = dispute_number.strip().upper()
        row = PosRefundDispute.get(number)
        if not row:
            raise LookupError(f"no dispute {number}")
        channels = []
        if send and row["customer_email"]:
            from config.settings import SMTP_PASSWORD, SMTP_PORT, SMTP_SERVER, SMTP_TIMEOUT, SMTP_USE_SSL, SMTP_USERNAME
            from src.services.notification import NoticifationService

            NoticifationService(
                SMTP_SERVER, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_USERNAME,
                use_ssl=SMTP_USE_SSL, timeout=SMTP_TIMEOUT,
            ).send_notification([row["customer_email"]], f"Your refund dispute {number}", text)
            channels.append("email")
        PosRefundDispute.update(number, reply=text, replied_at=datetime.now())
        logger.info(f"dispute {number} answered by {by or '?'} via {channels or 'record only'}")
        return channels


def _str(value, limit):
    if value in (None, ""):
        return None
    return str(value)[:limit]


def _int(value):
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _when(epoch_millis):
    try:
        return datetime.fromtimestamp(int(epoch_millis) / 1000).strftime("%H:%M")
    except (TypeError, ValueError, OverflowError):
        return "?"
