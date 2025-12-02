from io import BytesIO
from typing import Optional

import requests
from flask import current_app
from pdf2image import convert_from_bytes


class WhatsAppService:
    """Service for sending messages via WhatsApp Business API"""

    BASE_URL = "https://graph.facebook.com/v22.0"

    def __init__(self):
        self.phone_number_id = current_app.config["WHATSAPP_PHONE_NUMBER_ID"]
        self.access_token = current_app.config["WHATSAPP_ACCESS_TOKEN"]

        if not self.phone_number_id or not self.access_token:
            raise ValueError("WhatsApp credentials not configured properly")

    def _get_headers(self):
        """Get request headers with auth token"""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def _convert_pdf_to_jpeg(self, pdf_bytes: bytes) -> bytes:
        """
        Convert PDF to high-quality JPEG image in memory

        Args:
            pdf_bytes: PDF file as bytes

        Returns:
            bytes: JPEG image as bytes
        """
        try:
            # Convert PDF to images (list of PIL Image objects)
            # dpi=300 ensures high quality for mobile viewing
            images = convert_from_bytes(pdf_bytes, dpi=300, fmt="jpeg")

            # Take the first page (tickets are single page)
            if not images:
                raise ValueError("No images generated from PDF")

            ticket_image = images[0]

            # Convert to RGB if needed (some PDFs may be in RGBA)
            if ticket_image.mode != "RGB":
                ticket_image = ticket_image.convert("RGB")

            # Save to BytesIO with high quality
            jpeg_buffer = BytesIO()
            ticket_image.save(
                jpeg_buffer,
                format="JPEG",
                quality=95,  # High quality
                optimize=True,
            )

            # Get the bytes
            jpeg_bytes = jpeg_buffer.getvalue()
            jpeg_buffer.close()

            return jpeg_bytes

        except Exception as e:
            print(f"Error converting PDF to JPEG: {e}")
            raise

    def _upload_media(
        self, file_bytes: bytes, filename: str, content_type: str = "application/pdf"
    ) -> Optional[str]:
        """
        Upload media file to WhatsApp servers

        Args:
            file_bytes: File content as bytes
            filename: Name for the file
            content_type: MIME type (e.g., 'application/pdf' or 'image/jpeg')

        Returns:
            str: Media ID if successful, None otherwise
        """
        from io import BytesIO

        url = f"{self.BASE_URL}/{self.phone_number_id}/media"

        headers = {
            "Authorization": f"Bearer {self.access_token}",
        }

        files = {
            "file": (filename, BytesIO(file_bytes), content_type),
        }

        data = {
            "messaging_product": "whatsapp",
            "type": content_type,
        }

        try:
            response = requests.post(
                url, headers=headers, files=files, data=data, timeout=30
            )
            response.raise_for_status()

            data = response.json()
            return data.get("id")

        except requests.exceptions.RequestException as e:
            print(f"Error uploading media: {e}")
            if e.response is not None and hasattr(e.response, "text"):
                print(f"Response: {e.response.text}")
            return None

    def _send_image_template_message(
        self, to_number: str, media_id: str, booking: dict
    ) -> dict:
        """
        Send the new image template message with JPEG attachment

        Template name: group_vehicle_ticket_jpeg
        Variables: {{contact_name}}

        Args:
            to_number: Recipient WhatsApp number
            media_id: Media ID from upload (JPEG)
            booking: Booking details

        Returns:
            dict: Success/failure response
        """
        url = f"{self.BASE_URL}/{self.phone_number_id}/messages"

        # Get contact name, fallback to "Guest" if not provided
        contact_name = booking.get("contact_person", "Guest")

        # Template message payload for the new image template
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to_number,
            "type": "template",
            "template": {
                "name": "group_vehicle_ticket_jpeg",
                "language": {"code": "en"},
                "components": [
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
                                "text": contact_name,
                            }
                        ],
                    },
                ],
            },
        }

        try:
            response = requests.post(
                url, headers=self._get_headers(), json=payload, timeout=30
            )
            response.raise_for_status()

            data = response.json()

            return {
                "success": True,
                "message_id": data.get("messages", [{}])[0].get("id"),
                "response": data,
            }

        except requests.exceptions.RequestException as e:
            if e.response is not None and hasattr(e.response, "text"):
                error_message = e.response.text
            else:
                error_message = str(e)

            print(f"Error sending WhatsApp image template message: {error_message}")

            return {"success": False, "error": error_message}

    def _send_template_message(
        self, to_number: str, media_id: str, booking: dict
    ) -> dict:
        """
        Send template message with PDF attachment

        NOTE: You must create a template named 'ticket_delivery' in Meta Business Suite
        with the structure shown below, or update the template name and parameters.

        Args:
            to_number: Recipient WhatsApp number
            media_id: Media ID from upload
            booking: Booking details

        Returns:
            dict: Success/failure response
        """
        url = f"{self.BASE_URL}/{self.phone_number_id}/messages"

        # Format the date nicely
        from datetime import datetime

        try:
            date_obj = datetime.strptime(str(booking["visit_date"]), "%Y-%m-%d")
            formatted_date = date_obj.strftime("%A, %d %B %Y")
        except Exception:
            formatted_date = str(booking["visit_date"])

        # Template message payload
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to_number,
            "type": "template",
            "template": {
                "name": "ticket_delivery",
                "language": {"code": "en"},
                "components": [
                    {
                        "type": "header",
                        "parameters": [
                            {
                                "type": "document",
                                "document": {
                                    "id": media_id,
                                    "filename": f"Farmyard_Ticket_{booking['barcode']}.pdf",
                                },
                            }
                        ],
                    },
                    {
                        "type": "body",
                        "parameters": [
                            {
                                "type": "text",
                                "text": booking.get("contact_person", "Guest"),
                            },
                            {"type": "text", "text": booking["group_name"]},
                            {"type": "text", "text": formatted_date},
                        ],
                    },
                ],
            },
        }

        try:
            response = requests.post(
                url, headers=self._get_headers(), json=payload, timeout=30
            )
            response.raise_for_status()

            data = response.json()

            return {
                "success": True,
                "message_id": data.get("messages", [{}])[0].get("id"),
                "response": data,
            }

        except requests.exceptions.RequestException as e:
            if e.response is not None and hasattr(e.response, "text"):
                error_message = e.response.text
            else:
                error_message = str(e)

            print(f"Error sending WhatsApp template message: {error_message}")

            return {"success": False, "error": error_message}

    def _send_document(self, to_number: str, media_id: str, booking: dict) -> dict:
        """
        Send document message with PDF

        Args:
            to_number: Recipient WhatsApp number
            media_id: Media ID from upload
            booking: Booking details

        Returns:
            dict: Success/failure response
        """
        url = f"{self.BASE_URL}/{self.phone_number_id}/messages"

        # Format the date nicely
        from datetime import datetime

        try:
            date_obj = datetime.strptime(str(booking["visit_date"]), "%Y-%m-%d")
            formatted_date = date_obj.strftime("%A, %d %B %Y")
        except Exception:
            formatted_date = str(booking["visit_date"])

        # Create caption with instructions
        caption = f"""🎫 *Your Farmyard Park Group Ticket* 🎫

*Group:* {booking["group_name"]}
*Visit Date:* {formatted_date}
*Barcode:* {booking["barcode"]}

📋 *Important Instructions:*
- Present this ticket at the entrance
- Driver must have ticket for scanning
- Valid for ONE vehicle only
- Entry strictly in queue order
- No entry after 3:00 PM
- Alcohol & music strictly prohibited

✅ *What's Included:* ✅
Pool access, trampoline, playgrounds, braai areas, animal farmyard

📍 *Location:* 📍
The Farmyard Park, Protea Road, Klapmuts, Western Cape

⏰ *Operating Hours:* ⏰
08:00 - 17:30

🌳 Have a wonderful day at The Farmyard Park! 🌳"""

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to_number,
            "type": "document",
            "document": {
                "id": media_id,
                "caption": caption,
                "filename": f"Farmyard_Ticket_{booking['barcode']}.pdf",
            },
        }

        try:
            response = requests.post(
                url, headers=self._get_headers(), json=payload, timeout=30
            )
            response.raise_for_status()

            data = response.json()

            return {
                "success": True,
                "message_id": data.get("messages", [{}])[0].get("id"),
                "response": data,
            }

        except requests.exceptions.RequestException as e:
            if e.response is not None and hasattr(e.response, "text"):
                error_message = e.response.text
            else:
                error_message = str(e)

            print(f"Error sending WhatsApp message: {error_message}")

            return {"success": False, "error": error_message}

    def send_test_message(self, to_number: str) -> dict:
        """
        Send a simple test message

        Args:
            to_number: Recipient WhatsApp number (format: 27821234567)

        Returns:
            dict: Success/failure response
        """
        url = f"{self.BASE_URL}/{self.phone_number_id}/messages"

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to_number,
            "type": "text",
            "text": {
                "body": "🎉 Hello from The Farmyard Park! This is a test message from our ticket system."
            },
        }

        try:
            response = requests.post(
                url, headers=self._get_headers(), json=payload, timeout=30
            )
            response.raise_for_status()

            return {"success": True, "response": response.json()}

        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": str(e),
                "response": e.response.text
                if hasattr(e.response, "text") and e.response is not None
                else None,
            }

    def send_ticket(self, to_number: str, booking: dict, pdf_bytes: bytes) -> dict:
        """
        Send ticket as JPEG using WhatsApp image template

        Args:
            to_number: Recipient's WhatsApp number (format: 27821234567)
            booking: Booking dict with group_name, visit_date, barcode, contact_person
            pdf_bytes: PDF file as bytes (will be converted to JPEG)

        Returns:
            dict: Response from WhatsApp API
        """
        # Step 1: Convert PDF to JPEG
        try:
            jpeg_bytes = self._convert_pdf_to_jpeg(pdf_bytes)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to convert PDF to JPEG: {str(e)}",
            }

        # Step 2: Upload the JPEG to Meta servers
        media_id = self._upload_media(
            jpeg_bytes, f"ticket_{booking['barcode']}.jpg", "image/jpeg"
        )

        if not media_id:
            return {
                "success": False,
                "error": "Failed to upload JPEG to WhatsApp servers",
            }

        # Step 3: Send using the new image template
        result = self._send_image_template_message(to_number, media_id, booking)

        return result
