from flask import (
    Blueprint,
    Response,
    abort,
    flash,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)

from config.settings import (
    CHATWOOT_ACCOUNT_ID,
    CHATWOOT_API_TOKEN,
    CHATWOOT_INBOX_ID,
    CHATWOOT_URL,
)
from src.clients.chatwoot import ChatwootClient
from src.models.group_booking import GroupBooking
from src.services.chatwoot import ChatwootService
from src.services.pdf import generate_ticket_pdf, get_ticket_image_bytes
from src.services.token import TokenService
from src.utils.logging import setup_logger

logger = setup_logger("whatsapp_webhook")
groups_bp = Blueprint("groups", __name__, url_prefix="/group-bookings")


def get_booking_form_data(request):
    """Extract booking form data from request"""
    booking_id = request.form.get("booking_id")
    group_name = request.form.get("group_name")
    contact_person = request.form.get("contact_person")
    mobile_number = request.form.get("mobile_number")
    visit_date = request.form.get("visit_date")

    return booking_id, group_name, contact_person, mobile_number, visit_date


def get_messaging_service():
    """
    Factory function to get the configured messaging service.

    This makes it easy to switch between Chatwoot and direct Meta sending.
    Just change the implementation here without touching the rest of the code.

    Returns:
        Service instance with send_ticket() method
    """
    # Currently using Chatwoot - to switch to direct Meta, change this
    inbox_id = CHATWOOT_INBOX_ID

    if not inbox_id:
        raise ValueError("CHATWOOT_INBOX_ID not configured")

    client = ChatwootClient(
        base_url=CHATWOOT_URL,
        api_token=CHATWOOT_API_TOKEN,
        account_id=CHATWOOT_ACCOUNT_ID,
    )

    return ChatwootService(client=client, inbox_id=inbox_id)


messaging_service = get_messaging_service()


@groups_bp.route("/", methods=["GET"])
def manage_bookings():
    """Display form and table for group bookings"""

    return render_template("group_bookings.html", bookings=GroupBooking.get_formatted())


@groups_bp.route("/create", methods=["POST"])
def create():
    _, group_name, contact_person, mobile_number, visit_date = get_booking_form_data(
        request
    )

    try:
        booking = GroupBooking.create(
            group_name=group_name,
            contact_person=contact_person,
            mobile_number=mobile_number,
            visit_date=visit_date,
        )

        if booking.id:
            token = TokenService.generate_ticket_image_token(booking.barcode)

            image_url = url_for(
                "groups.get_ticket_image",
                barcode=booking.barcode,
                token=token,
                _external=True,
            )

            result = messaging_service.send_group_vehicle_ticket_jpeg(
                to_number=booking.mobile_number,
                booking=booking.to_dict(),
                image_url=image_url,
                inbox_id=CHATWOOT_INBOX_ID,
            )

            send_success = result.get("success", False)
            error = result.get("error")

            if send_success:
                flash(
                    f"Group booking created successfully! Barcode: {booking.barcode}. "
                    f"Ticket sent via WhatsApp to {booking.mobile_number}.",
                    "success",
                )
            else:
                flash(
                    f"Group booking created successfully! Barcode: {booking.barcode}. "
                    f"However, ticket could not be sent via WhatsApp: {error}. "
                    f"Please download and send manually.",
                    "warning",
                )
        else:
            flash("Error creating booking", "error")

    except ValueError as e:
        flash(str(e), "error")
        return render_template(
            "group_bookings.html", bookings=GroupBooking.get_formatted()
        ), 400

    return redirect(url_for("groups.manage_bookings"))


@groups_bp.route("/update", methods=["POST"])
def update():
    booking_id, group_name, contact_person, mobile_number, visit_date = (
        get_booking_form_data(request)
    )

    if not booking_id:
        flash("Booking ID is required for update!", "error")
        return render_template(
            "group_bookings.html", bookings=GroupBooking.get_formatted()
        ), 400

    existing_booking = GroupBooking.get_by_id(booking_id)
    if not existing_booking:
        flash("Booking not found!", "error")
        return render_template(
            "group_bookings.html", bookings=GroupBooking.get_formatted()
        ), 404

    try:
        requires_new_ticket = existing_booking.requires_new_ticket(
            group_name, visit_date, mobile_number
        )

        updated_booking = existing_booking.update(
            group_name=group_name,
            contact_person=contact_person,
            mobile_number=mobile_number,
            visit_date=visit_date,
        )

        if not updated_booking:
            flash("Error updating booking", "error")
            return redirect(url_for("groups.manage_bookings"))

        if requires_new_ticket:
            token = TokenService.generate_ticket_image_token(updated_booking.barcode)

            image_url = url_for(
                "groups.get_ticket_image",
                barcode=updated_booking.barcode,
                token=token,
                _external=True,
            )

            result = messaging_service.send_group_vehicle_ticket_jpeg(
                to_number=updated_booking.mobile_number,
                booking=updated_booking.to_dict(),
                image_url=image_url,
                inbox_id=CHATWOOT_INBOX_ID,
            )

            send_success = result.get("success", False)
            error = result.get("error")

            if send_success:
                flash(
                    f'Booking for "{group_name}" has been updated successfully! '
                    f"New ticket sent via WhatsApp to {updated_booking.mobile_number}.",
                    "success",
                )
            else:
                flash(
                    f'Booking for "{group_name}" has been updated successfully! '
                    f"However, the new ticket could not be sent via WhatsApp: {error}. "
                    f"Please download and send manually.",
                    "warning",
                )
        else:
            flash(
                f"Booking for {group_name} has been updated successfully",
                "success",
            )

    except ValueError as e:
        flash(str(e), "error")
        return render_template(
            "group_bookings.html", bookings=GroupBooking.get_formatted()
        ), 400

    return redirect(url_for("groups.manage_bookings"))


