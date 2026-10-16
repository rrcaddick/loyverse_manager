"""Group payments: what a group paid, and the day behind it, keyed by the ticket's barcode.

A terminal only ever takes a group payment after scanning the group's ticket (there is no manual
choice, so a payment can always be traced to a ticket in someone's hand). The terminal reports
the stages as ``group_payment`` audit events; the ``paid`` one, with the closed receipt, is
mirrored into ``pos_group_payments``. Before charging, the terminal asks ``status`` for the day:
heads admitted under the ticket (the group's own R0 sales, which include the conversions), heads
converted, and what was paid already.
"""
import logging
from datetime import date, datetime, timedelta

from src.models.pos_group_payments import PosGroupPayment
from src.models.pos_reentry import PosReentryData
from src.services.pos_items import ItemKinds

logger = logging.getLogger(__name__)


def _str(value, limit):
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


class PosGroupPaymentService:
    def __init__(self, kinds=None, data=None, now=None):
        self.kinds = kinds or ItemKinds.current()
        self.data = data or PosReentryData
        self._now = now or datetime.now

    # ---- the day behind a ticket ----------------------------------------------------------------

    def status(self, barcode, group_name=None, day=None):
        """``{"barcode", "group_name", "visit_date", "heads_today", "heads_converted", "paid_today_cents", "payments"}``."""
        barcode = str(barcode or "").strip()
        day = day or self._now().date()
        start = datetime.combine(day, datetime.min.time())
        end = start + timedelta(days=1)
        booking = None
        try:
            from src.models.group_booking import GroupBooking

            booking = GroupBooking.get_by_barcode(barcode) if barcode else None
        except Exception as e:  # the booking is a nicety: the training account has none
            logger.warning(f"booking lookup for {barcode} failed: {e}")
        name = (getattr(booking, "group_name", None) or group_name or "").strip()
        visit = getattr(booking, "visit_date", None)
        heads = 0
        for row in self.data.closed_receipts(start, end):
            receipt = row.get("receipt_json") or {}
            for line in receipt.get("items") or []:
                if line.get("voided"):
                    continue
                sku = str(line.get("sku") or "").strip()
                if sku != barcode and not (name and str(line.get("name") or "").strip().lower() == name.lower()
                                          and str(line.get("category") or "").strip().lower() == self.kinds.groups_category.lower()):
                    continue
                heads += ItemKinds.heads(ItemKinds.quantity(line))
        converted = 0
        if name:
            try:
                from src.services.pos_conversions import PosConversionService

                converted = PosConversionService.heads_for_group(name, day)
            except Exception as e:
                logger.warning(f"converted heads for {name} failed: {e}")
        payments = PosGroupPayment.for_barcode(barcode, start, end) if barcode else []
        return {
            "barcode": barcode,
            "group_name": name,
            "visit_date": visit.isoformat() if hasattr(visit, "isoformat") else (str(visit) if visit else None),
            "heads_today": int(heads),
            "heads_converted": int(converted),
            "paid_today_cents": int(sum(p["amount_cents"] or 0 for p in payments)),
            "payments": [
                {"printed_no": p["printed_no"], "amount_cents": int(p["amount_cents"] or 0),
                 "payment_summary": p["payment_summary"], "at": p["paid_at"].isoformat(timespec="seconds")}
                for p in payments
            ],
        }

    # ---- from the terminal's audit events ---------------------------------------------------------

    @staticmethod
    def on_event(device_id, employee_id, employee_name, event_uuid, detail, occurred_at):
        """Mirror a ``group_payment`` event: only the paid stage makes a row."""
        detail = detail or {}
        if str(detail.get("stage") or "") != "paid":
            return False
        barcode = _str(detail.get("barcode"), 64)
        if not barcode:
            logger.error(f"paid group_payment event {event_uuid} without a barcode")
            return False
        values = {
            "event_uuid": event_uuid,
            "device_id": device_id,
            "employee_id": employee_id,
            "employee_name": employee_name,
            "barcode": barcode,
            "group_name": _str(detail.get("group"), 255) or "",
            "receipt_id": _str(detail.get("receipt_id"), 40),
            "printed_no": _str(detail.get("printed_no"), 32),
            "amount_cents": _int(detail.get("amount_cents")),
            "payment_summary": _str(detail.get("payment_summary"), 120),
            "paid_at": occurred_at,
            "detail": detail,
        }
        inserted = PosGroupPayment.create(values)
        if inserted:
            logger.info(f"group payment: {values['group_name']} ({barcode}) R{values['amount_cents'] / 100:.2f} on "
                        f"{values['printed_no']} ({values['payment_summary']}, {device_id}, {employee_name})")
        return inserted

    @staticmethod
    def list(since=None, limit=200):
        return PosGroupPayment.list(since=since, limit=limit)
