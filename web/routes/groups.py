"""Legacy ticket endpoints kept for the WhatsApp delivery path.

The booking UI itself moved to the React app and /api/v1/bookings. What stays
here are the three URLs other systems depend on:

- /group-bookings/ticket/image/<barcode>  Meta fetches this to render the
  WhatsApp template header. It has no session and never will; it is protected
  by its own 5-minute JWT instead (see TokenService). Gating it silently
  breaks ticket delivery.
- /group-bookings/ticket/<barcode> and /download/<barcode> serve the PDF to a
  signed-in user (both roles).
"""

from flask import Blueprint, Response, abort, make_response, request

from src.models.group_booking import GroupBooking
from src.services.pdf import generate_ticket_pdf, get_ticket_image_bytes
from src.services.token import TokenService
from src.utils.logging import setup_logger
from web.api import allow_manager

logger = setup_logger("groups_routes")
groups_bp = Blueprint("groups", __name__, url_prefix="/group-bookings")


@groups_bp.route("/ticket/<barcode>")
@allow_manager
def view_ticket(barcode):
    booking = GroupBooking.get_by_barcode(barcode)
    if not booking:
        abort(404)
    pdf_bytes = generate_ticket_pdf(booking)
    response = make_response(pdf_bytes)
    response.headers["Content-Type"] = "application/pdf"
    response.headers["Content-Disposition"] = f"inline; filename=ticket_{barcode}.pdf"
    return response


@groups_bp.route("/download/<barcode>")
@allow_manager
def download_ticket(barcode):
    booking = GroupBooking.get_by_barcode(barcode)
    if not booking:
        abort(404)
    pdf_bytes = generate_ticket_pdf(booking)
    response = make_response(pdf_bytes)
    response.headers["Content-Type"] = "application/pdf"
    response.headers["Content-Disposition"] = f"attachment; filename=ticket_{barcode}.pdf"
    return response


@groups_bp.route("/ticket/image/<barcode>")
def get_ticket_image(barcode: str):
    """Serve the ticket as JPEG for the WhatsApp template header (JWT protected, public)."""
    token = request.args.get("token")
    if not token:
        logger.warning(f"Ticket image request without token for barcode: {barcode}")
        abort(403)

    is_valid, error = TokenService.verify_ticket_image_token(token, barcode)
    if not is_valid:
        if error == "expired":
            logger.warning(f"Expired token for barcode: {barcode}")
            abort(410)
        logger.warning(f"Invalid token for barcode: {barcode}, error: {error}")
        abort(403)

    booking = GroupBooking.get_by_barcode(barcode)
    if not booking:
        logger.warning(f"Booking not found for barcode: {barcode}")
        abort(404)

    try:
        jpeg_bytes = get_ticket_image_bytes(booking)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Error generating ticket image for {barcode}: {exc}", exc_info=True)
        abort(500)

    response = Response(jpeg_bytes, mimetype="image/jpeg")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    logger.info(f"Served ticket image for barcode: {barcode}")
    return response
