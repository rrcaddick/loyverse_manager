from datetime import date

from src.repositories.mysql import get_bookings_by_date


class GroupService:
    """Service for handling group bookings"""

    def __init__(self, target_date: date):
        """
        Initialize GroupService

        Args:
            target_date: The date to fetch group bookings for
        """
        self.target_date = target_date

    def get_groups_for_date(self) -> list[dict]:
        """
        Get all group bookings for the target date

        Returns:
            List of group booking dictionaries
        """
        return get_bookings_by_date(self.target_date)

    def format_group_for_display(self, group: dict) -> dict:
        """
        Format a group booking for display purposes

        Args:
            group: Group booking dictionary from database

        Returns:
            Formatted group information
        """
        return {
            "id": group["id"],
            "group_name": group["group_name"],
            "contact_person": group["contact_person"],
            "mobile_number": group["mobile_number"],
            "visit_date": group["visit_date"],
            "barcode": group["barcode"],
        }
