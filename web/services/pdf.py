"""Professional PDF ticket generation using ReportLab"""

from io import BytesIO

from flask import current_app
from reportlab.graphics.barcode import code128
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def generate_ticket_pdf(booking):
    """
    Generate a professional PDF ticket for a group booking

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

    # Define colors (Farmyard brand colors - green and earth tones)
    primary_color = colors.HexColor("#2D5F3F")  # Dark green
    accent_color = colors.HexColor("#8BC34A")  # Light green
    text_dark = colors.HexColor("#333333")
    text_black = colors.HexColor("#000000")
    text_black = colors.HexColor("#000000")
    text_white = colors.HexColor("#FFFFFF")
    text_light = colors.HexColor("#666666")
    background_gray = colors.HexColor("#F5F5F5")

    # HEADER - Reduced height and improved design
    header_height = 44.5 * mm

    # Main header background
    c.setFillColor(accent_color)
    c.rect(0, height - header_height, width, header_height, fill=1, stroke=0)

    # Decorative wave pattern at bottom of header
    c.setFillColor(primary_color)

    # Simple decorative bottom border
    c.rect(0, height - header_height, width, 3 * mm, fill=1, stroke=0)

    # Logo section - white circle background FIRST, then logo on top
    logo_size = 75 * mm
    logo_center_x = width - logo_size / 2
    logo_center_y = height - 28 * mm

    # Draw white circle for logo background
    c.setFillColor(colors.white)
    # c.circle(logo_center_x, logo_center_y, 15 * mm, fill=1, stroke=0)

    # Now draw logo ON TOP of white circle
    try:
        logo_path = (
            current_app.config["BASE_DIR"] / "static" / "images" / "Farmyard_Logo.jpg"
        )
        if logo_path.exists():
            logo = ImageReader(str(logo_path))
            c.drawImage(
                logo,
                logo_center_x - logo_size / 2,
                logo_center_y - logo_size + 127,
                width=logo_size,
                height=logo_size,
                mask="auto",
                preserveAspectRatio=True,
            )
        else:
            # Fallback text
            c.setFillColor(primary_color)
            c.setFont("Helvetica-Bold", 14)
            c.drawCentredString(logo_center_x, logo_center_y, "FARMYARD PARK")
    except Exception as e:
        print(f"Logo error: {e}")
        # Fallback text
        c.setFillColor(primary_color)
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(logo_center_x, logo_center_y, "FARMYARD PARK")

    # Title below logo
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 21)
    c.drawCentredString(
        width / 3, height - header_height + 20 * mm, "GROUP VEHICLE ENTRY TICKET"
    )

    # Subtitle
    # c.setFont("Helvetica", 15)
    # c.drawCentredString(
    #     width / 3, height - header_height + 25 * mm, "Christian Recreation Park"
    # )

    # Main content area - starts higher now due to smaller header
    content_start = height - header_height - 15 * mm

    # Light background for main content
    c.setFillColor(background_gray)
    c.rect(
        30 * mm, content_start - 110 * mm, width - 60 * mm, 110 * mm, fill=1, stroke=0
    )

    # White content box
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor("#DDDDDD"))
    c.setLineWidth(1)
    c.roundRect(
        35 * mm,
        content_start - 105 * mm,
        width - 70 * mm,
        100 * mm,
        3 * mm,
        fill=1,
        stroke=1,
    )

    # Group details section - CENTERED
    y_pos = content_start - 16 * mm

    # Group Name - CENTERED
    c.setFillColor(text_light)
    c.setFont("Helvetica", 16)
    c.drawCentredString(width / 2, y_pos, "GROUP NAME")

    c.setFillColor(text_dark)
    c.setFont("Helvetica-Bold", 24)  # 1.4x larger (was 16)
    c.drawCentredString(width / 2, y_pos - 9 * mm, str(booking["group_name"]))

    # Visit Date - CENTERED
    y_pos -= 25 * mm
    c.setFillColor(text_light)
    c.setFont("Helvetica", 16)
    c.drawCentredString(width / 2, y_pos, "VISIT DATE")

    c.setFillColor(text_dark)
    c.setFont("Helvetica-Bold", 24)  # 1.4x larger (was 16)

    # Format date nicely
    from datetime import datetime

    try:
        date_obj = datetime.strptime(str(booking["visit_date"]), "%Y-%m-%d")
        formatted_date = date_obj.strftime("%A, %d %B %Y")
    except:
        formatted_date = str(booking["visit_date"])

    c.drawCentredString(width / 2, y_pos - 9 * mm, formatted_date)

    # Barcode section with accent background
    y_pos -= 30 * mm
    c.setFillColor(accent_color)
    c.setStrokeColor(accent_color)
    c.roundRect(
        35 * mm, y_pos - 45 * mm, width - 70 * mm, 45 * mm, 3 * mm, fill=1, stroke=1
    )

    # Barcode label
    c.setFillColor(text_white)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, y_pos - 7 * mm, "SCAN AT ENTRANCE")

    # Draw barcode
    c.setFillColor(text_black)
    barcode_value = booking["barcode"]

    # Increased barWidth significantly for wider barcode
    barcode = code128.Code128(
        barcode_value,
        barHeight=22 * mm,  # Taller
        barWidth=1.8,  # Much wider (was 1.2)
        humanReadable=False,  # We'll add the text ourselves
    )

    # Center the barcode
    barcode_width = barcode.width
    barcode_x = (width - barcode_width) / 2

    # Draw barcode (it will be BLACK by default)
    barcode.drawOn(c, barcode_x, y_pos - 33 * mm)

    # Barcode number below
    c.setFillColor(text_white)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, y_pos - 40 * mm, barcode_value)

    # Important notice box
    notice_y = content_start - 140 * mm
    c.setStrokeColor(primary_color)
    c.setLineWidth(2)
    c.setFillColor(colors.white)
    c.roundRect(
        30 * mm, notice_y - 37 * mm, width - 60 * mm, 35 * mm, 2 * mm, fill=1, stroke=1
    )

    # Notice icon and text
    c.setFillColor(primary_color)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(35 * mm, notice_y - 10 * mm, "⚠  IMPORTANT INFORMATION")

    c.setFillColor(text_dark)
    c.setFont("Helvetica", 9)
    instructions = [
        "• This ticket is valid for ONE VEHICLE entrance on the date shown above",
        "• Driver must present this ticket at the entrance for scanning",
        "• Entry is strictly in queue order - no priority entrance available",
        "• No entry after 3:00 PM  •  Alcohol strictly prohibited  •  No music permitted",
    ]

    inst_y = notice_y - 17 * mm
    for instruction in instructions:
        c.drawString(37 * mm, inst_y, instruction)
        inst_y -= 5 * mm

    # Footer section
    footer_y = 35 * mm

    # Contact info box
    c.setFillColor(accent_color)
    c.rect(0, 0, width, footer_y, fill=1, stroke=0)

    c.setFillColor(text_white)
    c.setFont("Helvetica-Bold", 17)
    c.drawCentredString(width / 2, 27 * mm, "The Farmyard Park (Pty) Ltd")

    c.setFillColor(text_white)
    c.setFont("Helvetica", 12)
    c.drawCentredString(width / 2, 20 * mm, "Protea Road, Klapmuts, Western Cape 7625")
    c.drawCentredString(
        width / 2, 13 * mm, "Email: info@farmyardpark.co.za  |  Tel: +27 (0)21 875 5790"
    )

    c.setFont("Helvetica-Oblique", 12)
    c.setFillColor(text_white)
    c.drawCentredString(
        width / 2,
        5 * mm,
        "Thank you for choosing The Farmyard Park. Have a wonderful day!",
    )

    # Subtle watermark
    c.setFillColor(colors.Color(0.8, 0.8, 0.8, alpha=0.35))
    c.setFont("Helvetica", 60)
    c.saveState()
    c.translate(width / 2 + 10, height - 330)
    c.rotate(30)
    c.drawCentredString(0, 0, "VALID TICKET")
    c.restoreState()

    # Finalize PDF
    c.showPage()
    c.save()

    # Get PDF bytes
    pdf_bytes = buffer.getvalue()
    buffer.close()

    return pdf_bytes
