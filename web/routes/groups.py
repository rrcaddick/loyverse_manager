from flask import (
    Blueprint,
    current_app,
    flash,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)

from src.utils.logging import setup_logger
from web.models.database import (
    create_group_booking,
    delete_group_booking,
    get_all_group_bookings,
    get_booking_by_barcode,
    get_booking_by_id,
    update_group_booking,
)
from web.services.barcode import generate_barcode
from web.services.pdf import generate_ticket_pdf
from web.services.whatsapp import WhatsAppService

logger = setup_logger("whatsapp_webhook")
groups_bp = Blueprint("groups", __name__, url_prefix="/group-bookings")


@groups_bp.route("/", methods=["GET", "POST"])
def manage_bookings():
    """Display form and table for group bookings"""
    if request.method == "POST":
        form_action = request.form.get("form_action", "create")
        group_name = request.form.get("group_name")
        contact_person = request.form.get("contact_person")
        mobile_number = request.form.get("mobile_number")
        visit_date = request.form.get("visit_date")

        # Validate required fields
        if not all([group_name, contact_person, mobile_number, visit_date]):
            flash("All fields are required!", "error")
            return redirect(url_for("groups.manage_bookings"))

        if form_action == "update":
            # UPDATE EXISTING BOOKING
            booking_id = request.form.get("booking_id")

            if not booking_id:
                flash("Booking ID is required for update!", "error")
                return redirect(url_for("groups.manage_bookings"))

            success = update_group_booking(
                booking_id, group_name, contact_person, mobile_number, visit_date
            )

            if success:
                flash(
                    f'Booking for "{group_name}" has been updated successfully!',
                    "success",
                )
            else:
                flash("Error updating booking", "error")

        else:
            # CREATE NEW BOOKING
            # Generate unique barcode
            barcode = generate_barcode()

            # Save to database
            booking_id = create_group_booking(
                group_name, contact_person, mobile_number, visit_date, barcode
            )

            if booking_id:
                flash(
                    f"Group booking created successfully! Barcode: {barcode}", "success"
                )
            else:
                flash("Error creating booking", "error")

        return redirect(url_for("groups.manage_bookings"))

    # Get all bookings for table display
    bookings = get_all_group_bookings()

    return render_template("group_bookings.html", bookings=bookings)


@groups_bp.route("/delete", methods=["POST"])
def delete_booking():
    """Delete a group booking"""
    booking_id = request.form.get("booking_id")

    if not booking_id:
        flash("Booking ID is required!", "error")
        return redirect(url_for("groups.manage_bookings"))

    # Get booking details before deletion for flash message
    booking = get_booking_by_id(booking_id)

    if not booking:
        flash("Booking not found!", "error")
        return redirect(url_for("groups.manage_bookings"))

    group_name = booking.get("group_name", "Unknown")

    # Delete the booking
    success = delete_group_booking(booking_id)

    if success:
        flash(f'Booking for "{group_name}" has been deleted successfully!', "success")
    else:
        flash("Error deleting booking", "error")

    return redirect(url_for("groups.manage_bookings"))


@groups_bp.route("/ticket/<barcode>")
def view_ticket(barcode):
    """View PDF ticket in browser"""
    booking = get_booking_by_barcode(barcode)

    if not booking:
        flash("Booking not found", "error")
        return redirect(url_for("groups.manage_bookings"))

    # Generate PDF in memory
    pdf_bytes = generate_ticket_pdf(booking)

    # Return PDF for browser viewing
    response = make_response(pdf_bytes)
    response.headers["Content-Type"] = "application/pdf"
    response.headers["Content-Disposition"] = f"inline; filename=ticket_{barcode}.pdf"

    return response


@groups_bp.route("/download/<barcode>")
def download_ticket(barcode):
    """Download PDF ticket"""
    booking = get_booking_by_barcode(barcode)

    if not booking:
        flash("Booking not found", "error")
        return redirect(url_for("groups.manage_bookings"))

    # Generate PDF in memory
    pdf_bytes = generate_ticket_pdf(booking)

    # Return PDF for download
    response = make_response(pdf_bytes)
    response.headers["Content-Type"] = "application/pdf"
    response.headers["Content-Disposition"] = (
        f"attachment; filename=ticket_{barcode}.pdf"
    )

    return response


