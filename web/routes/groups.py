import json

import phonenumbers
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
from phonenumbers import NumberParseException

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
            bookings = get_all_group_bookings()
            return render_template("group_bookings.html", bookings=bookings), 400

        # --- PHONE NORMALISATION + VALIDATION ---
        try:
            parsed = phonenumbers.parse(mobile_number, "ZA")

            if not phonenumbers.is_valid_number(parsed):
                flash("Please enter a valid mobile number.", "error")
                bookings = get_all_group_bookings()
                return render_template("group_bookings.html", bookings=bookings), 400

            # store digits-only format for WhatsApp & DB, e.g. "27821234567"
            normalized_mobile_number = phonenumbers.format_number(
                parsed, phonenumbers.PhoneNumberFormat.E164
            ).replace("+", "")

        except NumberParseException:
            flash("Please enter a valid mobile number.", "error")
            bookings = get_all_group_bookings()
            return render_template("group_bookings.html", bookings=bookings), 400

        if form_action == "update":
            # UPDATE EXISTING BOOKING
            booking_id = request.form.get("booking_id")

            if not booking_id:
                flash("Booking ID is required for update!", "error")
                bookings = get_all_group_bookings()
                return render_template("group_bookings.html", bookings=bookings), 400

            success = update_group_booking(
                booking_id,
                group_name,
                contact_person,
                normalized_mobile_number,
                visit_date,
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
                group_name,
                contact_person,
                normalized_mobile_number,
                visit_date,
                barcode,
            )

            if booking_id:
                # Get the complete booking data
                booking = get_booking_by_barcode(barcode)

                # Generate PDF ticket
                pdf_bytes = generate_ticket_pdf(booking)

                # Send ticket via WhatsApp
                try:
                    whatsapp_service = WhatsAppService()

                    logger.info(
                        f"Attempting to send WhatsApp ticket to {normalized_mobile_number}"
                    )

                    result = whatsapp_service.send_ticket(
                        normalized_mobile_number, booking, pdf_bytes
                    )

                    if result.get("success"):
                        logger.info(
                            f"WhatsApp ticket sent successfully to {normalized_mobile_number}"
                        )
                        flash(
                            f"Group booking created successfully! Barcode: {barcode}. "
                            f"Ticket sent via WhatsApp to {normalized_mobile_number}.",
                            "success",
                        )
                    else:
                        logger.error(
                            f"Failed to send WhatsApp ticket: {result.get('error')}"
                        )
                        flash(
                            f"Group booking created successfully! Barcode: {barcode}. "
                            f"However, ticket could not be sent via WhatsApp: {result.get('error')}. "
                            f"Please download and send manually.",
                            "warning",
                        )

                except Exception as e:
                    logger.error(
                        f"Exception sending WhatsApp ticket: {str(e)}", exc_info=True
                    )
                    flash(
                        f"Group booking created successfully! Barcode: {barcode}. "
                        f"However, there was an error sending via WhatsApp: {str(e)}. "
                        f"Please download and send manually.",
                        "warning",
                    )
            else:
                flash("Error creating booking", "error")

        # On success, PRG redirect
        return redirect(url_for("groups.manage_bookings"))

    # GET: initial load
    bookings = [
        {
            **booking,
            "mobile_number_display": (
                phonenumbers.format_number(
                    phonenumbers.parse(booking["mobile_number"], "ZA"),
                    phonenumbers.PhoneNumberFormat.NATIONAL,
                )
                if booking.get("mobile_number")
                else ""
            ),
        }
        for booking in get_all_group_bookings()
    ]

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


