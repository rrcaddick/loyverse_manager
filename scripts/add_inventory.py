import sys

from config.constants import (
    CATEGORIES,
    GAZEBO_MAP,
    IMAGE_DIR,
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
from src.models.group_booking import GroupBooking
from src.services.inventory import InventoryService
from src.services.loyverse import LoyverseService
from src.services.notification import NoticifationService
from src.services.quicket import QuicketService
from src.utils.date import get_today
from src.utils.logging import setup_logger

TODAY = get_today()


def add_inventory():
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

        # Track what was processed
        online_ticket_count = 0
        group_booking_count = 0

        # ========================================
        # Process Quicket Event (if exists)
        # ========================================
        event_id = quicket_service.get_event_id()

        if event_id is None:
            logger.info("No Quicket event scheduled for today")
        else:
            logger.info(f"Processing Quicket event ID: {event_id}")

            # Try to hide the event (bot handles retries internally)
            event_hidden_successfully = False
            try:
                with QuicketBot(
                    email=QUICKET_EMAIL,
                    password=QUICKET_PASSWORD,
                    logger=setup_logger("quicket_bot"),
                ) as quicket_bot:
                    quicket_bot.hide_event(event_id, TODAY)
                    event_hidden_successfully = True
            except Exception as hide_error:
                logger.error(
                    f"Failed to hide Quicket event {event_id} after all retry attempts: "
                    f"{type(hide_error).__name__}: {str(hide_error)}"
                )
                # Send notification about the failure but continue processing
                notification_service.send_quicket_event_hide_failure(
                    recipients=NOTIFICATION_RECIPIENTS,
                    date=TODAY,
                )

                # TODO: Send whatsapp message to admin about failure

            # Get Tickets
            guest_list = quicket_service.get_guest_list(event_id)
            tickets = quicket_service.get_tickets(guest_list)

            # Update gazebo inventory
            gazebo_inventory = quicket_service.get_gazebo_inventory_map(tickets)
            loyverse_service.update_inventory(gazebo_inventory)

            # Create and process Loyverse items
            loyverse_items = inventory_service.create_items_from_quicket_tickets(
                tickets
            )

            # Process inventory updates
            for item in loyverse_items:
                # Create item with image
                created_item = loyverse_service.process_item_with_inventory(item)

                # Update order counts
                orders_map = inventory_service.build_orders_inventory_map(created_item)

                # Update order counts
                loyverse_service.update_inventory(orders_map)

            online_ticket_count = len(loyverse_items)
            logger.info(f"Processed {online_ticket_count} online ticket orders")

            if not event_hidden_successfully:
                logger.warning(
                    f"Event {event_id} was NOT hidden - manual intervention required"
                )

        # ========================================
        # Process Group Bookings (always check)
        # ========================================
        logger.info("Checking for group bookings")

        group_bookings = GroupBooking.get_by_date(TODAY)

        if group_bookings:
            logger.info(f"Found {len(group_bookings)} group bookings for today")

            # Create Loyverse items from group bookings
            group_items = inventory_service.create_items_from_group_bookings(
                group_bookings
            )

            # Process each group item with the group image
            group_item_img_path = IMAGE_DIR / "product_image_group.png"
            for group_item in group_items:
                loyverse_service.process_item_with_inventory(
                    group_item, group_item_img_path
                )

            group_booking_count = len(group_bookings)
            logger.info(f"Processed {group_booking_count} group bookings")
        else:
            logger.info("No group bookings found for today")

        # ========================================
        # Send Notification
        # ========================================
        total_items = online_ticket_count + group_booking_count

        if total_items == 0:
            # Nothing to process today
            logger.info("No tickets or groups to process for today")
            notification_service.send_no_event_notification(
                NOTIFICATION_RECIPIENTS, TODAY
            )
        else:
            # Send success notification with breakdown
            logger.info(
                f"Successfully processed {total_items} items "
                f"({online_ticket_count} online tickets, {group_booking_count} groups)"
            )
            notification_service.send_inventory_update_success(
                NOTIFICATION_RECIPIENTS, TODAY, total_items
            )

    except Exception as e:
        logger.error(f"Error: {type(e).__name__}: {str(e)}")
        notification_service.send_inventory_failure_notification(
            recipients=NOTIFICATION_RECIPIENTS, date=TODAY, action="update", error=e
        )
        raise


def main():
    try:
        add_inventory()
    except Exception:
        sys.exit(1)


if __name__ == "__main__":
    main()
