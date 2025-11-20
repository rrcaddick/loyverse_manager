from flask import (
    Blueprint,
    flash,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)

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
