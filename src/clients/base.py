import requests


class BaseClient:
    def __init__(self, base_url, headers, params=None):
        self.base_url = base_url
        self.headers = headers
        self.params = params

    def get(self, endpoint, params={}):
        url = f"{self.base_url}{endpoint}"
        response = requests.get(
            url,
            headers=self.headers,
            params={**self.params, **params},
            timeout=(5, 30),
        )
        response.raise_for_status()
        return response.json()

    def post(self, endpoint, data):
        url = f"{self.base_url}{endpoint}"
        response = requests.post(url, json=data, headers=self.headers, timeout=(5, 30))
        response.raise_for_status()
        return response.json()

    def delete(self, endpoint):
        url = f"{self.base_url}{endpoint}"
        response = requests.delete(url, headers=self.headers, timeout=(30, 60))
        response.raise_for_status()
        return response.json()