@groups_bp.route("/webhook/whatsapp", methods=["GET", "POST"])
def whatsapp_webhook():
    """Handle incoming WhatsApp messages and send replies"""

    logger.info(f"=== WEBHOOK CALLED === Method: {request.method}")

    whatsapp_service = WhatsAppService()

    # GET request - Webhook verification
    if request.method == "GET":
        # Get verification parameters
        mode = request.args.get("hub.mode")
        token = request.args.get("hub.verify_token")
        challenge = request.args.get("hub.challenge")

        # Log for debugging
        logger.info("GET request - Webhook verification")
        logger.info(f"Mode: {mode}, Token: {token}, Challenge: {challenge}")
        logger.info(
            f"Expected token: {current_app.config.get('WHATSAPP_VERIFY_TOKEN')}"
        )

        # Check if we have the required parameters
        if mode and token:
            # Verify the token matches
            if mode == "subscribe" and token == current_app.config.get(
                "WHATSAPP_VERIFY_TOKEN"
            ):
                logger.info("✓ Verification successful!")
                return challenge, 200
            else:
                logger.error("✗ Verification failed - token mismatch")
                return "Forbidden", 403
        else:
            logger.error("✗ Verification failed - missing parameters")
            return "Bad Request", 400

    # POST request - Handle incoming messages
    if request.method == "POST":
        try:
            logger.info("POST request - Processing incoming webhook")

            # Get raw data first
            raw_data = request.get_data(as_text=True)
            logger.info(f"Raw webhook payload: {raw_data}")

            data = request.get_json()
            logger.info(f"Parsed JSON data: {json.dumps(data, indent=2)}")

            # Check webhook object type
            webhook_object = data.get("object")
            logger.info(f"Webhook object type: {webhook_object}")

            if webhook_object != "whatsapp_business_account":
                logger.warning(f"Unexpected webhook object: {webhook_object}")
                return jsonify(
                    {"status": "ignored", "reason": "not whatsapp_business_account"}
                ), 200

            # Check for entries
            entries = data.get("entry", [])
            logger.info(f"Number of entries: {len(entries)}")

            if not entries or len(entries) == 0:
                logger.warning("No entries in webhook")
                return jsonify({"status": "success", "reason": "no entries"}), 200

            # Process first entry
            entry = entries[0]
            logger.info(f"Processing entry: {json.dumps(entry, indent=2)}")

            changes = entry.get("changes", [])
            logger.info(f"Number of changes: {len(changes)}")

            if not changes or len(changes) == 0:
                logger.warning("No changes in entry")
                return jsonify({"status": "success", "reason": "no changes"}), 200

            # Process first change
            change = changes[0]
            logger.info(f"Processing change: {json.dumps(change, indent=2)}")

            value = change.get("value", {})
            field = change.get("field")
            logger.info(f"Change field: {field}")
            logger.info(f"Change value keys: {list(value.keys())}")

            # Check for messages
            messages = value.get("messages", [])
            logger.info(f"Number of messages: {len(messages)}")

            if not messages or len(messages) == 0:
                logger.info("No messages in webhook (might be status update)")

                # Check if it's a status update instead
                statuses = value.get("statuses", [])
                if statuses:
                    logger.info(f"This is a status update webhook: {statuses}")

                return jsonify({"status": "success", "reason": "no messages"}), 200

            # Process message
            message = messages[0]
            logger.info(f"Processing message: {json.dumps(message, indent=2)}")

            from_number = message.get("from")
            message_type = message.get("type")
            message_id = message.get("id")

            logger.info(f"From: {from_number}, Type: {message_type}, ID: {message_id}")

            # Get message body based on type
            message_body = ""
            if message_type == "text":
                message_body = message.get("text", {}).get("body", "")
            else:
                logger.warning(f"Unsupported message type: {message_type}")
                message_body = f"[{message_type} message]"

            logger.info(f"Message body: {message_body}")

            # Send a reply
            logger.info(f"Attempting to send reply to {from_number}")
            reply_text = f"Thanks for your message: '{message_body}'. We received it!"

            result = whatsapp_service.send_message(from_number, reply_text)
            logger.info(f"Send message result: {result}")

            return jsonify(
                {
                    "status": "success",
                    "message": "Reply sent",
                    "result": result,
                }
            ), 200

        except Exception as e:
            logger.error(f"ERROR processing webhook: {str(e)}", exc_info=True)
            # Still return 200 to prevent webhook retries
            return jsonify({"status": "error", "message": str(e)}), 200
