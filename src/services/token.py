from datetime import datetime, timedelta, timezone

import jwt

from config.settings import IMAGE_TOKEN_SECRET


class TokenService:
    @staticmethod
    def generate_ticket_image_token(barcode: str, ttl_minutes: int = 5) -> bytes:
        """
        Generate a short-lived JWT token for accessing a ticket image

        Args:
            barcode: The booking barcode
            ttl_minutes: Time to live in minutes (default: 5)

        Returns:
            JWT token string
        """
        now = datetime.now(timezone.utc)
        payload = {
            "barcode": barcode,
            "purpose": "ticket_image",
            "iat": now,
            "exp": now + timedelta(minutes=ttl_minutes),
        }

        secret = IMAGE_TOKEN_SECRET
        if not secret:
            raise ValueError("IMAGE_TOKEN_SECRET not configured")

        return jwt.encode(payload, secret, algorithm="HS256")

    @staticmethod
    def verify_ticket_image_token(token: str, barcode: str) -> tuple[bool, str]:
        """
        Verify a ticket image JWT token

        Args:
            token: JWT token to verify
            barcode: Expected barcode from URL

        Returns:
            Tuple of (is_valid, error_message)
            - (True, "") if valid
            - (False, "expired") if token expired
            - (False, "invalid") if token invalid/malformed
            - (False, "mismatch") if barcode doesn't match token
            - (False, "purpose") if wrong purpose
        """
        secret = IMAGE_TOKEN_SECRET
        if not secret:
            return False, "config"

        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])

            # Verify purpose
            if payload.get("purpose") != "ticket_image":
                return False, "purpose"

            # Verify barcode matches (convert to string for comparison)
            if str(payload.get("barcode")) != str(barcode):
                return False, "mismatch"

            return True, ""

        except jwt.ExpiredSignatureError:
            return False, "expired"
        except jwt.InvalidTokenError:
            return False, "invalid"
