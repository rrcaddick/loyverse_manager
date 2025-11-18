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

    # Paths
    PDF_OUTPUT_DIR = BASE_DIR / "static" / "pdfs"

    CATEGORIES = CATEGORIES
    GAZEBO_MAP = GAZEBO_MAP
