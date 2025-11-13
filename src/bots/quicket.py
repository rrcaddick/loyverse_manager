from datetime import date, datetime
from typing import Optional

from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as ec
from selenium.webdriver.support.ui import WebDriverWait


class QuicketBot:
    def __init__(self, driver_path: str, email: str, password: str, logger):
        self.driver_path = driver_path
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

    def start_browser(self):
        """Initialize the browser and WebDriver."""
        # Add chrome options
        chrome_options = webdriver.ChromeOptions()
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--disable-gpu")

        # Initialize WebDriver
        self._driver = webdriver.Chrome(options=chrome_options)
        self._wait = WebDriverWait(self.driver, 10)

    def stop_browser(self):
        """Quit the browser and clean up resources."""
        if getattr(self, "_driver", None):
            self._driver.quit()
            self._driver = None

        self._wait = None

    def restart_browser(self):
        """Restart the browser session."""
        self.stop_browser()
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

    def _hide_event(self, target_date: date):
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
        self, event_id: str, target_date: date, max_retries: int = 3
    ) -> None:
        """Hide event with automatic retry logic."""
        retries = max_retries

        while retries > 0:
            try:
                if retries != max_retries:
                    self.logger.info("Retrying hide event - restarting browser")
                    self.restart_browser()

                self._login()
                self._navigate_to_event(event_id)
                self._hide_event(target_date)
                self.logger.info(f"Successfully hid event {event_id}")
                return
            except Exception as e:
                retries -= 1
                if retries == 0:
                    self.logger.error(
                        f"Failed to hide event after {max_retries} attempts"
                    )
                    raise
                self.logger.warning(
                    f"Retry {max_retries - retries}/{max_retries} failed: {e}"
                )
