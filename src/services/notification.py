import smtplib
import traceback
from datetime import date
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Literal


class NoticifationService:
    def __init__(
        self, smtp_server, smtp_port, username, password, sender_email, use_ssl=True
    ):
        self.smtp_server = smtp_server
        self.smtp_port = smtp_port
        self.username = username
        self.password = password
        self.sender_email = sender_email
        self.use_ssl = use_ssl

    def send_notification(self, recipient_emails, subject, message):
        msg = MIMEMultipart()
        msg["From"] = self.sender_email
        msg["To"] = ", ".join(recipient_emails)
        msg["Subject"] = subject

        msg.attach(MIMEText(message, "plain"))

        try:
            if self.use_ssl:
                server = smtplib.SMTP_SSL(self.smtp_server, self.smtp_port)
            else:
                server = smtplib.SMTP(self.smtp_server, self.smtp_port)
                server.starttls()

            server.login(self.username, self.password)
            server.send_message(msg)
            server.quit()
            return True
        except Exception as e:
            print(f"Failed to send email: {str(e)}")
            return False

    def send_inventory_update_success(
        self, recipients: list[str], date: date, order_count: int
    ) -> None:
        """Send inventory update success notification."""
        subject = f"Inventory Update Success - {date}"
        message = (
            f"Inventory update completed successfully for {date}\n"
            f"Processed {order_count} orders\n"
        )
        self.send_notification(recipients, subject, message)

    def send_inventory_clear_success(self, recipients: list[str], date: date) -> None:
        """Send inventory clear success notification."""
        subject = f"Inventory Clear Success - {date}"
        message = (
            "Inventory clearing completed successfully; "
            "Cleared items from categories: groups and online_ticket; "
            "Reset gazebo inventory levels to default"
        )
        self.send_notification(recipients, subject, message)

    def send_inventory_failure_notification(
        self,
        recipients: list[str],
        date: date,
        action: Literal["update", "clear"],
        error: Exception,
    ) -> None:
        """Send inventory update/clear failure notification."""
        subject = f"Inventory {action} Failed - {date}"
        message = (
            f"Error during inventory {action} process:\n"
            f"Error type: {type(error).__name__}\n"
            f"Error message: {str(error)}\n"
            f"Traceback:\n{traceback.format_exc()}"
        )
        self.send_notification(recipients, subject, message)

    def send_no_event_notification(self, recipients: list[str], date: date) -> None:
        """Send notification when no event is scheduled."""
        subject = f"Inventory Update Status - {date}"
        message = "No event scheduled for today. Process completed successfully."
        self.send_notification(recipients, subject, message)

    def send_quicket_event_hide_failure(
        self,
        recipients: list[str],
        date: date,
    ) -> None:
        """Send quicket event hide failure."""
        subject = f"Quicket event hide failed - {date}"
        message = (
            "Error hiding Quicket event for today:\n"
            "Please manualy, hide the event on Quicket platform.\n"
        )
        self.send_notification(recipients, subject, message)
