"""The Chatwoot client hands back the contact whatever the reply's shape (19 Nov 2026)."""

from unittest.mock import patch

from src.clients.base import BaseClient
from src.clients.chatwoot import ChatwootClient


def _create(reply):
    client = ChatwootClient(base_url="https://chat.example", api_token="t", account_id="1")
    with patch.object(BaseClient, "post", return_value=reply):
        return client.create_contact("27790728110", "Michelle")


def test_current_chatwoot_wraps_the_contact():
    assert _create({"payload": {"contact": {"id": 830, "phone_number": "+27790728110"}, "contact_inbox": None}})["id"] == 830


def test_older_chatwoot_returns_the_contact_in_payload():
    assert _create({"payload": {"id": 664, "phone_number": "+27832790550"}})["id"] == 664


def test_a_bare_contact_reply_passes_through():
    assert _create({"id": 1, "phone_number": "+27000000000"})["id"] == 1