@groups_bp.route("/test_whatsapp", methods=["GET"])
def whatsapp_test():
    """Enhanced test route to send a full ticket with PDF attachment"""
    try:
        whatsapp_service = WhatsAppService()

        # Test number
        test_number = "27763635909"  # Ray Caddick

        # Create a sample booking for testing
        test_booking = {
            "group_name": "Test Group WhatsApp",
            "visit_date": "2025-12-25",
            "barcode": "TEST123456789",
            "contact_person": "Test Contact",
            "mobile_number": test_number,
        }

        # Generate test PDF
        pdf_bytes = generate_ticket_pdf(test_booking)

        logger.info(f"Generated test PDF, size: {len(pdf_bytes)} bytes")

        # Send full ticket with attachment
        result = whatsapp_service.send_ticket(test_number, test_booking, pdf_bytes)

        if result.get("success"):
            return jsonify(
                {
                    "status": "success",
                    "message": "Test ticket sent successfully with PDF attachment",
                    "result": result,
                    "test_booking": test_booking,
                }
            ), 200
        else:
            return jsonify(
                {
                    "status": "error",
                    "message": "Failed to send test ticket",
                    "error": result.get("error"),
                    "result": result,
                }
            ), 500

    except Exception as e:
        logger.error(f"Error in test_whatsapp: {str(e)}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@groups_bp.route("/send-whatsapp", methods=["POST"])
def send_whatsapp_ticket():
    """Manually send ticket via WhatsApp"""
    try:
        data = request.get_json()
        barcode = data.get("barcode")

        if not barcode:
            return jsonify({"success": False, "error": "Barcode is required"}), 400

        # Get booking details
        booking = get_booking_by_barcode(barcode)

        if not booking:
            return jsonify({"success": False, "error": "Booking not found"}), 404

        # Generate PDF ticket
        pdf_bytes = generate_ticket_pdf(booking)

        # Mobile number is already normalised when saved
        mobile_number = booking["mobile_number"]

        # Send via WhatsApp
        whatsapp_service = WhatsAppService()
        result = whatsapp_service.send_ticket(mobile_number, booking, pdf_bytes)

        if result.get("success"):
            logger.info(
                f"Manually sent WhatsApp ticket for barcode {barcode} to {mobile_number}"
            )
            return jsonify(
                {
                    "success": True,
                    "message": f"Ticket sent successfully to {mobile_number}",
                }
            ), 200
        else:
            logger.error(f"Failed to send WhatsApp ticket: {result.get('error')}")
            return jsonify(
                {"success": False, "error": result.get("error", "Unknown error")}
            ), 500

    except Exception as e:
        logger.error(f"Exception in send_whatsapp_ticket: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


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

        if mode and token:
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

            raw_data = request.get_data(as_text=True)
            logger.info(f"Raw webhook payload: {raw_data}")

            data = request.get_json()
            logger.info(f"Parsed JSON data: {json.dumps(data, indent=2)}")

            webhook_object = data.get("object")
            logger.info(f"Webhook object type: {webhook_object}")

            if webhook_object != "whatsapp_business_account":
                logger.warning(f"Unexpected webhook object: {webhook_object}")
                return jsonify(
                    {"status": "ignored", "reason": "not whatsapp_business_account"}
                ), 200

            entries = data.get("entry", [])
            logger.info(f"Number of entries: {len(entries)}")

            if not entries:
                logger.warning("No entries in webhook")
                return jsonify({"status": "success", "reason": "no entries"}), 200

            entry = entries[0]
            logger.info(f"Processing entry: {json.dumps(entry, indent=2)}")

            changes = entry.get("changes", [])
            logger.info(f"Number of changes: {len(changes)}")

            if not changes:
                logger.warning("No changes in entry")
                return jsonify({"status": "success", "reason": "no changes"}), 200

            change = changes[0]
            logger.info(f"Processing change: {json.dumps(change, indent=2)}")

            value = change.get("value", {})
            field = change.get("field")
            logger.info(f"Change field: {field}")
            logger.info(f"Change value keys: {list(value.keys())}")

            messages = value.get("messages", [])
            logger.info(f"Number of messages: {len(messages)}")

            if not messages:
                logger.info("No messages in webhook (might be status update)")
                statuses = value.get("statuses", [])
                if statuses:
                    logger.info(f"This is a status update webhook: {statuses}")

                return jsonify({"status": "success", "reason": "no messages"}), 200

            message = messages[0]
            logger.info(f"Processing message: {json.dumps(message, indent=2)}")

            from_number = message.get("from")
            message_type = message.get("type")
            message_id = message.get("id")

            logger.info(f"From: {from_number}, Type: {message_type}, ID: {message_id}")

            message_body = ""
            if message_type == "text":
                message_body = message.get("text", {}).get("body", "")
            else:
                logger.warning(f"Unsupported message type: {message_type}")
                message_body = f"[{message_type} message]"

            logger.info(f"Message body: {message_body}")

            logger.info(f"Attempting to send reply to {from_number}")
            result = whatsapp_service.send_test_message(from_number)
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
            return jsonify({"status": "error", "message": str(e)}), 200
