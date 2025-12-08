import time
from datetime import date, datetime
from typing import Optional

from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as ec
from selenium.webdriver.support.ui import WebDriverWait

from config.settings import ENV, HOME_DIR


class QuicketBot:
    def __init__(self, email: str, password: str, logger):
        self.email = email
        self.password = password
        self.logger = logger
        self._driver: Optional[webdriver.Chrome] = None
        self._wait: Optional[WebDriverWait] = None

    @property
    def driver(self) -> webdriver.Chrome:
        """Get driver, checking once here."""
        if self._driver is None:
            raise RuntimeError("Browser not started")
        return self._driver

    @property
    def wait(self) -> WebDriverWait:
        """Get wait, checking once here."""
        if self._wait is None:
            raise RuntimeError("Browser not started")
        return self._wait

    def __enter__(self):
        """Context manager entry point."""
        self.start_browser()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        """Context manager exit point for cleanup."""
        self.stop_browser()

    def start_browser(self, max_retries=3):
        """Initialize the browser and WebDriver."""
        retries = max_retries
        last_error = None

        while retries > 0:
            try:
                chrome_options = webdriver.ChromeOptions()

                chrome_options.add_argument("--no-sandbox")
                chrome_options.add_argument("--headless")
                chrome_options.add_argument("--disable-gpu")

                chrome_kwargs = {
                    "options": chrome_options,
                }

                if ENV == "prod":
                    chrome_options.binary_location = (
                        f"{HOME_DIR}/chrome/chrome-linux64/chrome"
                    )
                    service = Service(
                        executable_path=f"{HOME_DIR}/chrome/chromedriver-linux64/chromedriver"
                    )

                    chrome_kwargs["service"] = service

                self._driver = webdriver.Chrome(**chrome_kwargs)
                self._wait = WebDriverWait(self.driver, 10)
                return
            except Exception as e:
                last_error = e
                retries -= 1
                if retries > 0:
                    self.logger.warning(
                        f"Browser start attempt {max_retries - retries}/{max_retries} failed: {type(e).__name__}: {str(e)}"
                    )
                    time.sleep(2)
                else:
                    self.logger.error(
                        f"Failed to start browser after {max_retries} attempts: {type(e).__name__}: {str(e)}"
                    )
                    raise last_error

    def stop_browser(self):
        """Quit the browser and clean up resources."""
        if getattr(self, "_driver", None):
            self._driver.quit()
            self._driver = None

        self._wait = None

    def restart_browser(self):
        """Restart the browser session with complete cleanup."""
        import time

        # Force cleanup of any lingering processes
        if getattr(self, "_driver", None):
            try:
                self._driver.quit()
            except Exception:
                pass  # Ignore errors during forced cleanup
            finally:
                self._driver = None

        self._wait = None

        # Give the system a moment to clean up resources
        time.sleep(2)

        # Start fresh
        self.start_browser()

    def _login(self):
        """Log in to the Quicket platform."""
        try:
            self.driver.get(
                "https://www.quicket.co.za/account/authentication/login.aspx",
            )

            email_input = self.wait.until(
                ec.presence_of_element_located(
                    (By.ID, "BodyContent_BodyContent_UserName"),
                ),
            )
            email_input.send_keys(self.email)

            password_input = self.wait.until(
                ec.presence_of_element_located(
                    (By.ID, "BodyContent_BodyContent_Password"),
                ),
            )
            password_input.send_keys(self.password)

            try:
                reject_cookies_button = self.wait.until(
                    ec.element_to_be_clickable((By.ID, "onetrust-reject-all-handler"))
                )
                reject_cookies_button.click()
            except TimeoutException:
                self.logger.info("No cookies popup found - continuing")

            login_button = self.wait.until(
                ec.element_to_be_clickable(
                    (By.ID, "BodyContent_BodyContent_LoginButton"),
                ),
            )
            login_button.click()
        except TimeoutException as e:
            failure_message = (
                "Failed to log in. Check your credentials or internet connection.",
            )
            raise RuntimeError(failure_message) from e

    def _navigate_to_event(self, event_id: str):
        """Navigate directly to the event details page."""
        event_url = f"https://www.quicket.co.za/app/#/account/event/{event_id}/details"
        self.driver.get(event_url)

    def _expand_header(self, header):
        """Expand an accordion header."""
        try:
            self.driver.execute_script("arguments[0].scrollIntoView(true);", header)
            self.wait.until(ec.element_to_be_clickable(header)).click()
        except Exception as e:
            failure_message = (
                f"Failed to expand header: {header.get_attribute('id')}",
            )
            raise RuntimeError(failure_message) from e

    def _locate_date_element(self, content, target_date: date):
        """Locate the date element matching the target date within a content panel."""
        date_elements = content.find_elements(
            By.CSS_SELECTOR,
            '[id^="schedule-item-start-date-"]',
        )
        for date_element in date_elements:
            date_value = date_element.get_attribute("value")
            element_date = datetime.strptime(date_value, "%d/%m/%Y, %H:%M:%S").date()
            if element_date == target_date:
                self.driver.execute_script(
                    "arguments[0].scrollIntoView(true);",
                    date_element,
                )
                return date_element
        return None

    def _click_eye_icon(self, content, date_element):
        """Click the eye icon corresponding to the given date element."""
        try:
            date_element_id = date_element.get_attribute("id")
            unhide_icon_id = date_element_id.replace(
                "schedule-item-start-date",
                "unhide-schedule-item",
            )
            try:
                unhide_icon = content.find_element(By.ID, unhide_icon_id)
                if unhide_icon:
                    return False
            except NoSuchElementException:
                pass

            hide_icon_id = date_element_id.replace(
                "schedule-item-start-date",
                "hide-schedule-item",
            )
            eye_icon = content.find_element(By.ID, hide_icon_id)
            self.driver.execute_script("arguments[0].scrollIntoView(true);", eye_icon)
            eye_icon.click()
        except NoSuchElementException as e:
            failure_message = (
                "Neither hide nor unhide icon found for "
                f"date element: {date_element.get_attribute('id')}"
            )
            raise RuntimeError(failure_message) from e
        else:
            return True

    def _click_save_button(self):
        """Click the SAVE button and wait for the loading state to complete."""
        try:
            save_button = self.wait.until(
                ec.element_to_be_clickable(
                    (By.XPATH, "//button[.//div[text()='SAVE']]"),
                ),
            )
            save_button.click()

            # Wait for the success message or button state to stop loading
            success_message_xpath = (
                "//span[contains(@class, 'notification-title') and "
                "text()='Successfully updated']"
            )
            self.wait.until(
                ec.presence_of_element_located(
                    (
                        By.XPATH,
                        success_message_xpath,
                    ),
                ),
            )

        except TimeoutException as e:
            failure_message = "Failed to detect success message after clicking SAVE."
            raise RuntimeError(failure_message) from e

    def _hide_event_once(self, target_date: date):
        """Hide the event: expand headers, locate the target date, and save."""
        accordion_headers = self.wait.until(
            ec.presence_of_all_elements_located(
                (By.CSS_SELECTOR, '[id^="mat-expansion-panel-header-"]'),
            ),
        )

        for header in accordion_headers:
            self._expand_header(header)

            content_id = header.get_attribute("id")
            if content_id is None:
                raise RuntimeError("Header element missing id attribute")

            content_id = content_id.replace(
                "mat-expansion-panel-header",
                "cdk-accordion-child",
            )

            content = self.wait.until(
                ec.presence_of_element_located((By.ID, content_id)),
            )

            date_element = self._locate_date_element(content, target_date)
            if date_element:
                icon_clicked = self._click_eye_icon(content, date_element)
                if icon_clicked:
                    self._click_save_button()
                return
        failure_message = f"Target date {target_date} not found in any headers."
        raise RuntimeError(failure_message)

    def hide_event(
        self, event_id: str, target_date: date, max_retries: int | None = None
    ) -> None:
        """
        Hide event for the specified date with automatic retry logic.

        This method will attempt to hide the event up to max_retries times,
        restarting the browser between attempts if failures occur.

        Args:add-
            event_id: The Quicket event ID to hide
            target_date: The date for which to hide the event

        Raises:
            RuntimeError: If all retry attempts fail
        """
        if max_retries is None:
            max_retries = 5

        last_error = None

        for attempt in range(1, max_retries + 1):
            try:
                self.logger.info(
                    f"Attempting to hide event {event_id} (attempt {attempt}/{max_retries})"
                )

                self._login()
                self._navigate_to_event(event_id)
                self._hide_event_once(target_date)

                self.logger.info(
                    f"Successfully hid event {event_id} on attempt {attempt}"
                )
                return  # Success - exit the method

            except Exception as e:
                last_error = e
                self.logger.warning(
                    f"Attempt {attempt}/{max_retries} failed to hide event {event_id}: "
                    f"{type(e).__name__}: {str(e)}"
                )

                # If this isn't the last attempt, restart browser and wait before retry
                if attempt < max_retries:
                    wait_time = 2 * attempt  # Exponential backoff
                    self.logger.info(
                        f"Restarting browser and waiting {wait_time} seconds before retry..."
                    )

                    try:
                        self.restart_browser()
                    except Exception as restart_error:
                        self.logger.error(
                            f"Failed to restart browser: {type(restart_error).__name__}: {str(restart_error)}"
                        )
                        # Continue anyway - the next attempt will try to use the browser

                    time.sleep(wait_time)

        # All retries exhausted - raise the last error
        self.logger.error(
            f"Failed to hide event {event_id} after {max_retries} attempts"
        )
        raise RuntimeError(
            f"Failed to hide event {event_id} after {max_retries} attempts"
        ) from last_error
