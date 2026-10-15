"""Group conversions: a car that paid public price without its group ticket is moved onto the
group later the same day (agreed with Ray 2026-10-15).

The terminal drives it (manager only): the group ticket is scanned, the receipt is named by its
slip QR or by the licence disc, the person entering is captured as at the entrance, and the
manager picks the Visitor quantity on Loyverse's own refund screen. Those units are the heads.
Before any money moves the terminal calls :meth:`PosConversionService.record`; the row it makes
is what waives the refund window on the terminal, so a refund outside the window is only ever
possible with a conversion behind it. The refund then runs, and the terminal closes a group
ticket for the heads (plate, person and "converted from" on it) so Loyverse's own group count
agrees with ours. Everything after the record arrives as ``group_conversion`` audit events and
moves :data:`STAGES`.

The group's invoice counts converted heads at the group rate (:meth:`heads_for_group`); the
public money goes back to the family, so no credit is ever applied (public and group prices
differ). Same day only; yesterday's receipts stay a refund dispute for the owner.
"""

from datetime import datetime, timedelta

from src.models.pos_conversions import PosGroupConversion
from src.models.pos_reentry import PosReentryData
from src.models.pos_staff import PosEmployeeEvent
from src.services.pos_items import ItemKinds
from src.services.pos_reentry import normalise_plate
from src.utils.logging import setup_logger

logger = setup_logger(__name__)

PUBLIC_CATEGORY = "Public"
STAGES = ("recorded", "refunded", "admitted", "refund_failed", "cancelled")
# a conversion in one of these still owns its receipt: a second record for the receipt is refused
ACTIVE_STAGES = ("recorded", "refunded", "admitted", "refund_failed")
# heads the group is invoiced for
COUNTED_STAGES = ("refunded", "admitted")


class ConversionRefused(ValueError):
    """The record was refused; the message is shown to the manager on the terminal."""


def _norm(text):
    return " ".join(str(text or "").split()).casefold()


def _rands(minor_units):
    try:
        return "R%.2f" % (int(minor_units) / 100)
    except (TypeError, ValueError):
        return "R?"


