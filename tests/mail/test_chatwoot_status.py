"""The Chatwoot client and service read a sent ticket's delivery status (19 Nov 2026).

The reply shape is the one Chatwoot returned on prod on 19 Nov 2026: the status
as a word, the Meta error under content_attributes.external_error.
"""

from unittest.mock import patch

from src.clients.base import BaseClient
from src.clients.chatwoot import ChatwootClient
from src.services.chatwoot import ChatwootService

REPLY = {
    "payload": [
        {"id": 4223, "message_type": 1, "status": "failed", "content_attributes": {"external_error": "131026: Message undeliverable"}},
        {"id": 4221, "message_type": 1, "status": "delivered", "content_attributes": {}},
        {"id": 4210, "message_type": 1, "status": 2, "content_attributes": None},
    ]
}


def _client():
    return ChatwootClient(base_url="https://chat.example", api_token="t", account_id="1")


def test_the_client_reads_status_and_error():
    with patch.object(BaseClient, "get", return_value=REPLY):
        assert _client().message_status(855, 4223) == {"status": "failed", "error": "131026: Message undeliverable"}
        assert _client().message_status(853, 4221) == {"status": "delivered", "error": None}


def test_a_numeric_status_maps_to_its_word():
    with patch.object(BaseClient, "get", return_value=REPLY):
        assert _client().message_status(536, 4210) == {"status": "read", "error": None}


def test_a_message_chatwoot_no_longer_lists_is_none():
    with patch.object(BaseClient, "get", return_value=REPLY):
        assert _client().message_status(1, 999) is None


def test_the_service_puts_the_meta_code_in_words():
    service = ChatwootService(_client())
    with patch.object(BaseClient, "get", return_value=REPLY):
        assert service.ticket_status(855, 4223) == {"status": "failed", "error": "Not on WhatsApp"}
        assert service.ticket_status(853, 4221) == {"status": "delivered", "error": None}
        assert service.ticket_status(1, 999) is None
