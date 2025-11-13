from src.clients.base import BaseClient


class LoyverseClient(BaseClient):
    def __init__(self, api_key):
        super().__init__(
            base_url="https://api.loyverse.com/v1.0/",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            params={"limit": 250},
        )

    def get(self, endpoint, params=None):
        response = super().get(endpoint, params)
        if not response.get("cursor"):
            return response

        data = response[endpoint]

        while response.get("cursor"):
            response = super().get(
                endpoint, {**(params or {}), "cursor": response["cursor"]}
            )
            data.extend(response[endpoint])

        return {endpoint: data}
