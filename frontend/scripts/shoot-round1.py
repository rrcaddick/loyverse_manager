"""Screenshots for UI round one (Bookings list, sidebar with the Work accordion, Work).

    .venv/bin/python frontend/scripts/shoot-round1.py --base http://localhost:8010

Logs in as a scratch admin (FY_SHOT_EMAIL / FY_SHOT_PASSWORD), switches the
theme through the Appearance page and writes PNGs to data/screenshots/r1/.
Read-only: it opens pages and clicks filters; nothing is sent or changed.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "screenshots" / "r1c"
EMAIL = os.environ.get("FY_SHOT_EMAIL", "shot-r1@example.com")
PASSWORD = os.environ.get("FY_SHOT_PASSWORD", "shot-r1-password-1")
THEMES = [("Graphite", "Light", "graphite-light"), ("Fynbos", "Dark", "fynbos-dark"), ("Lagoon", "Light", "lagoon-light"), ("Indigo", "Dark", "indigo-dark")]


def login(page, base: str) -> None:
    page.goto(f"{base}/login", wait_until="networkidle")
    page.fill("input[name=email]", EMAIL)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_url("**/today", timeout=20000)
    page.wait_for_load_state("networkidle")


def set_appearance(page, base: str, theme: str, mode: str, text_size: str = "Default") -> None:
    page.goto(f"{base}/settings/appearance", wait_until="networkidle")
    page.click(f'button[role=radio][aria-label^="{theme}"]')
    page.locator("[role=radiogroup][aria-label=Mode] button[role=radio]", has_text=mode).first.click()
    sizes = page.locator('[role=radiogroup][aria-label="Text size"] button[role=radio]', has_text=text_size)
    if sizes.count():
        sizes.first.click()
    page.wait_for_timeout(500)


def shot(page, name: str, full_page: bool = False) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path), full_page=full_page)
    print("wrote", path.relative_to(ROOT))


def goto(page, url: str, settle: int = 900) -> None:
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(settle)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8010")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        login(page, args.base)
        for theme, mode, slug in THEMES:
            set_appearance(page, args.base, theme, mode)
            goto(page, f"{args.base}/bookings?tab=all")
            shot(page, f"bookings-all-{slug}")
            goto(page, f"{args.base}/bookings?tab=pending")
            shot(page, f"bookings-pending-{slug}")
            rows = page.locator("table tbody tr")
            if rows.count() >= 4:
                rows.nth(3).hover()
                page.wait_for_timeout(250)
                shot(page, f"bookings-pending-hover-{slug}")
            goto(page, f"{args.base}/bookings?tab=confirmed&range=month")
            shot(page, f"bookings-confirmed-month-{slug}")
            goto(page, f"{args.base}/work?view=reply")
            shot(page, f"work-reply-{slug}")
        set_appearance(page, args.base, "Graphite", "Light")
        page.set_viewport_size({"width": 1920, "height": 1000})
        goto(page, f"{args.base}/bookings?tab=all&size=100")
        shot(page, "bookings-all-1920-graphite-light")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
