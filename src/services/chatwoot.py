from typing import Optional

from config.settings import CHATWOOT_ACCOUNT_ID, CHATWOOT_API_TOKEN, CHATWOOT_URL
from src.clients.chatwoot import ChatwootClient


class ChatwootService:
    """
    Service for sending WhatsApp messages via Chatwoot.

    This service handles business logic for ticket delivery through Chatwoot's
    API, which then sends messages via WhatsApp.
    """

    def __init__(
        self,
        client: Optional[ChatwootClient] = None,
        inbox_id: Optional[int] = None,
    ):
        """
        Initialize the service with a Chatwoot client.

        Args:
            client: ChatwootClient instance. If None, creates one from Flask config.
            inbox_id: Default inbox ID for WhatsApp channel. If None, reads from config.
        """
        if client is None:
            chatwoot_url = CHATWOOT_URL
            chatwoot_api_token = CHATWOOT_API_TOKEN
            chatwoot_account_id = CHATWOOT_ACCOUNT_ID

            if not chatwoot_url or not chatwoot_api_token or not chatwoot_account_id:
                raise ValueError(
                    "Chatwoot not configured. Set CHATWOOT_URL, CHATWOOT_API_TOKEN, "
                    "and CHATWOOT_ACCOUNT_ID in config."
                )

            self.client = ChatwootClient(
                base_url=chatwoot_url,
                api_token=chatwoot_api_token,
                account_id=chatwoot_account_id,
            )
        else:
            self.client = client

        # Store inbox_id if provided, otherwise can be passed per-method
        self.default_inbox_id = inbox_id

    def send_group_vehicle_ticket_jpeg(
        self,
        to_number: str,
        booking: dict,
        image_url: str,
        inbox_id: Optional[int] = None,
    ) -> dict:
        """
        Send group vehicle ticket template through Chatwoot with on-demand image generation.

        Template name: group_vehicle_ticket_jpeg
        The template is sent via Chatwoot's API which forwards it to WhatsApp.

        Args:
            to_number: Recipient's WhatsApp number (format: 27821234567)
            booking: Booking dict with group_name, visit_date, barcode, contact_person
            image_url: URL to ticket image endpoint with JWT token
            inbox_id: Chatwoot inbox ID for this WhatsApp channel (uses default if None)

        Returns:
            dict: Response with success status and conversation details
        """
        inbox_id = inbox_id or self.default_inbox_id
        if not inbox_id:
            return {
                "success": False,
                "error": "inbox_id is required but was not provided",
            }

        try:
            # Step 1: Get or create contact in Chatwoot
            contact_name = booking.get("contact_person", "Guest")
            contact = self.client.get_or_create_contact(
                identifier=f"+{to_number}", name=contact_name
            )

            if not contact:
                return {
                    "success": False,
                    "error": "Failed to create/get contact in Chatwoot",
                }

            contact_id = contact.get("id")

            # Step 2: Get or create conversation for this contact
            # Extract source_id from contact if available
            source_id = None
            for ci in contact.get("contact_inboxes", []):
                if ci.get("inbox", {}).get("id") == inbox_id:
                    source_id = ci.get("source_id")
                    break

            conversation = self.client.get_or_create_conversation(
                contact_id=contact_id,
                inbox_id=inbox_id,
                source_id=source_id,
            )

            if not conversation:
                return {
                    "success": False,
                    "error": "Failed to get/create conversation in Chatwoot",
                }

            conversation_id = conversation.get("id")

            # Step 3: Build template message content
            template_content = f"""Hi {contact_name}

Your group vehicle ticket is attached.

Please share *THIS* ticket with your group members and ensure the driver of each vehicle presents it for scanning upon arrival. It can be shown on a phone and does not need to be printed.

The passenger count in each vehicle presenting this ticket will be added to your group for invoicing.

Any vehicle without a group ticket will be charged the normal fee at the gate. No exceptions.

*ALL VEHICLES*, including taxi drop-offs, *MUST remain in the queue* and enter the park *BEFORE* passengers disembark. *Strictly no drop-offs outside the gate.*

We wish you all a blessed day at the Farmyard."""

            # Step 4: Prepare template message payload
            message_payload = {
                "content": template_content,
                "message_type": "outgoing",
                "template_params": {
                    "name": "group_vehicle_ticket_jpeg",
                    "category": "MARKETING",
                    "language": "en",
                    "processed_params": {
                        "body": {
                            "contact_name": contact_name,
                        },
                        "header": {
                            "media_url": image_url,
                            "media_type": "image",
                        },
                    },
                },
            }

            # Step 5: Send message via Chatwoot
            result = self.client.send_message(
                conversation_id=conversation_id,
                message=message_payload,
            )

            return {
                "success": True,
                "conversation_id": conversation_id,
                "message_id": result.get("id"),
                "contact_id": contact_id,
                "chatwoot_response": result,
            }

        except Exception as e:
            error_detail = str(e)
            if hasattr(e, "response") and e.response is not None:
                try:
                    error_detail = e.response.text
                except Exception:
                    pass

            print(f"Error sending template via Chatwoot: {error_detail}")
            return {
                "success": False,
                "error": f"Chatwoot API error: {error_detail}",
            }
