from typing import Any, Dict, List, Optional

from src.clients.base import BaseClient


class ChatwootClient(BaseClient):
    """
    Adapter for Chatwoot API using your BaseClient helpers.
    - account_id: your Chatwoot account id (integer)
    - base_url should be the root URL for Chatwoot (e.g. https://app.chatwoot.example)
    - headers must include Authorization: Bearer <api_token>
    """

    def __init__(self, base_url: str, api_token: str, account_id: int):
        headers = {
            "Content-Type": "application/json",
            "api_access_token": api_token,
        }
        headers["Authorization"] = f"Bearer {api_token}"
        super().__init__(base_url=base_url.rstrip("/"), headers=headers)
        self.account_id = account_id

    # Contacts ------------------------------------------------------------
    def search_contact(self, identifier: str) -> Optional[Dict[str, Any]]:
        """
        Search for a contact by phone/email identifier.
        Returns contact dict or None.
        Endpoint: GET /api/v1/accounts/{account_id}/contacts/search?q={identifier}

        Note: Chatwoot uses 'q' parameter for search.
        Prioritizes contacts with phone_number field over identifier field.
        """
        endpoint = f"/api/v1/accounts/{self.account_id}/contacts/search"

        # Normalize identifier - strip + and spaces
        normalized = identifier.lstrip("+").strip()

        # Try multiple search formats
        search_variations = [
            f"+{normalized}",  # +27821234567
            normalized,  # 27821234567
        ]

        for search_term in search_variations:
            try:
                resp = super().get(endpoint, params={"q": search_term})

                # Chatwoot returns {"payload": [...]} with array of contacts
                if isinstance(resp, dict) and "payload" in resp:
                    contacts = resp["payload"]

                    if isinstance(contacts, list) and len(contacts) > 0:
                        # Prioritize contacts with phone_number field set
                        # (these are proper WhatsApp contacts vs identifier-only contacts)
                        for contact in contacts:
                            if contact.get("phone_number"):
                                return contact

                        # If no contact has phone_number, return the first one
                        return contacts[0]

            except Exception as e:
                # Log but continue trying other variations
                print(f"[ChatwootClient] Search failed for '{search_term}': {e}")
                continue

        return None

    def create_contact(
        self, identifier: str, name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a contact under the current account.
        Endpoint: POST /api/v1/accounts/{account_id}/contacts
        Body: { phone_number, name }

        Note: Chatwoot uses 'phone_number' field (not 'identifier') for contact creation.
        """
        endpoint = f"/api/v1/accounts/{self.account_id}/contacts"

        # Ensure phone number has + prefix
        phone_number = identifier if identifier.startswith("+") else f"+{identifier}"

        payload = {"phone_number": phone_number}
        if name:
            payload["name"] = name

        resp = super().post(endpoint, payload)

        # Return the contact from payload if wrapped
        if isinstance(resp, dict) and resp.get("payload"):
            return resp["payload"]
        return resp

    def get_or_create_contact(
        self, identifier: str, name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get existing contact or create new one.
        Handles the search and create logic with proper field names.
        """
        contact = self.search_contact(identifier)
        if contact:
            return contact
        return self.create_contact(identifier, name)

    # Conversations -------------------------------------------------------
    def get_conversations_for_contact(self, contact_id: int) -> List[Dict[str, Any]]:
        endpoint = (
            f"/api/v1/accounts/{self.account_id}/contacts/{contact_id}/conversations"
        )
        resp = super().get(endpoint)

        # API returns payload wrapper with conversations
        if isinstance(resp, dict) and resp.get("payload"):
            return resp["payload"]
        # Fallback for unwrapped response
        if isinstance(resp, list):
            return resp
        return []

    def get_open_conversation(
        self, contact_id: int, inbox_id: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Return an open conversation (dict) for the contact if exists, otherwise None.
        Optionally filter by inbox_id.
        """
        convs = self.get_conversations_for_contact(contact_id)
        for c in convs:
            status = c.get("status") or c.get("meta", {}).get("status")
            if status == "open":
                if inbox_id is None or c.get("inbox_id") == inbox_id:
                    return c
        return None

    def create_conversation(
        self, contact_id: int, inbox_id: int, source_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new conversation for the contact.
        Endpoint: POST /api/v1/accounts/{account_id}/conversations
        Body includes inbox_id, contact_id, and optional source_id
        """
        endpoint = f"/api/v1/accounts/{self.account_id}/conversations"
        payload: Dict[str, Any] = {"inbox_id": inbox_id, "contact_id": contact_id}
        if source_id is not None:
            payload["source_id"] = source_id
        return super().post(endpoint, payload)

    def get_or_create_conversation(
        self, contact_id: int, inbox_id: int, source_id: Optional[str] = None
    ) -> Dict[str, Any]:
        conv = self.get_open_conversation(contact_id, inbox_id=inbox_id)
        if conv:
            return conv
        return self.create_conversation(contact_id, inbox_id, source_id=source_id)

    # Messages ------------------------------------------------------------
    def send_message(
        self, conversation_id: int, message: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Send a message in a conversation.
        Endpoint: POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages
        message is the JSON body described by Chatwoot API (content, message_type, private, attachments, etc.)
        """
        endpoint = f"/api/v1/accounts/{self.account_id}/conversations/{conversation_id}/messages"
        return super().post(endpoint, message)
