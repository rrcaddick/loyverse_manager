from src.clients.base import BaseClient


class QuicketClient(BaseClient):
    def __init__(self, api_key, user_token):
        super().__init__(
            base_url="https://api.quicket.co.za/api/",
            headers={"usertoken": user_token},
            params={"api_key": api_key},
        )
