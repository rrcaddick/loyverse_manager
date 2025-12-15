import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Environment
ENV = os.getenv("ENV", "prod")

HOME_DIR = os.path.expanduser("~")

# Project root directory
BASE_DIR = Path(__file__).parent.parent
KEYS_DIR = BASE_DIR / "keys"
MIGRATIONS_DIR = BASE_DIR / "migrations"

# API Keys and credentials from .env
QUICKET_API_KEY = os.getenv("QUICKET_API_KEY")
QUICKET_USER_TOKEN = os.getenv("QUICKET_USER_TOKEN")
QUICKET_EMAIL = os.getenv("QUICKET_EMAIL")
QUICKET_PASSWORD = os.getenv("QUICKET_PASSWORD")

LOYVERSE_API_KEY = os.getenv("LOYVERSE_API_KEY")

# MySQL Database
MYSQL_HOST = os.getenv("MYSQL_HOST")
MYSQL_USER = os.getenv("MYSQL_USER")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD")
MYSQL_DB = os.getenv("MYSQL_DB")

SMTP_SERVER = os.getenv("SMTP_SERVER")
SMTP_PORT = int(os.getenv("SMTP_PORT", 465))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")

ADD_PAY_APP_ID = os.getenv("ADD_PAY_APP_ID")
ADD_PAY_MERCHANT_NO = os.getenv("ADD_PAY_MERCHANT_NO")

# WhatsApp Business API
WHATSAPP_PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
WHATSAPP_ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN")
WHATSAPP_BUSINESS_ACCOUNT_ID = os.getenv("WHATSAPP_BUSINESS_ACCOUNT_ID")
WHATSAPP_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN")

# Chatwoot
CHATWOOT_URL = os.getenv("CHATWOOT_URL")
CHATWOOT_API_TOKEN = os.getenv("CHATWOOT_API_TOKEN")
CHATWOOT_ACCOUNT_ID = os.getenv("CHATWOOT_ACCOUNT_ID")
CHATWOOT_INBOX_ID = os.getenv("CHATWOOT_INBOX_ID")

IMAGE_TOKEN_SECRET = os.getenv("IMAGE_TOKEN_SECRET")


# Load private/public keys from files
def load_key_file(filename):
    """Load key from file."""
    key_path = KEYS_DIR / filename
    if not key_path.exists():
        raise FileNotFoundError(f"Key file not found: {key_path}")
    with open(key_path, "r") as f:
        return f.read()


PAYCLOUD_APP_PRIVATE_KEY = load_key_file("paycloud/app_private_key.pem")
PAYCLOUD_GATEWAY_PUBLIC_KEY = load_key_file("paycloud/gateway_public_key.pem")

ARONIUM_PATH = BASE_DIR / "db" / "aronium" / "pos.db"
