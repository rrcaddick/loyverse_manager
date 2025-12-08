from typing import Optional

from config.settings import WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
from src.clients.meta_whatsapp import MetaWhatsappClient
from src.models.group_booking import GroupBooking
from src.services.pdf import convert_pdf_to_jpeg, generate_ticket_pdf


class MetaWhatsappService:
    """
    Service for sending WhatsApp messages via Meta's WhatsApp Business API.

    This service handles business logic for ticket delivery and uses
    MetaWhatsappClient for all API interactions.
    """

    def __init__(self, client: Optional[MetaWhatsappClient] = None):
        """
        Initialize the service with a client.

        Args:
            client: MetaWhatsappClient instance. If None, creates one from Flask config.
        """
        if client is None:
            phone_number_id = WHATSAPP_PHONE_NUMBER_ID
            access_token = WHATSAPP_ACCESS_TOKEN

            if not phone_number_id or not access_token:
                raise ValueError("WhatsApp credentials not configured properly")

            # Use v22.0 to match existing implementation
            self.client = MetaWhatsappClient(
                phone_number_id=phone_number_id,
                access_token=access_token,
                api_version="v22.0",
            )
        else:
            self.client = client

    def send_test_message(self, to_number: str) -> dict:
        """
        Send a simple test message.

        Args:
            to_number: Recipient WhatsApp number (format: 27821234567)

        Returns:
            dict: Success/failure response
        """
        try:
            response = self.client.send_text(
                to=to_number,
                text="🎉 Hello from The Farmyard Park! This is a test message from our ticket system.",
            )
            return {"success": True, "response": response}

        except Exception as e:
            error_msg = str(e)
            if hasattr(e, "response") and e.response is not None:
                try:
                    error_msg = e.response.text
                except Exception:
                    pass

            return {"success": False, "error": error_msg}

    def send_group_vehicle_ticket_jpeg(
        self, to_number: str, booking: GroupBooking, pdf_bytes: Optional[bytes] = None
    ) -> dict:
        """
        Send the group vehicle ticket template with JPEG attachment.

        This method handles:
        1. Converting PDF to JPEG
        2. Uploading JPEG to Meta
        3. Sending the template with the uploaded media

        Template name: group_vehicle_ticket_jpeg
        Variables: {{contact_name}}

        Args:
            to_number: Recipient WhatsApp number
            booking: Booking details dict containing 'contact_person', 'barcode'
            pdf_bytes: PDF file as bytes (will be converted to JPEG)

        Returns:
            dict: Success/failure response with message_id
        """
        # Step 1: Convert PDF to JPEG
        if pdf_bytes is None:
            pdf_bytes = generate_ticket_pdf(booking)

        try:
            jpeg_bytes = convert_pdf_to_jpeg(pdf_bytes)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to convert PDF to JPEG: {str(e)}",
            }

        # Step 2: Upload JPEG to Meta
        try:
            upload_response = self.client.upload_media(
                file_bytes=jpeg_bytes,
                filename=f"ticket_{booking.barcode}.jpg",
                mime_type="image/jpeg",
            )
            media_id = upload_response.get("id")

            if not media_id:
                return {
                    "success": False,
                    "error": "Failed to get media ID from upload response",
                }

        except Exception as e:
            error_msg = str(e)
            if hasattr(e, "response") and e.response is not None:
                try:
                    error_msg = e.response.text
                except Exception:
                    pass

            print(f"Error uploading JPEG: {error_msg}")
            return {
                "success": False,
                "error": f"Failed to upload JPEG to WhatsApp: {error_msg}",
            }

        # Step 3: Build template components
        contact_name = booking.contact_person or "Guest"

        components = [
            {
                "type": "header",
                "parameters": [
                    {
                        "type": "image",
                        "image": {"id": media_id},
                    }
                ],
            },
            {
                "type": "body",
                "parameters": [
                    {
                        "type": "text",
                        "parameter_name": "contact_name",
                        "text": contact_name,
                    }
                ],
            },
        ]

        # Step 4: Send template
        try:
            response = self.client.send_template(
                to=to_number,
                template_name="group_vehicle_ticket_jpeg",
                language_code="en",
                components=components,
            )

            return {
                "success": True,
                "message_id": response.get("messages", [{}])[0].get("id"),
                "response": response,
            }

        except Exception as e:
            error_msg = str(e)
            if hasattr(e, "response") and e.response is not None:
                try:
                    error_msg = e.response.text
                except Exception:
                    pass

            print(f"Error sending group vehicle ticket JPEG template: {error_msg}")
            return {"success": False, "error": error_msg}

    def send_ticket_delivery(
        self, to_number: str, booking: GroupBooking, pdf_bytes: Optional[bytes] = None
    ) -> dict:
        """
        Send the ticket delivery template with PDF attachment.

        This method handles:
        1. Uploading PDF to Meta
        2. Sending the template with the uploaded media

        Template name: ticket_delivery
        Variables: {{contact_name}}, {{group_name}}, {{visit_date}}

        Args:
            to_number: Recipient WhatsApp number
            booking: Booking details dict containing contact_person, group_name, visit_date, barcode
            pdf_bytes: PDF file as bytes

        Returns:
            dict: Success/failure response with message_id
        """
        # Step 1: Upload PDF to Meta
        if pdf_bytes is None:
            pdf_bytes = generate_ticket_pdf(booking)

        try:
            upload_response = self.client.upload_media(
                file_bytes=pdf_bytes,
                filename=f"Farmyard_Ticket_{booking.barcode}.pdf",
                mime_type="application/pdf",
            )
            media_id = upload_response.get("id")

            if not media_id:
                return {
                    "success": False,
                    "error": "Failed to get media ID from upload response",
                }

        except Exception as e:
            error_msg = str(e)
            if hasattr(e, "response") and e.response is not None:
                try:
                    error_msg = e.response.text
                except Exception:
                    pass

            print(f"Error uploading PDF: {error_msg}")
            return {
                "success": False,
                "error": f"Failed to upload PDF to WhatsApp: {error_msg}",
            }

        # Step 2: Format the date
        from datetime import datetime

        try:
            date_obj = datetime.strptime(str(booking.visit_date), "%Y-%m-%d")
            formatted_date = date_obj.strftime("%A, %d %B %Y")
        except Exception:
            formatted_date = str(booking.visit_date)

        # Step 3: Build template components
        components = [
            {
                "type": "header",
                "parameters": [
                    {
                        "type": "document",
                        "document": {
                            "id": media_id,
                            "filename": f"Farmyard_Ticket_{booking.barcode}.pdf",
                        },
                    }
                ],
            },
            {
                "type": "body",
                "parameters": [
                    {"type": "text", "text": booking.contact_person},
                    {"type": "text", "text": booking.group_name},
                    {"type": "text", "text": formatted_date},
                ],
            },
        ]

        # Step 4: Send template
        try:
            response = self.client.send_template(
                to=to_number,
                template_name="ticket_delivery",
                language_code="en",
                components=components,
            )

            return {
                "success": True,
                "message_id": response.get("messages", [{}])[0].get("id"),
                "response": response,
            }

        except Exception as e:
            error_msg = str(e)
            if hasattr(e, "response") and e.response is not None:
                try:
                    error_msg = e.response.text
                except Exception:
                    pass

            print(f"Error sending ticket delivery template: {error_msg}")
            return {"success": False, "error": error_msg}

    def send_quicketbot_hide_event_failure(
        self, to_number: str, event_id: str, event_url: str
    ) -> dict:
        """
        Send Quicket event hide failure alert.

        This method sends a text-only template to notify that manual intervention
        is required to hide a Quicket event.

        Template name: quicketbot_hide_event_failure
        Variables: {{event_id}}, {{event_url}}

        Args:
            to_number: Recipient WhatsApp number (format: 27821234567)
            event_id: The Quicket event ID that failed to hide
            event_url: The URL to the Quicket event

        Returns:
            dict: Success/failure response with message_id
        """
        # Build template components with named parameters
        components = [
            {
                "type": "body",
                "parameters": [
                    {
                        "type": "text",
                        "parameter_name": "event_id",
                        "text": event_id,
                    },
                    {
                        "type": "text",
                        "parameter_name": "event_url",
                        "text": event_url,
                    },
                ],
            },
        ]

        # Send template
        try:
            response = self.client.send_template(
                to=to_number,
                template_name="quicketbot_hide_event_failure",
                language_code="en",
                components=components,
            )

            return {
                "success": True,
                "message_id": response.get("messages", [{}])[0].get("id"),
                "response": response,
            }

        except Exception as e:
            error_msg = str(e)
            if hasattr(e, "response") and e.response is not None:
                try:
                    error_msg = e.response.text
                except Exception:
                    pass

            print(f"Error sending quicketbot hide event failure alert: {error_msg}")
            return {"success": False, "error": error_msg}
