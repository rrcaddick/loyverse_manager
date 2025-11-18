from io import BytesIO

from reportlab.graphics.barcode import code128
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def generate_ticket_pdf(booking):
    """
    Generate a PDF ticket for a group booking

    Args:
        booking: Dict with keys: group_name, visit_date, barcode

    Returns:
        bytes: PDF file as bytes
    """
    # Create PDF in memory
    buffer = BytesIO()

    # Create canvas (A4 size)
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    # Set up the ticket design
    # Title
    c.setFont("Helvetica-Bold", 24)
    c.drawCentredString(width / 2, height - 50 * mm, "The Farmyard Park (Pty) Ltd")

    c.setFont("Helvetica", 18)
    c.drawCentredString(width / 2, height - 65 * mm, "Group Entry Ticket")

    # Draw a box around the ticket
    c.setStrokeColor(colors.HexColor("#007bff"))
    c.setLineWidth(2)
    c.rect(40 * mm, height - 200 * mm, width - 80 * mm, 120 * mm)

    # Group details
    c.setFont("Helvetica-Bold", 14)
    c.setFillColor(colors.black)

    y_position = height - 100 * mm

    c.drawString(50 * mm, y_position, "Group Name:")
    c.setFont("Helvetica", 14)
    c.drawString(100 * mm, y_position, str(booking["group_name"]))

    y_position -= 10 * mm
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50 * mm, y_position, "Visit Date:")
    c.setFont("Helvetica", 14)
    c.drawString(100 * mm, y_position, str(booking["visit_date"]))

    # Barcode
    y_position -= 20 * mm
    barcode_value = booking["barcode"]

    # Create barcode
    barcode = code128.Code128(barcode_value, barHeight=15 * mm, barWidth=0.8)

    # Draw barcode centered
    barcode_width = barcode.width
    barcode_x = (width - barcode_width) / 2
    barcode.drawOn(c, barcode_x, y_position - 15 * mm)

    # Barcode number below
    c.setFont("Helvetica", 10)
    c.drawCentredString(width / 2, y_position - 20 * mm, barcode_value)

    # Instructions
    y_position -= 40 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(width / 2, y_position, "Instructions:")

    c.setFont("Helvetica", 10)
    instructions = [
        "1. Present this ticket at the entrance",
        "2. Staff will scan the barcode for verification",
        "3. Each group member must have this ticket",
        "4. Ticket is valid only for the date shown above",
    ]

    y_position -= 7 * mm
    for instruction in instructions:
        c.drawString(50 * mm, y_position, instruction)
        y_position -= 5 * mm

    # Footer
    c.setFont("Helvetica-Oblique", 8)
    c.drawCentredString(width / 2, 20 * mm, "Thank you for visiting The Farmyard Park!")
    c.drawCentredString(
        width / 2, 15 * mm, "For assistance, contact: info@farmyardpark.co.za"
    )

    # Finalize PDF
    c.showPage()
    c.save()

    # Get PDF bytes
    pdf_bytes = buffer.getvalue()
    buffer.close()

    return pdf_bytes
