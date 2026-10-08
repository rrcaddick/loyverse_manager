"""Vehicle ticket delivery for a booking: PDF bytes for email, and the
WhatsApp template send through Chatwoot.

The WhatsApp path works by URL: Meta fetches the ticket image from the public
``groups.get_ticket_image`` route (5-minute JWT), so the app must be reachable
from the internet and ``send_ticket_whatsapp`` needs a Flask request or app
context to build that URL.
"""

from __future__ import annotations

from flask import url_for

from src.models import booking as booking_model
from src.models.group_booking import GroupBooking
from src.services import booking as booking_service
from src.services.messaging import get_messaging_service
from src.services.pdf import generate_ticket_pdf, get_ticket_image_bytes
from src.services.token import TokenService
from src.utils.logging import setup_logger

logger = setup_logger("tickets")


class TicketError(RuntimeError):
    """The ticket could not be sent (no mobile, Chatwoot failure, config)."""


def _adapter(booking_row: dict) -> GroupBooking:
    adapter = GroupBooking.from_row(booking_row)
    if adapter is None:
        raise TicketError("Booking not found")
    return adapter


def ticket_pdf_bytes(booking_row: dict) -> bytes:
    return generate_ticket_pdf(_adapter(booking_row))


def ticket_jpeg_bytes(booking_row: dict) -> bytes:
    return get_ticket_image_bytes(_adapter(booking_row))


def ticket_filename(booking_row: dict) -> str:
    return f"Vehicle ticket {booking_row.get('reference') or booking_row.get('barcode')}.pdf"


def ticket_image_url(barcode: str) -> str:
    """Public, tokenised image URL for the WhatsApp template header."""
    token = TokenService.generate_ticket_image_token(barcode)
    if isinstance(token, bytes):
        token = token.decode("ascii")
    return url_for("groups.get_ticket_image", barcode=barcode, token=token, _external=True)


def send_ticket_whatsapp(booking_id: int, actor: int | None) -> dict:
    """Send the ``group_vehicle_ticket_jpeg`` template to the booking's mobile.

    On success stamps ``ticket_sent_at`` and writes a ``ticket_sent`` event.
    Returns the Chatwoot result dict (conversation_id, message_id, ...).
    """
    row = booking_model.get(booking_id)
    if row is None:
        raise TicketError("Booking not found")
    mobile = row.get("contact_mobile")
    if not mobile:
        raise TicketError("The booking has no contact mobile number")

    try:
        service = get_messaging_service()
    except ValueError as exc:
        raise TicketError(str(exc)) from exc

    image_url = ticket_image_url(row["barcode"])
    inbox_id = service.default_inbox_id
    if isinstance(inbox_id, str) and inbox_id.isdigit():
        inbox_id = int(inbox_id)
    result = service.send_group_vehicle_ticket_jpeg(
        to_number=str(mobile),
        booking=_adapter(row),
        image_url=image_url,
        inbox_id=inbox_id,
    )
    if not result.get("success"):
        logger.error(f"WhatsApp ticket failed for {row['reference']}: {result.get('error')}")
        raise TicketError(result.get("error") or "Chatwoot did not accept the message")

    booking_service.stamp(booking_id, "ticket_sent_at")
    booking_service.add_event(
        booking_id,
        "ticket_sent",
        f"Vehicle ticket sent on WhatsApp to +{mobile}",
        {
            "channel": "whatsapp",
            "to": str(mobile),
            "conversation_id": result.get("conversation_id"),
            "message_id": result.get("message_id"),
        },
        actor,
    )
    logger.info(f"WhatsApp ticket sent for {row['reference']} to +{mobile}")
    return {
        "success": True,
        "conversation_id": result.get("conversation_id"),
        "message_id": result.get("message_id"),
        "to": str(mobile),
    }