@groups_bp.route("/delete", methods=["POST"])
def delete_booking():
    """Delete a group booking"""
    booking_id = request.form.get("booking_id")

    if not booking_id:
        flash("Booking ID is required!", "error")
        return redirect(url_for("groups.manage_bookings"))

    booking = GroupBooking.get_by_id(booking_id)

    if not booking:
        flash("Booking not found!", "error")
        return redirect(url_for("groups.manage_bookings"))

    group_name = getattr(booking, "group_name", "Unknown")

    success = GroupBooking.delete(booking_id)

    if success:
        flash(f'Booking for "{group_name}" has been deleted successfully!', "success")
    else:
        flash("Error deleting booking", "error")

    return redirect(url_for("groups.manage_bookings"))


@groups_bp.route("/ticket/<barcode>")
def view_ticket(barcode):
    """View PDF ticket in browser"""
    booking = GroupBooking.get_by_barcode(barcode)

    if not booking:
        flash("Booking not found", "error")
        return redirect(url_for("groups.manage_bookings"))

    pdf_bytes = generate_ticket_pdf(booking.to_dict())

    response = make_response(pdf_bytes)
    response.headers["Content-Type"] = "application/pdf"
    response.headers["Content-Disposition"] = f"inline; filename=ticket_{barcode}.pdf"

    return response


@groups_bp.route("/download/<barcode>")
def download_ticket(barcode):
    """Download PDF ticket"""
    booking = GroupBooking.get_by_barcode(barcode)

    if not booking:
        flash("Booking not found", "error")
        return redirect(url_for("groups.manage_bookings"))

    pdf_bytes = generate_ticket_pdf(booking.to_dict())

    response = make_response(pdf_bytes)
    response.headers["Content-Type"] = "application/pdf"
    response.headers["Content-Disposition"] = (
        f"attachment; filename=ticket_{barcode}.pdf"
    )

    return response


@groups_bp.route("/ticket/image/<barcode>")
def get_ticket_image(barcode: str):
    """
    Serve ticket image with JWT token authentication

    This endpoint generates the ticket PDF on-demand, converts it to JPEG,
    and serves it. Access is controlled via short-lived JWT tokens.

    Args:
        barcode: The booking barcode from URL

    Query params:
        token: JWT token for authentication

    Returns:
        JPEG image or HTTP error (403, 410, 404)
    """
    token = request.args.get("token")

    if not token:
        logger.warning(f"Ticket image request without token for barcode: {barcode}")
        abort(403)

    # Verify JWT token
    is_valid, error = TokenService.verify_ticket_image_token(token, barcode)

    if not is_valid:
        if error == "expired":
            logger.warning(f"Expired token for barcode: {barcode}")
            abort(410)  # Gone - token expired
        elif error == "mismatch":
            logger.warning(f"Token barcode mismatch for barcode: {barcode}")
            abort(403)  # Forbidden - wrong barcode
        else:
            logger.warning(f"Invalid token for barcode: {barcode}, error: {error}")
            abort(403)  # Forbidden - invalid token

    # Fetch booking from database
    booking = GroupBooking.get_by_barcode(barcode)
    if not booking:
        logger.warning(f"Booking not found for barcode: {barcode}")
        abort(404)

    try:
        # Get ticket image bytes
        jpeg_bytes = get_ticket_image_bytes(booking.to_dict())

        # Serve image with no-cache headers
        response = Response(jpeg_bytes, mimetype="image/jpeg")
        response.headers["Cache-Control"] = (
            "no-store, no-cache, must-revalidate, max-age=0"
        )
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

        logger.info(f"Successfully served ticket image for barcode: {barcode}")
        return response

    except Exception as e:
        logger.error(
            f"Error generating ticket image for barcode {barcode}: {str(e)}",
            exc_info=True,
        )
        abort(500)


@groups_bp.route("/send-whatsapp", methods=["POST"])
def send_whatsapp_ticket():
    """Manually send ticket via WhatsApp"""
    try:
        data = request.get_json()
        barcode = data.get("barcode")

        if not barcode:
            return jsonify({"success": False, "error": "Barcode is required"}), 400

        booking = GroupBooking.get_by_barcode(barcode)

        if not booking:
            return jsonify({"success": False, "error": "Booking not found"}), 404

        token = TokenService.generate_ticket_image_token(barcode)

        image_url = url_for(
            "groups.get_ticket_image", barcode=barcode, token=token, _external=True
        )

        result = messaging_service.send_group_vehicle_ticket_jpeg(
            to_number=booking.mobile_number,
            booking=booking.to_dict(),
            image_url=image_url,
            inbox_id=CHATWOOT_INBOX_ID,
        )

        send_success = result.get("success", False)
        error = result.get("error")

        if send_success:
            logger.info(
                f"Manually sent WhatsApp ticket for barcode {barcode} to {booking.mobile_number}"
            )
            return jsonify(
                {
                    "success": True,
                    "message": f"Ticket sent successfully to {booking.mobile_number}",
                }
            ), 200
        else:
            logger.error(f"Failed to send WhatsApp ticket: {error}")
            return jsonify({"success": False, "error": error or "Unknown error"}), 500

    except Exception as e:
        logger.error(f"Exception in send_whatsapp_ticket: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
