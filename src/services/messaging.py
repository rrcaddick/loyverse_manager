"""Factory for the WhatsApp send path (Chatwoot), shared by the ticket actions.

Moved out of the old groups route so API modules and scripts can use it.
Built lazily and cached: constructing it at import time meant a missing
CHATWOOT_INBOX_ID took down the whole app at startup.
"""

from __future__ import annotations

from functools import lru_cache

from config.settings import (
    CHATWOOT_ACCOUNT_ID,
    CHATWOOT_API_TOKEN,
    CHATWOOT_INBOX_ID,
    CHATWOOT_URL,
)
from src.clients.chatwoot import ChatwootClient
from src.services.chatwoot import ChatwootService


@lru_cache(maxsize=1)
def get_messaging_service() -> ChatwootService:
    if not CHATWOOT_INBOX_ID:
        raise ValueError("CHATWOOT_INBOX_ID not configured")
    client = ChatwootClient(
        base_url=CHATWOOT_URL,
        api_token=CHATWOOT_API_TOKEN,
        account_id=CHATWOOT_ACCOUNT_ID,
    )
    return ChatwootService(client=client, inbox_id=CHATWOOT_INBOX_ID)
