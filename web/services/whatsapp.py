from typing import Optional

import requests
from flask import current_app


class WhatsAppService:
    """Service for sending messages via WhatsApp Business API"""

    BASE_URL = "https://graph.facebook.com/v18.0"

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

    def send_ticket(self, to_number: str, booking: dict, pdf_bytes: bytes) -> dict:
        """
        Send ticket PDF to WhatsApp number

        Args:
            to_number: Recipient's WhatsApp number (format: 27821234567)
            booking: Booking dict with group_name, visit_date, barcode
            pdf_bytes: PDF file as bytes

        Returns:
            dict: Response from WhatsApp API
        """
        # Step 1: Upload the PDF to Meta servers
        media_id = self._upload_media(pdf_bytes, f"ticket_{booking['barcode']}.pdf")

        if not media_id:
            return {
                "success": False,
                "error": "Failed to upload PDF to WhatsApp servers",
            }

        # Step 2: Send the PDF with caption
        result = self._send_document(to_number, media_id, booking)

        return result

    def _upload_media(self, file_bytes: bytes, filename: str) -> Optional[str]:
        """
        Upload PDF to WhatsApp servers

        Returns:
            str: Media ID if successful, None otherwise
        """
        url = f"{self.BASE_URL}/{self.phone_number_id}/media"

        headers = {
            "Authorization": f"Bearer {self.access_token}",
        }

        files = {
            "file": (filename, file_bytes, "application/pdf"),
            "messaging_product": (None, "whatsapp"),
            "type": (None, "application/pdf"),
        }

        try:
            response = requests.post(url, headers=headers, files=files, timeout=30)
            response.raise_for_status()

            data = response.json()
            return data.get("id")

        except requests.exceptions.RequestException as e:
            print(f"Error uploading media: {e}")
            if hasattr(e.response, "text"):
                print(f"Response: {e.response.text}")
            return None

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
            error_message = str(e)
            if hasattr(e.response, "text"):
                error_message = e.response.text

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
                "response": e.response.text if hasattr(e.response, "text") else None,
            }
