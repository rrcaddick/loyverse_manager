# config/constants.py
from datetime import date

from config.settings import BASE_DIR
from src.utils.date import get_today

# Loyverse Configuration
LOYVERSE_STORE_ID = "8d44fa8a-4ee6-4a18-a1b3-15ace8a3138c"

ONLINE_ITEM_IMAGE_PATH = BASE_DIR / "images" / "product_image_online.png"

CATEGORIES = {
    "online_ticket": "6d089f1a-f067-4d10-871c-f2a4724e4c2b",
    "groups": "f6f65c8a-c46a-4312-952b-74177d2e6a1d",
    "gazebo": "08c74bdf-b23a-4dbb-a82d-3a059fb3a330",
}

GAZEBO_MAP = {
    "Hire Gazebo #1": "e6b7518f-8fba-462a-9dce-62190735bac0",
    "Hire Gazebo #2": "914b1184-6b07-4bc6-a4b9-4560f642386c",
    "Hire Gazebo #3": "19fa0561-b273-4c1e-a318-90f1a4e8cd3e",
    "Hire Gazebo #4": "7dc346e3-210c-470e-934b-26bdfa4648dd",
    "Hire Gazebo #5": "55cea105-c843-4913-bd5a-c735941cfd54",
    "Hire Gazebo #6": "d0a16dd9-eb6e-4c72-a043-274fdb74d0a5",
    "Hire Gazebo #7": "88344d36-77a7-4206-8ac4-5af07fe667ec",
    "Gazebo #1": "e6b7518f-8fba-462a-9dce-62190735bac0",
    "Gazebo #2": "914b1184-6b07-4bc6-a4b9-4560f642386c",
    "Gazebo #3": "19fa0561-b273-4c1e-a318-90f1a4e8cd3e",
    "Gazebo #4": "7dc346e3-210c-470e-934b-26bdfa4648dd",
    "Gazebo #5": "55cea105-c843-4913-bd5a-c735941cfd54",
    "Gazebo #6": "d0a16dd9-eb6e-4c72-a043-274fdb74d0a5",
    "Gazebo #7": "88344d36-77a7-4206-8ac4-5af07fe667ec",
}


GAZEBOS = [
    {
        "loyverse_id": "e6b7518f-8fba-462a-9dce-62190735bac0",
        "loyverse_name": "Gazebo #1",
        "quicket_name": "Hire Gazebo #1",
    },
    {
        "loyverse_id": "914b1184-6b07-4bc6-a4b9-4560f642386c",
        "loyverse_name": "Gazebo #2",
        "quicket_name": "Hire Gazebo #2",
    },
    {
        "loyverse_id": "19fa0561-b273-4c1e-a318-90f1a4e8cd3e",
        "loyverse_name": "Gazebo #3",
        "quicket_name": "Hire Gazebo #3",
    },
    {
        "loyverse_id": "7dc346e3-210c-470e-934b-26bdfa4648dd",
        "loyverse_name": "Gazebo #4",
        "quicket_name": "Hire Gazebo #4",
    },
    {
        "loyverse_id": "55cea105-c843-4913-bd5a-c735941cfd54",
        "loyverse_name": "Gazebo #5",
        "quicket_name": "Hire Gazebo #5",
    },
    {
        "loyverse_id": "d0a16dd9-eb6e-4c72-a043-274fdb74d0a5",
        "loyverse_name": "Gazebo #6",
        "quicket_name": "Hire Gazebo #6",
    },
    {
        "loyverse_id": "88344d36-77a7-4206-8ac4-5af07fe667ec",
        "loyverse_name": "Gazebo #7",
        "quicket_name": "Hire Gazebo #7",
    },
]

# Notification Configuration
NOTIFICATION_RECIPIENTS = [
    "admin@farmyardpark.co.za",
    "farmyardmanagers@gmail.com",
]

# Season Configuration
SEASON_START = date(2025, 10, 1)

# AddPay Terminal Configuration
ADD_PAY_TERMINALS = [
    "WPYB002349002969",
    "WPYB002452000295",
]


ADD_PAY_TERMINALS_HISTORY = {
    2024: [
        "WPYB002349002969",
        "WPYB002349002930",
        "WPYB002248000001",
    ],
    2025: [
        "WPYB002349002969",
        "WPYB002452000295",
    ],
}

# Current date (can be overridden for testing)
TODAY = get_today()
