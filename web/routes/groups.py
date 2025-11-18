from flask import (
    Blueprint,
    flash,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)

from ..models.database import (
    create_group_booking,
    get_all_group_bookings,
    get_booking_by_barcode,
)
from ..services.barcode import generate_barcode
from ..services.pdf import generate_ticket_pdf

groups_bp = Blueprint("groups", __name__, url_prefix="/group-bookings")


@groups_bp.route("/", methods=["GET", "POST"])
def manage_bookings():
    """Display form and table for group bookings"""
    if request.method == "POST":
        group_name = request.form.get("group_name")
        visit_date = request.form.get("visit_date")

        # Generate unique barcode
        barcode = generate_barcode()

        # Save to database
        booking_id = create_group_booking(group_name, visit_date, barcode)

        if booking_id:
            flash(f"Group booking created successfully! Barcode: {barcode}", "success")
            return redirect(url_for("groups.manage_bookings"))
        else:
            flash("Error creating booking", "error")

    # Get all bookings for table display
    bookings = get_all_group_bookings()

    return render_template("group_bookings.html", bookings=bookings)


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
