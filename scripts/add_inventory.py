import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from config.constants import (
    CATEGORIES,
    GAZEBO_MAP,
    LOYVERSE_STORE_ID,
    NOTIFICATION_RECIPIENTS,
)
from config.settings import (
    LOYVERSE_API_KEY,
    QUICKET_API_KEY,
    QUICKET_EMAIL,
    QUICKET_PASSWORD,
    QUICKET_USER_TOKEN,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_SERVER,
    SMTP_USERNAME,
)
from src.bots.quicket import QuicketBot
from src.clients.loyverse import LoyverseClient
from src.clients.quicket import QuicketClient
from src.services.inventory import InventoryService
from src.services.loyverse import LoyverseService
from src.services.notification import NoticifationService
from src.services.quicket import QuicketService
from src.utils.date import get_today
from src.utils.logging import setup_logger

TODAY = datetime(2025, 11, 8, tzinfo=ZoneInfo("Africa/Johannesburg")).date()
TODAY = get_today()


def main():
    logger = setup_logger("add_inventory")

    try:
        logger.info("Starting inventory update process")

        # Initialize clients
        quicket_client = QuicketClient(QUICKET_API_KEY, QUICKET_USER_TOKEN)
        loyverse_client = LoyverseClient(LOYVERSE_API_KEY)

        # Initialize services
        notification_service = NoticifationService(
            SMTP_SERVER, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_USERNAME
        )

        loyverse_service = LoyverseService(
            loyverse_client, LOYVERSE_STORE_ID, CATEGORIES, GAZEBO_MAP
        )

        quicket_service = QuicketService(
            quicket_client,
            LOYVERSE_STORE_ID,
            TODAY,
            GAZEBO_MAP,
        )

        inventory_service = InventoryService(
            quicket_service=quicket_service,
            loyverse_service=loyverse_service,
        )

        # Check for event
        event_id = quicket_service.get_event_id()

        # No event today
        if event_id is None:
            logger.info("No event scheduled for today")
            notification_service.send_no_event_notification(
                NOTIFICATION_RECIPIENTS, TODAY
            )
            sys.exit(0)

        logger.info(f"Processing event ID: {event_id}")

        # Hide the event
        with QuicketBot(
            email=QUICKET_EMAIL,
            password=QUICKET_PASSWORD,
            logger=setup_logger("quicket_bot"),
        ) as quicket_bot:
            quicket_bot.hide_event(event_id, TODAY, max_retries=3)

        # Get Tickets
        guest_list = quicket_service.get_guest_list(event_id)
        tickets = quicket_service.get_tickets(guest_list)

        # Update gazebo inventory
        gazebo_inventory = quicket_service.get_gazebo_inventory_map(tickets)
        loyverse_service.update_inventory(gazebo_inventory)

        # Create and process Loyverse items
        loyverse_items = inventory_service.create_items_from_quicket_tickets(tickets)

        # Process inventory updates
        for item in loyverse_items:
            # Create item with image
            created_item = loyverse_service.process_item_with_inventory(item)

            # Update order counts
            orders_map = inventory_service.build_orders_inventory_map(created_item)

            # Update order counts
            loyverse_service.update_inventory(orders_map)

        # Send success notification
        logger.info(f"Processed {len(loyverse_items)} orders")
        notification_service.send_inventory_update_success(
            NOTIFICATION_RECIPIENTS, TODAY, len(loyverse_items)
        )

    except Exception as e:
        logger.error(f"Error: {type(e).__name__}: {str(e)}")
        notification_service.send_inventory_failure_notification(
            recipients=NOTIFICATION_RECIPIENTS, date=TODAY, action="update", error=e
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
