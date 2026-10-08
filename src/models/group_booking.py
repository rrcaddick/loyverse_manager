"""Read-only adapter that presents a ``bookings`` row with the legacy
``GroupBooking`` attribute names.

The original ``group_bookings`` table is no longer written (migration 007
copied it into ``bookings``). The ticket PDF (``src/services/pdf.py``), the
Chatwoot WhatsApp send (``src/services/chatwoot.py``), the public ticket image
route and the morning inventory sync all still read ``group_name``,
``contact_person``, ``mobile_number``, ``visit_date`` and ``barcode`` from an
object of this class, so it stays. Writes go through ``src/services/booking.py``.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Mapping

import phonenumbers
from phonenumbers import NumberParseException

from src.models import booking as booking_model

# The morning sync only materialises bookings that are actually happening.
SYNC_STATUSES = ("confirmed", "completed")


class GroupBooking:
    def __init__(
        self,
        id: int | None = None,
        group_name: str | None = None,
        contact_person: str | None = None,
        mobile_number: str | None = None,
        visit_date: date | None = None,
        barcode: str | None = None,
        reference: str | None = None,
        status: str | None = None,
        people_booked: int | None = None,
        vehicles: int | None = None,
    ):
        self.id = id
        self.group_name = group_name
        self.contact_person = contact_person
        self.mobile_number = mobile_number
        self.visit_date = visit_date
        self.barcode = barcode
        self.reference = reference
        self.status = status
        self.people_booked = people_booked
        self.vehicles = vehicles

    # ------------------------------------------------------------ display --

    @property
    def mobile_number_display(self) -> str:
        """National format for display, e.g. ``082 123 4567``."""
        if not self.mobile_number:
            return ""
        try:
            parsed = phonenumbers.parse(str(self.mobile_number), "ZA")
        except NumberParseException:
            return str(self.mobile_number)
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.NATIONAL)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "group_name": self.group_name,
            "contact_person": self.contact_person,
            "mobile_number": self.mobile_number,
            "visit_date": self.visit_date,
            "barcode": self.barcode,
            "mobile_number_display": self.mobile_number_display,
            "reference": self.reference,
            "status": self.status,
            "people_booked": self.people_booked,
            "vehicles": self.vehicles,
        }

    # ------------------------------------------------------------ loading --

    @classmethod
    def from_row(cls, row: Mapping[str, Any] | None) -> "GroupBooking | None":
        """Build from a ``bookings`` row (legacy ``group_bookings`` keys also accepted)."""
        if row is None:
            return None
        return cls(
            id=row.get("id"),
            group_name=row.get("group_name"),
            contact_person=row.get("contact_name", row.get("contact_person")),
            mobile_number=row.get("contact_mobile", row.get("mobile_number")),
            visit_date=row.get("visit_date"),
            barcode=row.get("barcode"),
            reference=row.get("reference"),
            status=row.get("status"),
            people_booked=row.get("people_booked"),
            vehicles=row.get("vehicles"),
        )

    from_dict = from_row

    @classmethod
    def get_by_barcode(cls, barcode: str) -> "GroupBooking | None":
        return cls.from_row(booking_model.get_by_barcode(barcode))

    @classmethod
    def get_by_id(cls, booking_id: int) -> "GroupBooking | None":
        return cls.from_row(booking_model.get(booking_id))

    @classmethod
    def get_by_date(cls, visit_date: date) -> list["GroupBooking"]:
        """Confirmed (or completed) bookings visiting on ``visit_date``."""
        rows = booking_model.list_for_date(visit_date, SYNC_STATUSES)
        return [cls.from_row(r) for r in rows]