def _ms_to_dt(value):
    try:
        return datetime.fromtimestamp(int(value) / 1000) if value else None
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _str(value, limit):
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class PosConversionService:
    def __init__(self, kinds=None, data=None, now=None):
        self.kinds = kinds or ItemKinds.current()
        self.data = data or PosReentryData
        self._now = now

    def now(self):
        if callable(self._now):
            return self._now()
        return self._now or datetime.now()

    # ---- what a receipt holds ----------------------------------------------------------------

    def public_lines(self, lines):
        """Priced lines in the Public category: the only ones a conversion may refund."""
        out = []
        for line in lines or []:
            if not isinstance(line, dict) or line.get("voided"):
                continue
            if _norm(line.get("category")) != _norm(PUBLIC_CATEGORY):
                continue
            if self.kinds.is_reentry(line):
                continue
            try:
                if int(line.get("price") or 0) <= 0:
                    continue
            except (TypeError, ValueError):
                continue
            out.append(line)
        return out

    def public_heads(self, lines):
        return int(round(sum(self.kinds.quantity(l) for l in self.public_lines(lines))))

    @staticmethod
    def amount_paid(receipt):
        paid = 0
        for p in receipt.get("payments") or []:
            if isinstance(p, dict):
                paid += int(p.get("amount_paid") or 0) - int(p.get("change") or 0)
        return paid

    @staticmethod
    def payment_summary(receipt):
        parts = []
        for p in receipt.get("payments") or []:
            if not isinstance(p, dict):
                continue
            amount = int(p.get("amount_paid") or 0) - int(p.get("change") or 0)
            parts.append(f"{p.get('payment_type_name') or p.get('payment_method') or 'payment'} {_rands(amount)}")
        return ", ".join(parts)[:120]

    # ---- finding the receipt -----------------------------------------------------------------

    def _day(self, day):
        start = datetime.combine(day, datetime.min.time())
        return start, start + timedelta(days=1)

    def _refunded_ids(self, start, end):
        """Receipts a terminal refunded today (the refund audit event), conversions' own refunds aside."""
        ids = set()
        for evt in PosEmployeeEvent.since(start, ["refund"]):
            if evt["occurred_at"] >= end:
                continue
            detail = evt.get("detail") or {}
            if detail.get("conversion"):
                continue
            if detail.get("receipt_id"):
                ids.add(str(detail["receipt_id"]))
        return ids

    def candidates(self, plate=None, open_sync_id=None, receipt_id=None, day=None):
        """Today's closed sales matching the plate, the slip's sync id or the receipt id, with what
        a conversion needs to know about each: heads, money, and whether it may still be converted."""
        day = day or self.now().date()
        start, end = self._day(day)
        plate_n = normalise_plate(plate) if plate else None
        sync_id = _int(open_sync_id)
        refunded = self._refunded_ids(start, end)
        out = []
        for row in self.data.closed_receipts(start, end):
            receipt = row.get("receipt_json") or {}
            if not receipt:
                continue
            if receipt_id and str(receipt.get("receipt_id")) != str(receipt_id):
                continue
            if sync_id and _int(receipt.get("open_sync_id")) != sync_id:
                continue
            if plate_n and normalise_plate(receipt.get("name")) != plate_n:
                continue
            if not (receipt_id or sync_id or plate_n):
                continue
            heads = self.public_heads(receipt.get("items"))
            rid = str(receipt.get("receipt_id") or "")
            active = [c for c in PosGroupConversion.for_receipt(rid) if c["stage"] in ACTIVE_STAGES] if rid else []
            reason = None
            if heads <= 0:
                reason = "no paid Public admission on this receipt"
            elif rid in refunded:
                reason = "this receipt was refunded"
            elif active:
                c = active[0]
                reason = f"already converted to {c['group_name']} ({c['stage'].replace('_', ' ')})"
            out.append(
                {
                    "receipt_id": rid,
                    "printed_no": receipt.get("printed_no"),
                    "plate": receipt.get("name"),
                    "closed_at": receipt.get("closed_at"),
                    "employee_name": receipt.get("employee_name"),
                    "open_sync_id": receipt.get("open_sync_id"),
                    "heads": heads,
                    "amount": self.amount_paid(receipt),
                    "payment_summary": self.payment_summary(receipt),
                    "convertible": reason is None,
                    "reason": reason,
                    "conversion_id": active[0]["conversion_id"] if active else None,
                    "stage": active[0]["stage"] if active else None,
                }
            )
        out.sort(key=lambda r: r["closed_at"] or 0)
        return out

    def lookup(self, plate=None, open_sync_id=None):
        if not plate and not _int(open_sync_id):
            raise ConversionRefused("a plate or a slip is needed")
        rows = self.candidates(plate=plate, open_sync_id=open_sync_id)
        return {
            "receipts": [r for r in rows if r["convertible"]],
            "others": [{"printed_no": r["printed_no"], "closed_at": r["closed_at"], "reason": r["reason"]} for r in rows if not r["convertible"]],
        }

    # ---- the record: made before any money moves ---------------------------------------------

    def record(self, device, payload):
        """Validate and store a conversion. Idempotent on conversion_id (a retry after a failed
        refund sends the same one). Raises :class:`ConversionRefused` with a cashier-facing reason."""
        payload = payload or {}
        conversion_id = _str(payload.get("conversion_id"), 36)
        if not conversion_id or len(conversion_id) != 36:
            raise ConversionRefused("the terminal sent no conversion id")
        existing = PosGroupConversion.get(conversion_id)
        if existing:
            return existing
        receipt_id = _str(payload.get("receipt_id"), 40)
        if not receipt_id:
            raise ConversionRefused("the terminal sent no receipt")
        heads = _int(payload.get("heads")) or 0
        if heads <= 0:
            raise ConversionRefused("no Visitor units were chosen for the refund")
        group_name = _str(payload.get("group"), 120)
        if not group_name:
            raise ConversionRefused("no group was scanned")
        rows = self.candidates(receipt_id=receipt_id)
        if not rows:
            raise ConversionRefused("this receipt is not one of today's paid sales (yesterday's are a refund dispute)")
        receipt = rows[0]
        if not receipt["convertible"]:
            raise ConversionRefused(receipt["reason"])
        if heads > receipt["heads"]:
            raise ConversionRefused(f"only {receipt['heads']} Public admission(s) on this receipt")
        person = payload.get("person") or {}
        values = {
            "conversion_id": conversion_id,
            "device_id": device["device_id"],
            "employee_id": _int(payload.get("employee_id")),
            "employee_name": _str(payload.get("employee_name"), 100),
            "recorded_at": _ms_to_dt(payload.get("recorded_at")) or self.now(),
            "receipt_id": receipt_id,
            "printed_no": _str(payload.get("printed_no") or receipt["printed_no"], 32),
            "plate": _str(payload.get("plate") or receipt["plate"], 32),
            "sale_at": _ms_to_dt(receipt["closed_at"]),
            "sold_by": _str(receipt["employee_name"], 100),
            "group_name": group_name,
            "group_item_id": _int(payload.get("group_item_id")),
            "heads": heads,
            "amount_cents": _int(payload.get("amount_cents")) or 0,
            "payment_summary": _str(payload.get("payment_summary") or receipt["payment_summary"], 120),
            "person": _str(person.get("person") or person.get("name"), 120),
            "surname": _str(person.get("surname"), 80),
            "names": _str(person.get("names"), 120),
            "id_number": _str(person.get("id_number"), 16),
            "id_source": _str(person.get("source"), 16),
            "id_manual": 1 if person.get("manual") else 0,
            "stage": "recorded",
            "detail": payload,
        }
        PosGroupConversion.create(values)
        logger.info(
            f"conversion {conversion_id}: {values['plate']} receipt {values['printed_no']} -> {group_name}, "
            f"{heads} heads, {_rands(values['amount_cents'])} ({device['device_id']}, {values['employee_name']})"
        )
        return PosGroupConversion.get(conversion_id)

    # ---- what the terminal reports afterwards ------------------------------------------------

    def on_event(self, device_id, employee_id, employee_name, detail, occurred_at):
        """A ``group_conversion`` audit event: move the stage along. Unknown ids are logged, never
        created here (the record call is the only way in)."""
        detail = detail or {}
        conversion_id = _str(detail.get("conversion_id"), 36)
        stage = _str(detail.get("stage"), 16)
        if not conversion_id or stage not in STAGES:
            logger.error(f"group_conversion event without a usable id/stage: {detail}")
            return False
        row = PosGroupConversion.get(conversion_id)
        if row is None:
            logger.error(f"group_conversion event for unknown conversion {conversion_id} ({stage}) from {device_id}")
            return False
        values = {"stage": stage}
        if stage == "refunded":
            values["refund_receipt_no"] = _str(detail.get("refund_receipt_no"), 32)
            values["refunded_at"] = occurred_at
            values["error"] = None
        elif stage == "admitted":
            values["group_ticket_sync_id"] = _int(detail.get("group_ticket_sync_id"))
            values["group_receipt_no"] = _str(detail.get("group_receipt_no"), 32)
            values["admitted_at"] = occurred_at
        elif stage in ("refund_failed", "cancelled"):
            values["error"] = _str(detail.get("error"), 255)
        if row["stage"] == "admitted" and stage in ("recorded", "refunded"):
            values["stage"] = row["stage"]  # never step back from the end
        PosGroupConversion.update(conversion_id, values)
        return True

    # ---- reading -----------------------------------------------------------------------------

    @staticmethod
    def list(since=None, stages=None, group_name=None, limit=200):
        return PosGroupConversion.list(stages=stages, since=since, group_name=group_name, limit=limit)

    @staticmethod
    def get(conversion_id):
        return PosGroupConversion.get(conversion_id)

    @staticmethod
    def heads_for_group(group_name, day):
        """Converted heads the group is invoiced for on ``day`` (refund done, with or without the
        group ticket closed yet)."""
        start = datetime.combine(day, datetime.min.time())
        return PosGroupConversion.heads_for_group(group_name, start, start + timedelta(days=1), COUNTED_STAGES)
