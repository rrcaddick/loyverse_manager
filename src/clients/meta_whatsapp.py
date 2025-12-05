from typing import Any, Dict, List, Optional

import requests


class MetaWhatsappClient:
    """
    Lightweight adapter for the Meta (WhatsApp) Graph API.

    Responsibilities:
    - upload media
    - send messages (templates, text, documents, images) via the /{phone_number_id}/messages endpoint
    - small helpers to build/send common message types

    Note: We intentionally *do not* inherit from BaseClient because media uploads require multipart
    and we want more control over requests (timeouts, files).
    """

    def __init__(
        self,
        phone_number_id: str,
        access_token: str,
        api_version: str = "v17.0",
        base_url: Optional[str] = None,
        timeout: tuple = (5, 30),
    ):
        self.phone_number_id = phone_number_id
        self.access_token = access_token
        self.api_version = api_version
        self.base_url = base_url or f"https://graph.facebook.com/{self.api_version}/"
        self.timeout = timeout
        # default headers used for JSON requests
        self._json_headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    def _url(self, endpoint: str) -> str:
        return f"{self.base_url.rstrip('/')}/{endpoint.lstrip('/')}"

    def upload_media(
        self, file_bytes: bytes, filename: str, mime_type: str
    ) -> Dict[str, Any]:
        """
        Upload media to Meta and return the API response (contains media id).
        Uses multipart/form-data as required by the Graph API.

        Example response: {"id": "<media_id>"}
        """
        url = self._url(f"{self.phone_number_id}/media")

        files = {
            "file": (filename, file_bytes, mime_type),
        }

        # Meta requires these as form data (not params)
        data = {
            "messaging_product": "whatsapp",
            "type": mime_type,
        }

        params = {"access_token": self.access_token}

        resp = requests.post(
            url,
            files=files,
            data=data,  # Add form data
            params=params,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def send_message(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send a raw message payload to the Graph API messages endpoint.
        Caller constructs the payload (templates, image, document, text).
        """
        endpoint = f"{self.phone_number_id}/messages"
        url = self._url(endpoint)
        # send access token via params for Graph API compatibility
        params = {"access_token": self.access_token}
        resp = requests.post(
            url,
            json=payload,
            headers=self._json_headers,
            params=params,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    # Convenience wrappers -------------------------------------------------
    def send_text(
        self, to: str, text: str, preview_url: bool = False
    ) -> Dict[str, Any]:
        """Send a text message."""
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "text",
            "text": {"body": text, "preview_url": preview_url},
        }
        return self.send_message(payload)

    def send_image_by_id(
        self, to: str, media_id: str, caption: Optional[str] = None
    ) -> Dict[str, Any]:
        """Send an image using a media ID from upload_media."""
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "image",
            "image": {"id": media_id, **({"caption": caption} if caption else {})},
        }
        return self.send_message(payload)

    def send_document_by_id(
        self, to: str, media_id: str, filename: Optional[str] = None
    ) -> Dict[str, Any]:
        """Send a document using a media ID from upload_media."""
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "document",
            "document": {
                "id": media_id,
                **({"filename": filename} if filename else {}),
            },
        }
        return self.send_message(payload)

    def send_template(
        self,
        to: str,
        template_name: str,
        language_code: str,
        components: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Send a WhatsApp template message.

        Args:
            to: Recipient phone number
            template_name: Name of the template registered in Meta Business Suite
            language_code: Language code (e.g., "en", "es")
            components: List of template components (header, body, buttons, etc.)
                       Each component should have 'type' and 'parameters' keys.

        Example components:
            [
                {
                    "type": "header",
                    "parameters": [{"type": "image", "image": {"id": "media_id"}}]
                },
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": "John Doe"}]
                }
            ]

        Returns:
            Dict containing the API response
        """
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language_code},
                "components": components,
            },
        }
        return self.send_message(payload)
