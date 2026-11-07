"""Screenshot and exercise the Bookings pages (list, record, create → proforma →
payment → note → arrivals on a TEST booking, conversation, edit, mobile).

    .venv/bin/python frontend/scripts/shoot-bookings.py --base http://127.0.0.1:5313 --phase all
    …                                                   --phase shots|flow|cleanup

Logs in as the scratch admin (FY_SHOT_EMAIL / FY_SHOT_PASSWORD), switches the
theme through the Appearance page, writes PNGs to data/screenshots/v2/p3-*.png.
DATA SAFETY: the only booking it changes is the one it creates, group name
"TEST P3 Playwright"; real bookings are opened read-only. "cleanup" deletes the
TEST booking(s) through src.models.booking.delete.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "screenshots" / "v2"
EMAIL = os.environ.get("FY_SHOT_EMAIL", "test-p3@example.com")
PASSWORD = os.environ.get("FY_SHOT_PASSWORD", "test-p3-password-1")
TEST_GROUP = "TEST P3 Playwright"

VIEWPORTS = {"1440": (1440, 900), "1920": (1920, 1080)}
THEMES = [("Graphite", "Light", "graphite-light"), ("Fynbos", "Dark", "fynbos-dark")]


def login(page: Page, base: str) -> None:
    page.goto(f"{base}/login", wait_until="networkidle")
    page.fill("input[name=email]", EMAIL)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_url("**/today", timeout=20000)
    page.wait_for_load_state("networkidle")


def set_appearance(page: Page, base: str, theme: str, mode: str, text_size: str = "Large") -> None:
    page.goto(f"{base}/settings/appearance", wait_until="networkidle")
    page.click(f'button[role=radio][aria-label^="{theme}"]')
    page.locator("[role=radiogroup][aria-label=Mode] button[role=radio]", has_text=mode).first.click()
    page.locator('[role=radiogroup][aria-label="Text size"] button[role=radio]', has_text=text_size).first.click()
    page.wait_for_timeout(700)


def shot(page: Page, name: str, full_page: bool = False) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"p3-{name}.png"
    page.screenshot(path=str(path), full_page=full_page)
    print("wrote", path.relative_to(ROOT))


def goto(page: Page, url: str, settle: int = 500) -> None:
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(settle)


def first_confirmed_id(page: Page, base: str) -> int:
    data = page.evaluate(f"fetch('{base}/api/v1/bookings?bucket=confirmed&page_size=1&sort=visit_date').then(r => r.json())")
    return int(data["items"][0]["id"])


def test_booking_ids(page: Page, base: str) -> list[int]:
    data = page.evaluate(f"fetch('{base}/api/v1/bookings?bucket=all&q=TEST%20P3&page_size=50').then(r => r.json())")
    return [int(i["id"]) for i in data["items"] if str(i["group_name"]).startswith("TEST P3")]


# ------------------------------------------------------------------- shots


def phase_shots(page_for, base: str) -> None:
    for label, (w, h) in VIEWPORTS.items():
        page = page_for(w, h)
        login(page, base)
        confirmed = first_confirmed_id(page, base)
        tests = test_booking_ids(page, base)
        for theme, mode, slug in THEMES:
            set_appearance(page, base, theme, mode)
            for tab in ["pending", "confirmed", "lapsed", "past", "all"]:
                goto(page, f"{base}/bookings?tab={tab}")
                shot(page, f"list-{tab}-{slug}-{label}")
            goto(page, f"{base}/bookings/{confirmed}", 800)
            shot(page, f"record-confirmed-{slug}-{label}", full_page=True)
            if tests:
                goto(page, f"{base}/bookings/{tests[0]}", 800)
                shot(page, f"record-test-{slug}-{label}", full_page=True)
                goto(page, f"{base}/bookings/{tests[0]}?tab=conversation", 1200)
                shot(page, f"record-test-conversation-{slug}-{label}", full_page=True)
        set_appearance(page, base, "Graphite", "Match system", "Large")
        page.context.close()

    # Mobile, Graphite light.
    page = page_for(390, 844)
    login(page, base)
    confirmed = first_confirmed_id(page, base)
    set_appearance(page, base, "Graphite", "Light")
    goto(page, f"{base}/bookings")
    shot(page, "list-pending-mobile-390", full_page=True)
    goto(page, f"{base}/bookings/{confirmed}", 800)
    shot(page, "record-confirmed-mobile-390", full_page=True)
    set_appearance(page, base, "Graphite", "Match system", "Large")
    page.context.close()


# -------------------------------------------------------------------- flow


def pick_date(page: Page, trigger_label: str, target: date) -> None:
    """Open a DateField (button labelled by its FormLabel) and click the target day."""
    page.get_by_label(trigger_label, exact=False).first.click()
    cal = page.locator("[data-slot=popover-content]").last
    cal.wait_for()
    today = date.today()
    months = (target.year - today.year) * 12 + (target.month - today.month)
    for _ in range(months):
        cal.get_by_role("button", name="Next Month").click()
        page.wait_for_timeout(80)
    cal.locator(f'[data-day="{target.isoformat()}"] button').click()
    page.wait_for_timeout(200)


def phase_flow(page_for, base: str) -> None:
    page = page_for(1440, 900)
    login(page, base)
    set_appearance(page, base, "Graphite", "Light")

    # 1. create
    visit = date.today() + timedelta(days=45)
    while visit.weekday() in (0, 1):  # park closed Mon / Tue
        visit += timedelta(days=1)
    goto(page, f"{base}/bookings")
    page.get_by_role("button", name="New booking").click()
    page.wait_for_selector("[data-slot=dialog-content]")
    pick_date(page, "Visit date", visit)
    page.get_by_label("Visitors").fill("45")
    page.get_by_label("Arrival time").fill("09:30")
    page.get_by_label("Vehicles").fill("1")
    page.get_by_label("Group name").fill(TEST_GROUP)
    page.get_by_role("combobox", name="Kind of group").click()
    page.get_by_role("option", name="Church group").click()
    page.get_by_label("Area").fill("Klapmuts")
    page.get_by_label("Contact name").fill("P3 Tester")
    page.get_by_label("Email").fill("test-p3@example.com")
    page.get_by_label("Mobile").fill("082 000 0003")
    page.get_by_role("button", name="Invoice details").click()
    page.get_by_label("Billing address").fill("TEST P3 Playwright\n1 Test Road\nKlapmuts 7625")
    page.get_by_label("Customer VAT number").fill("4000000003")
    page.wait_for_timeout(300)
    shot(page, "flow-01-create-dialog")
    page.get_by_role("button", name="Create booking").click()
    page.wait_for_url("**/bookings/*", timeout=20000)
    page.wait_for_timeout(800)
    shot(page, "flow-02-enquiry", full_page=True)

    # 2. send proforma (email 1, dev-redirected)
    page.get_by_role("button", name="Send proforma").first.click()
    page.wait_for_selector("[role=alertdialog]")
    page.wait_for_timeout(300)
    shot(page, "flow-03-send-proforma-confirm")
    page.locator("[role=alertdialog]").get_by_role("button", name="Send proforma").click()
    page.wait_for_selector("[role=alertdialog]", state="detached", timeout=60000)
    page.wait_for_timeout(800)
    shot(page, "flow-04-proforma-sent", full_page=True)

    # 3. record payment (the deposit → auto-confirm)
    page.get_by_role("button", name="Record payment").first.click()
    page.wait_for_selector("[data-slot=dialog-content]")
    page.wait_for_timeout(300)
    shot(page, "flow-05-record-payment-dialog")
    page.locator("[data-slot=dialog-content]").get_by_role("button", name="Record payment").click()
    page.wait_for_selector("[data-slot=dialog-content]", state="detached")
    page.wait_for_timeout(800)
    shot(page, "flow-06-confirmed", full_page=True)

    # 4. note (N key focuses the composer)
    page.keyboard.press("n")
    page.wait_for_timeout(200)
    page.keyboard.type("Phoned: they will bring their own gazebo. Added by the P3 Playwright run.")
    page.keyboard.press("Control+Enter")
    page.wait_for_timeout(800)
    shot(page, "flow-07-note", full_page=True)

    # 5. arrivals (manual count) → completed
    page.get_by_role("button", name="More actions").click()
    page.get_by_role("menuitem", name="Record arrivals").click()
    page.wait_for_selector("[data-slot=dialog-content]")
    page.get_by_label("People arrived").fill("41")
    page.wait_for_timeout(200)
    shot(page, "flow-08-arrivals-dialog")
    page.locator("[data-slot=dialog-content]").get_by_role("button", name="Record arrivals").click()
    page.wait_for_selector("[data-slot=dialog-content]", state="detached")
    page.wait_for_timeout(800)
    shot(page, "flow-09-completed", full_page=True)

    # 6. edit dialog (E key)
    page.keyboard.press("e")
    page.wait_for_selector("[data-slot=dialog-content]")
    page.get_by_role("button", name="Price and deposit overrides").click()
    page.wait_for_timeout(300)
    shot(page, "flow-10-edit-dialog", full_page=False)
    page.keyboard.press("Escape")
    page.wait_for_selector("[data-slot=dialog-content]", state="detached")

    # 7. conversation tab
    page.get_by_role("tab", name="Conversation").click()
    page.wait_for_timeout(1200)
    shot(page, "flow-11-conversation", full_page=True)

    # 8. overflow menu
    page.get_by_role("tab", name="Booking").click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name="More actions").click()
    page.wait_for_timeout(300)
    shot(page, "flow-12-overflow-menu")
    page.keyboard.press("Escape")

    # 9. mobile record of the test booking
    url = page.url
    page.context.close()
    page = page_for(390, 844)
    login(page, base)
    goto(page, url.split("?")[0], 800)
    shot(page, "record-test-mobile-390", full_page=True)
    page.context.close()


# ----------------------------------------------------------------- cleanup


def phase_cleanup(base: str) -> None:
    sys.path.insert(0, str(ROOT))
    from src.models import booking as booking_model  # noqa: E402

    from src.models.base import execute, query  # noqa: E402

    items, _total = booking_model.list_bookings(q="TEST P3", page=1, page_size=50)
    for row in items:
        if not str(row["group_name"]).startswith("TEST P3"):
            continue
        booking_id = int(row["id"])
        # email_messages has no FK to bookings: remove the dev-redirected sends and their thread rows too.
        thrids = [m["gmail_thrid"] for m in query("SELECT DISTINCT gmail_thrid FROM email_messages WHERE booking_id = %s", (booking_id,)) if m.get("gmail_thrid")]
        mails = execute("DELETE FROM email_messages WHERE booking_id = %s", (booking_id,))
        for thrid in thrids:
            execute("DELETE FROM email_thread_notes WHERE gmail_thrid = %s", (thrid,))
            execute("DELETE FROM email_threads WHERE gmail_thrid = %s", (thrid,))
        booking_model.delete(booking_id)
        print("deleted booking", booking_id, row["reference"], f"({mails} emails, {len(thrids)} threads)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:5313")
    parser.add_argument("--phase", default="all", choices=["all", "shots", "flow", "cleanup"])
    args = parser.parse_args()
    base = args.base.rstrip("/")

    if args.phase == "cleanup":
        phase_cleanup(base)
        return 0

    with sync_playwright() as p:
        browser = p.chromium.launch()

        def page_for(w: int, h: int) -> Page:
            context = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            page = context.new_page()
            page.set_default_timeout(20000)
            return page

        if args.phase in ("all", "flow"):
            phase_flow(page_for, base)
        if args.phase in ("all", "shots"):
            phase_shots(page_for, base)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
