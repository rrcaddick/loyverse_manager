"""Screenshot the public request form and the two Settings pages it feeds.

    .venv/bin/python frontend/scripts/shoot-public-form.py [--base http://localhost:5315]
        [--submit] [--admin-email … --admin-password …] [--only form|settings]

Writes data/screenshots/v2/p5-*.png: the form at 390×844 (every step, the
date sheet, an error summary, the check screen, the sent page) and at
1440×900 (visit and check), and Settings › Booking form / Templates at
1440×900 in Graphite light and Fynbos dark. `--submit` sends ONE real
request ("TEST P5 form …") to reach the sent page; without it the sent
page is rendered from a mocked GET /public/requests/:id so nothing is
created. The acknowledged branch of the sent page is always mocked.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import Page, Route, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "screenshots" / "v2"
PHONE = {"width": 390, "height": 844}
DESKTOP = {"width": 1440, "height": 900}

ANSWERS = {
    "visit_date": "07/11/2026",
    "alternative_date": "14/11/2026",
    "visitors": "45",
    "arrival_time": "10:00",
    "group_name": "TEST P5 form Sunshine Primary Grade 3",
    "group_type": "school",
    "area": "Paarl",
    "vehicles": "2",
    "gazebos": "1",
    "questions": ["Can we bring our own braai?", "Is there shade for the buses?"],
    "customer_notes": "Two learners use wheelchairs.",
    "contact_name": "Sam Test",
    "contact_email": "sam.p5@example.com",
    "contact_mobile": "082 123 4567",
}


def shot(page: Page, name: str, full_page: bool = True) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"p5-{name}.png"
    page.screenshot(path=str(path), full_page=full_page)
    print("wrote", path.relative_to(ROOT))


def next_saturday(after: date) -> date:
    d = after + timedelta(days=1)
    while d.weekday() != 5:
        d += timedelta(days=1)
    return d


def fill_visit(page: Page) -> None:
    page.fill("#visit_date", ANSWERS["visit_date"])
    page.fill("#alternative_date", ANSWERS["alternative_date"])
    page.fill("#visitors", ANSWERS["visitors"])
    page.select_option("#arrival_time", ANSWERS["arrival_time"])


def fill_group(page: Page) -> None:
    page.fill("#group_name", ANSWERS["group_name"])
    page.check(f"#group_type-{ANSWERS['group_type']}")
    page.fill("#area", ANSWERS["area"])
    page.fill("#vehicles", ANSWERS["vehicles"])
    page.fill("#gazebos", ANSWERS["gazebos"])
    page.fill("#questions-0", ANSWERS["questions"][0])
    page.click("text=Add another question")
    page.fill("#questions-1", ANSWERS["questions"][1])
    page.fill("#customer_notes", ANSWERS["customer_notes"])


def fill_contact(page: Page) -> None:
    page.fill("#contact_name", ANSWERS["contact_name"])
    page.fill("#contact_email", ANSWERS["contact_email"])
    page.fill("#contact_mobile", ANSWERS["contact_mobile"])


def mock_sent(page: Page, acknowledged: bool) -> None:
    body = {
        "id": 9999,
        "reference": "FY1799",
        "group_name": ANSWERS["group_name"],
        "visit_date": "2026-11-07",
        "contact_email": ANSWERS["contact_email"],
        "visitors": 45,
        "acknowledged": acknowledged,
        "submitted_at": "2026-10-11T15:04:00",
    }

    def handler(route: Route) -> None:
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    page.route("**/api/v1/public/requests/9999*", handler)


def form_phone(page: Page, base: str, submit: bool) -> None:
    page.goto(f"{base}/request", wait_until="networkidle")
    page.wait_for_selector("#visit_date")
    assert page.url.endswith("/request/visit"), page.url
    shot(page, "form-390-step1-empty", full_page=False)

    # Error summary: empty Continue.
    page.click("button[type=submit]")
    page.wait_for_selector("[role=alert]:has-text('There is a problem')")
    shot(page, "form-390-step1-errors")

    # Closed-day error (a Monday) names the next open day.
    monday = date(2026, 11, 9)
    page.fill("#visit_date", monday.strftime("%d/%m/%Y"))
    page.fill("#visitors", "4")
    page.click("button[type=submit]")
    page.wait_for_selector("#visit_date-error")
    shot(page, "form-390-step1-closed-day")

    # The date sheet.
    page.fill("#visit_date", "")
    page.click("button[aria-label='Choose preferred date from the calendar']")
    page.wait_for_selector("[data-slot=sheet-content]")
    page.wait_for_timeout(400)
    shot(page, "form-390-date-sheet", full_page=False)
    # Tap a closed day: the sheet explains instead of closing.
    page.click("[data-slot=sheet-content] button[data-day][aria-label^='Monday, November 9']", timeout=5000)
    page.wait_for_timeout(200)
    shot(page, "form-390-date-sheet-closed-tap", full_page=False)
    page.click("[data-slot=sheet-content] button[data-day][aria-label^='Saturday, November 7']")
    page.wait_for_selector("[data-slot=sheet-content]", state="detached")
    assert page.input_value("#visit_date") == "07/11/2026", page.input_value("#visit_date")

    fill_visit(page)
    shot(page, "form-390-step1-filled")
    page.click("button[type=submit]")
    page.wait_for_url("**/request/group")
    page.wait_for_selector("#group_name")
    shot(page, "form-390-step2-empty")
    fill_group(page)
    shot(page, "form-390-step2-filled")
    page.click("button[type=submit]")
    page.wait_for_url("**/request/contact")
    page.wait_for_selector("#contact_name")
    shot(page, "form-390-step3-empty")
    fill_contact(page)
    page.click("button[type=submit]")
    page.wait_for_url("**/request/check")
    page.wait_for_selector("h1:has-text('Check your answers')")
    page.wait_for_timeout(1500)  # let Turnstile render if it can
    shot(page, "form-390-check")

    # Refresh keeps the answers (sessionStorage).
    page.reload(wait_until="load")
    page.wait_for_selector("h1:has-text('Check your answers')")
    assert ANSWERS["group_name"] in page.content()

    # Change link lands on the field.
    page.click("dl >> text=Change group name")
    page.wait_for_url("**/request/group")
    page.wait_for_timeout(200)
    focused = page.evaluate("document.activeElement && document.activeElement.id")
    print("focused after Change:", focused)
    page.goto(f"{base}/request/check", wait_until="load")
    page.wait_for_selector("h1:has-text('Check your answers')")

    if submit:
        page.wait_for_timeout(3000)
        page.click("button[type=submit]:has-text('Send request')")
        page.wait_for_url("**/request/sent/**", timeout=30000)
        page.wait_for_selector("h1:has-text('Request sent')")
        print("sent:", page.url)
        shot(page, "form-390-sent")
        page.reload(wait_until="load")
        page.wait_for_selector("h1:has-text('Request sent')")
        shot(page, "form-390-sent-after-refresh")
    else:
        mock_sent(page, acknowledged=False)
        page.goto(f"{base}/request/sent/9999?token=mock", wait_until="networkidle")
        page.wait_for_selector("h1:has-text('Request sent')")
        shot(page, "form-390-sent")

    mock_sent(page, acknowledged=True)
    page.goto(f"{base}/request/sent/9999?token=mock", wait_until="networkidle")
    page.wait_for_selector("h1:has-text('Request sent')")
    shot(page, "form-390-sent-acknowledged")

    page.unroute("**/api/v1/public/requests/9999*")
    page.goto(f"{base}/request/sent/9999?token=expired", wait_until="networkidle")
    page.wait_for_timeout(500)
    shot(page, "form-390-sent-invalid-link")


def form_desktop(page: Page, base: str) -> None:
    page.goto(f"{base}/request/visit", wait_until="networkidle")
    page.wait_for_selector("#visit_date")
    page.click("button[aria-label='Choose preferred date from the calendar']")
    page.wait_for_selector("[data-slot=popover-content]")
    page.wait_for_timeout(300)
    shot(page, "form-1440-visit-popover", full_page=False)
    page.keyboard.press("Escape")
    fill_visit(page)
    shot(page, "form-1440-visit", full_page=False)
    page.click("button[type=submit]")
    page.wait_for_url("**/request/group")
    fill_group(page)
    page.click("button[type=submit]")
    page.wait_for_url("**/request/contact")
    fill_contact(page)
    page.click("button[type=submit]")
    page.wait_for_url("**/request/check")
    page.wait_for_selector("h1:has-text('Check your answers')")
    page.wait_for_timeout(1500)
    shot(page, "form-1440-check")
    page.evaluate("sessionStorage.clear()")


def login(page: Page, base: str, email: str, password: str) -> None:
    page.goto(f"{base}/login", wait_until="networkidle")
    page.fill("input[name=email]", email)
    page.fill("input[name=password]", password)
    page.click("button[type=submit]")
    page.wait_for_url("**/today", timeout=20000)


def set_appearance(page: Page, base: str, theme: str, mode: str, text_size: str = "Large") -> None:
    """Through the Appearance page, as the foundation script does: the server
    preference wins over localStorage on load, so writing storage is not enough."""
    page.goto(f"{base}/settings/appearance", wait_until="networkidle")
    page.click(f'button[role=radio][aria-label^="{theme}"]')
    page.locator("[role=radiogroup][aria-label=Mode] button[role=radio]", has_text=mode).first.click()
    page.locator('[role=radiogroup][aria-label="Text size"] button[role=radio]', has_text=text_size).first.click()
    page.wait_for_timeout(700)  # debounce → PUT


def settings_pages(page: Page, base: str, email: str, password: str) -> None:
    login(page, base, email, password)
    for theme, mode, slug in [("Graphite", "Light", "graphite-light"), ("Fynbos", "Dark", "fynbos-dark")]:
        set_appearance(page, base, theme, mode)
        page.goto(f"{base}/settings/form", wait_until="networkidle")
        page.wait_for_selector("text=Arrival times")
        page.wait_for_timeout(400)
        shot(page, f"settings-form-{slug}-1440")
        page.goto(f"{base}/settings/templates", wait_until="networkidle")
        page.wait_for_selector("text=Add template")
        page.wait_for_timeout(400)
        shot(page, f"settings-templates-{slug}-1440")
    set_appearance(page, base, "Graphite", "Match system")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:5315")
    parser.add_argument("--submit", action="store_true", help="send one real TEST request to reach the sent page")
    parser.add_argument("--only", choices=["form", "settings"])
    parser.add_argument("--admin-email", default=os.environ.get("P5_ADMIN_EMAIL", "test-p5@example.com"))
    parser.add_argument("--admin-password", default=os.environ.get("P5_ADMIN_PASSWORD", "test-p5-password-1"))
    args = parser.parse_args()
    base = args.base.rstrip("/")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        if args.only in (None, "form"):
            context = browser.new_context(viewport=PHONE, device_scale_factor=2, is_mobile=True, has_touch=True)
            page = context.new_page()
            page.set_default_timeout(20000)
            form_phone(page, base, args.submit)
            context.close()
            context = browser.new_context(viewport=DESKTOP, device_scale_factor=1)
            page = context.new_page()
            page.set_default_timeout(20000)
            form_desktop(page, base)
            context.close()
        if args.only in (None, "settings"):
            context = browser.new_context(viewport=DESKTOP, device_scale_factor=1)
            page = context.new_page()
            page.set_default_timeout(20000)
            settings_pages(page, base, args.admin_email, args.admin_password)
            context.close()
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
