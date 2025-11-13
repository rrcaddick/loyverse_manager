import base64
import json
import time

import requests
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15


class PayCloudClient:
    def __init__(self, app_id, app_private_key, gateway_public_key, base_url):
        self.app_id = app_id
        self.private_key = RSA.import_key(app_private_key)
        self.public_key = RSA.import_key(gateway_public_key)
        self.base_url = base_url

    def _sign(self, params):
        # Remove empty or null values
        params = {k: v for k, v in params.items() if v is not None and v != ""}

        # Convert nested JSON objects to strings
        for key, value in params.items():
            if isinstance(value, (dict, list)):
                params[key] = json.dumps(
                    value, separators=(",", ":")
                )  # Compact JSON format

        # Sort parameters alphabetically by their keys
        sorted_params = sorted(params.items(), key=lambda x: x[0])

        # Concatenate the sorted parameters into a single string
        content_to_sign = "&".join(f"{k}={v}" for k, v in sorted_params)

        # Hash the concatenated string using SHA-256
        hash_value = SHA256.new(content_to_sign.encode("utf-8"))

        # Sign the hash using the RSA private key
        signature = pkcs1_15.new(self.private_key).sign(hash_value)

        # Encode the signature as a Base64 string
        return base64.b64encode(signature).decode("utf-8")

    def _encrypt(self, data):
        cipher = PKCS1_OAEP.new(self.public_key)
        encrypted_data = cipher.encrypt(data.encode("utf-8"))
        return base64.b64encode(encrypted_data).decode("utf-8")

    def _decrypt(self, encrypted_data):
        cipher = PKCS1_OAEP.new(self.private_key)
        decrypted_data = cipher.decrypt(base64.b64decode(encrypted_data))
        return decrypted_data.decode("utf-8")

    def send_request(self, endpoint, method, payload):
        # Add required parameters
        payload.update(
            {
                "app_id": self.app_id,
                "format": "JSON",
                "charset": "UTF-8",
                "sign_type": "RSA2",
                "version": "1.0",
                "timestamp": int(time.time() * 1000),
                "method": method,
            }
        )

        # Generate the signature
        payload["sign"] = self._sign(payload)

        gateway_url = f"{self.base_url}{endpoint}"

        # Send the HTTP request
        response = requests.post(
            gateway_url, json=payload, headers={"Content-Type": "application/json"}
        )

        # Check and verify the response
        if response.status_code == 200:
            response_data = response.json()
            if not self._verify_response(response_data):
                raise ValueError("Response signature verification failed")
            return response_data
        else:
            response.raise_for_status()

    def _verify_response(self, response_data):
        if "sign" not in response_data:
            return False

        sign = response_data.pop("sign")
        sorted_params = sorted(response_data.items(), key=lambda x: x[0])
        content_to_verify = "&".join(f"{k}={v}" for k, v in sorted_params)

        hash_value = SHA256.new(
            content_to_verify.encode("utf-8")
        )  # Use SHA256 from Crypto.Hash
        signature = base64.b64decode(sign)

        try:
            pkcs1_15.new(self.public_key).verify(hash_value, signature)
            return True
        except (ValueError, TypeError):
            return False
