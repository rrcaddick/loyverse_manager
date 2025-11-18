from datetime import datetime


def format_date(date_string: str) -> str:
    """Convert ISO datetime to date string (YYYY-MM-DD)"""
    parsed_date = datetime.strptime(date_string, "%Y-%m-%dT%H:%M:%S.%fZ")
    return parsed_date.strftime("%Y-%m-%d")


def format_time(date_string: str) -> str:
    """Convert ISO datetime to time string (HH:MM:SS)"""
    parsed_date = datetime.strptime(date_string, "%Y-%m-%dT%H:%M:%S.%fZ")
    return parsed_date.strftime("%H:%M:%S")
