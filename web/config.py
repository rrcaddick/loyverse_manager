import os

from dotenv import load_dotenv

from config.constants import CATEGORIES, GAZEBO_MAP, LOYVERSE_STORE_ID
from config.settings import BASE_DIR as PROJECT_ROOT
from config.settings import LOYVERSE_API_KEY

load_dotenv()


class Config:
    """Base configuration"""

    SECRET_KEY = os.getenv("SECRET_KEY", "development-secret-key")
    BASE_DIR = PROJECT_ROOT / "web"

    # Loyverse
    LOYVERSE_API_KEY = LOYVERSE_API_KEY
    LOYVERSE_STORE_ID = LOYVERSE_STORE_ID

    # Database
    MYSQL_HOST = os.getenv("MYSQL_HOST")
    MYSQL_USER = os.getenv("MYSQL_USER")
    MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD")
    MYSQL_DB = os.getenv("MYSQL_DB")

    # WhatsApp Business API
    WHATSAPP_PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    WHATSAPP_ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN")
    WHATSAPP_BUSINESS_ACCOUNT_ID = os.getenv("WHATSAPP_BUSINESS_ACCOUNT_ID")
    WHATSAPP_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN")

    # Paths
    PDF_OUTPUT_DIR = BASE_DIR / "static" / "pdfs"

    CATEGORIES = CATEGORIES
    GAZEBO_MAP = GAZEBO_MAP

    CHATWOOT_URL = os.getenv("CHATWOOT_URL")
    CHATWOOT_API_TOKEN = os.getenv("CHATWOOT_API_TOKEN")
    CHATWOOT_ACCOUNT_ID = os.getenv("CHATWOOT_ACCOUNT_ID")
    CHATWOOT_INBOX_ID = os.getenv("CHATWOOT_INBOX_ID")
