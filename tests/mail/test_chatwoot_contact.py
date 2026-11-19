"""The Chatwoot client hands back the contact whatever the reply's shape (19 Nov 2026)."""

from src.clients.chatwoot import ChatwootClient


class _Client(ChatwootClient):
    def __init__(self, reply):
        self.reply = reply
        self.account_id = "1"
        self.headers = {}

    def post(self, endpoint, payload):  # noqa: ARG002 - the shape under test is the reply's
        return self.reply


def test_current_chatwoot_wraps_the_contact():
    c = _Client({"payload": {"contact": {"id": 830, "phone_number": "+27790728110"}, "contact_inbox": None}})
    assert c.create_contact("27790728110", "Michelle")["id"] == 830


def test_older_chatwoot_returns_the_contact_in_payload():
    c = _Client({"payload": {"id": 664, "phone_number": "+27832790550"}})
    assert c.create_contact("+27832790550")["id"] == 664


def test_a_bare_contact_reply_passes_through():
    c = _Client({"id": 1, "phone_number": "+27000000000"})
    assert c.create_contact("27000000000")["id"] == 1
