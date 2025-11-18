from flask import (
    Blueprint,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    url_for,
)

from web.models.database import (
    create_group_booking,
    get_all_group_bookings,
    get_booking_by_barcode,
)
from web.services.barcode import generate_barcode
from web.services.pdf import generate_ticket_pdf

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


@groups_bp.route("/download/<barcode>")
def download_ticket(barcode):
    """Generate and download PDF ticket for a group"""
    booking = get_booking_by_barcode(barcode)

    if not booking:
        return jsonify({"error": "Booking not found"}), 404

    # Generate PDF
    pdf_path = generate_ticket_pdf(booking)

    return send_file(
        pdf_path, as_attachment=True, download_name=f"ticket_{barcode}.pdf"
    )
