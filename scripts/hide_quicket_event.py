import sys

from config.constants import (
    GAZEBO_MAP,
    LOYVERSE_STORE_ID,
    NOTIFICATION_RECIPIENTS,
)
from config.settings import (
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
from src.clients.quicket import QuicketClient
from src.services.notification import NoticifationService
from src.services.quicket import QuicketService
from src.utils.date import get_today
from src.utils.logging import setup_logger

TODAY = get_today()


def hide_quicket_event() -> None:
    logger = setup_logger("hide_quicket_event")

    try:
        logger.info("Starting Quicket event hide process")

        # Initialize clients
        quicket_client = QuicketClient(QUICKET_API_KEY, QUICKET_USER_TOKEN)

        # Initialize services
        notification_service = NoticifationService(
            SMTP_SERVER, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_USERNAME
        )

        quicket_service = QuicketService(
            quicket_client,
            LOYVERSE_STORE_ID,
            TODAY,
            GAZEBO_MAP,
        )

        # Get today's event
        event_id = quicket_service.get_event_id()

        if event_id is None:
            logger.info("No Quicket event scheduled for today")
            return

        logger.info(f"Attempting to hide Quicket event ID: {event_id}")

        assert QUICKET_EMAIL is not None, "QUICKET_EMAIL env is not set"
        assert QUICKET_PASSWORD is not None, "QUICKET_PASSWORD env is not set"

        try:
            with QuicketBot(
                email=QUICKET_EMAIL,
                password=QUICKET_PASSWORD,
                logger=setup_logger("quicket_bot"),
            ) as quicket_bot:
                quicket_bot.hide_event(event_id, TODAY)

            logger.info(f"Successfully hid Quicket event {event_id}")

        except Exception as hide_error:
            logger.error(
                f"Failed to hide Quicket event {event_id}: "
                f"{type(hide_error).__name__}: {str(hide_error)}"
            )

            notification_service.send_quicket_event_hide_failure(
                recipients=NOTIFICATION_RECIPIENTS,
                date=TODAY,
            )

            raise

    except Exception as e:
        logger.error(
            f"Error while running hide_quicket_event: {type(e).__name__}: {str(e)}"
        )
        raise


def main() -> None:
    try:
        hide_quicket_event()
    except Exception:
        sys.exit(1)


if __name__ == "__main__":
    main()
