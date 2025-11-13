import sys

from config.constants import (
    CATEGORIES,
    GAZEBO_MAP,
    LOYVERSE_STORE_ID,
    NOTIFICATION_RECIPIENTS,
)
from config.settings import (
    LOYVERSE_API_KEY,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_SERVER,
    SMTP_USERNAME,
)
from src.clients.loyverse import LoyverseClient
from src.services.loyverse import LoyverseService
from src.services.notification import NoticifationService
from src.utils.date import get_today
from src.utils.logging import setup_logger


def main():
    logger = setup_logger("clear_inventory")
    notification_service = NoticifationService(
        SMTP_SERVER, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_USERNAME
    )

    try:
        logger.info("Starting inventory clearing process")

        # Initialize clients
        loyverse_client = LoyverseClient(LOYVERSE_API_KEY)

        # Initialize services
        loyverse_service = LoyverseService(
            loyverse_client, LOYVERSE_STORE_ID, CATEGORIES, GAZEBO_MAP
        )

        # Clear items from specified categories
        logger.info("Clearing items from specified categories")
        loyverse_service.clear_items(
            [CATEGORIES["groups"], CATEGORIES["online_ticket"]],
        )

        # Reset inventory
        logger.info("Resetting inventory levels")
        loyverse_service.reset_inventory()
        logger.info("Inventory levels reset successfully")

        notification_service.send_inventory_clear_success(
            recipients=NOTIFICATION_RECIPIENTS,
            date=get_today(),
        )

    except Exception as e:
        logger.error(f"Error: {type(e).__name__}: {str(e)}")

        notification_service.send_inventory_failure_notification(
            recipients=NOTIFICATION_RECIPIENTS,
            date=get_today(),
            action="clear",
            error=e,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
