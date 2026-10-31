"""Screenshot the foundation (shell, themes, Appearance, Settings rail).

    .venv/bin/python frontend/scripts/shoot-foundation.py [--base http://localhost:5301]

Logs in as the read-only research user, switches theme through the
Appearance page itself (so the server preference, when it exists, follows),
and writes PNGs to data/screenshots/v2/foundation-*.png. Leaves the
preference on Graphite / Match system / Large.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "screenshots" / "v2"
EMAIL = os.environ.get("FY_SHOT_EMAIL", "research@example.com")
PASSWORD = os.environ.get("FY_SHOT_PASSWORD", "research-viewer-pw-1")

VIEWPORTS = {"1440": (1440, 900), "1920": (1920, 1080)}


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
    page.locator('[role=radiogroup][aria-label=Mode] button[role=radio]', has_text=mode).first.click()
    page.locator('[role=radiogroup][aria-label="Text size"] button[role=radio]', has_text=text_size).first.click()
    page.wait_for_timeout(700)  # debounce → PUT


def shot(page: Page, name: str, full_page: bool = False) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"foundation-{name}.png"
    page.screenshot(path=str(path), full_page=full_page)
    print("wrote", path.relative_to(ROOT))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:5301")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, (w, h) in VIEWPORTS.items():
            context = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            page = context.new_page()
            page.set_default_timeout(20000)

            # Login page before any session, in the default theme.
            page.goto(f"{base}/login", wait_until="networkidle")
            shot(page, f"login-graphite-light-{label}")
            login(page, base)

            # Shell in four themes (Today is the landing page).
            for theme, mode, slug in [
                ("Graphite", "Light", "graphite-light"),
                ("Fynbos", "Dark", "fynbos-dark"),
                ("Indigo", "Light", "indigo-light"),
                ("High contrast", "Light", "contrast-light"),
                ("High contrast", "Dark", "contrast-dark"),
            ]:
                set_appearance(page, base, theme, mode)
                if slug in ("graphite-light", "fynbos-dark"):
                    shot(page, f"appearance-{slug}-{label}", full_page=True)
                page.goto(f"{base}/today", wait_until="networkidle")
                page.wait_for_timeout(400)
                shot(page, f"shell-{slug}-{label}")
                if slug == "graphite-light":
                    page.goto(f"{base}/settings/season", wait_until="networkidle")
                    page.wait_for_timeout(300)
                    shot(page, f"settings-rail-{slug}-{label}")
                    page.goto(f"{base}/calendar", wait_until="networkidle")
                    page.wait_for_timeout(400)
                    shot(page, f"calendar-collapsed-{slug}-{label}")
                    page.goto(f"{base}/bookings", wait_until="networkidle")
                    page.wait_for_timeout(400)
                    shot(page, f"bookings-{slug}-{label}")
                    page.keyboard.press("?")
                    page.wait_for_timeout(300)
                    shot(page, f"cheatsheet-{slug}-{label}")
                    page.keyboard.press("Escape")
                if slug == "fynbos-dark":
                    page.goto(f"{base}/settings/password", wait_until="networkidle")
                    shot(page, f"settings-password-{slug}-{label}")

            # Leave the account on the defaults.
            set_appearance(page, base, "Graphite", "Match system", "Large")
            context.close()
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
