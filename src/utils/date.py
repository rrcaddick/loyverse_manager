from datetime import datetime
from zoneinfo import ZoneInfo


def get_today():
    """Get current date in Johannesburg timezone."""
    return datetime.now(ZoneInfo("Africa/Johannesburg")).date()
