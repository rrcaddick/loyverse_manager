"""Screenshot and exercise the per-person waiting build (waiting v3).

    .venv/bin/python frontend/scripts/shoot-waiting-v3.py --base http://127.0.0.1:5316 --phase all
    …                                                     --phase seed|shots|flow|cleanup

Logs in as the scratch admin (FY_SHOT_EMAIL / FY_SHOT_PASSWORD), switches the
theme through the Appearance page, writes PNGs to data/screenshots/v3/*.png.

DATA SAFETY: real parties are opened read-only (no Done, no send, no
not-booking). Mutations happen only on fixtures this script creates: the
booking "TEST V3 Waiting" with two synthetic inbound threads, and one
synthetic unmatched sender; at most ONE reply is sent (dev-redirected by
mail_send outside ENV=prod). "cleanup" removes all of it, including any
ignored-sender rule the flow created.
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
OUT = ROOT / "data" / "screenshots" / "v3"
EMAIL = os.environ.get("FY_SHOT_EMAIL", "test-v3@example.com")
PASSWORD = os.environ.get("FY_SHOT_PASSWORD", "test-v3-password-1")
TEST_GROUP = "V3 TEST Waiting"  # not "TEST …": tests/ops/conftest.py deletes every `TEST %` booking when the suite runs
CONTACT_EMAIL = "test-v3-contact@example.com"
SENDER_EMAIL = "test-v3-sender@example.com"
THRID_A, THRID_B, THRID_S = 9100000000000000811, 9100000000000000812, 9100000000000000813
TEST_THRIDS = (THRID_A, THRID_B, THRID_S)
RULE_PATTERNS = ("test-v3-sender@example.com", "@example.com", "@test-v3.example", "test-v3-contact@example.com")

THEMES = [("Graphite", "Light", "graphite-light"), ("Fynbos", "Dark", "fynbos-dark")]
VIEWPORT = (1440, 900)


def api_session(base: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{base}/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    s.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return s


def quote(key: str) -> str:
    return urllib.parse.quote(key, safe="")


# -------------------------------------------------------------------- seed


def phase_seed(base: str) -> dict:
    from src.models import email_message as em
    from src.models.base import query_one
    from src.services import conversations

    s = api_session(base)
    existing = query_one("SELECT id FROM bookings WHERE group_name = %s", (TEST_GROUP,))
    if existing:
        booking_id = int(existing["id"])
    else:
        visit = (datetime.now() + timedelta(days=40)).date().isoformat()
        r = s.post(
            f"{base}/api/v1/bookings",
            json={
                "group_name": TEST_GROUP,
                "contact_name": "V3 Tester",
                "contact_email": CONTACT_EMAIL,
                "contact_mobile": "0820000000",
                "visit_date": visit,
                "adults": 20,
                "children": 0,
                "people_booked": 20,
                "vehicles": 1,
                "group_type": "church",
            },
        )
        if r.status_code >= 400:
            print("create booking failed", r.status_code, r.text)
            r.raise_for_status()
        booking_id = int(r.json()["id"])
    print("booking", booking_id)

    now = datetime.now().replace(microsecond=0)

    def row(thrid: int, msgid: int, sent_at: datetime, from_name: str, from_email: str, subject: str, text: str) -> dict:
        html = f"<div><p>{text}</p><p>Kind regards<br>{from_name}</p></div>"
        return {
            "gmail_msgid": msgid,
            "gmail_thrid": thrid,
            "gmail_uid": None,
            "folder": "INBOX",
            "message_id_header": f"<test-v3-{msgid}@example.com>",
            "direction": "inbound",
            "kind": None,
            "from_name": from_name,
            "from_email": from_email,
            "to_emails": ["bookings@farmyard.example"],
            "cc_emails": [],
            "subject": subject,
            "sent_at": sent_at,
            "snippet": text[:120],
            "body_text": f"{text}\n\nKind regards\n{from_name}",
            "body_html": html,
            "body_new_html": f"<p>{text}</p>",
            "body_new_text": text,
            "body_quoted_html": None,
            "signature_text": f"Kind regards\n{from_name}",
            "split_version": 1,
            "has_attachments": False,
            "booking_id": None,
            "match_method": None,
            "review_status": "pending",
            "is_auto_generated": False,
            "attachments_meta": None,
        }

    fixtures = [
        row(THRID_A, 9100000000000000911, now - timedelta(days=3, hours=2), "V3 Tester", CONTACT_EMAIL, "Group visit enquiry — TEST V3", "Good day, we would like to bring 20 people. Could you confirm the price per person and whether gazebos are available?"),
        row(THRID_B, 9100000000000000912, now - timedelta(hours=1), "V3 Tester", CONTACT_EMAIL, "Invoice query — TEST V3", "Hi, could you send the proforma to our accounts department as well?"),
        row(THRID_S, 9100000000000000913, now - timedelta(days=1), "Test Sender", SENDER_EMAIL, "Website design offer — TEST V3", "Hello, we build websites for recreation parks. Would you like a free quote?"),
    ]
    for data in fixtures:
        if em.get_by_gmail_msgid(int(data["gmail_msgid"])) is None:
            em.insert(data)
    for thrid in TEST_THRIDS:
        conversations.refresh_thread(thrid)
    for thrid in (THRID_A, THRID_B):
        conversations.attach(thrid, booking_id, None)
    party = s.get(f"{base}/api/v1/inbox/parties/{quote(f'b:{booking_id}')}").json()
    print("party b:%d unanswered=%s threads=%s" % (booking_id, party.get("unanswered_count"), [(t["thrid"], t["subject"]) for t in party.get("threads", [])]))
    sender = s.get(f"{base}/api/v1/inbox/parties/{quote(f'e:{SENDER_EMAIL}')}").json()
    print("party e:%s unanswered=%s" % (SENDER_EMAIL, sender.get("unanswered_count")))
    return {"booking_id": booking_id}


# ----------------------------------------------------------------- browser


def login(page, base: str) -> None:
    page.goto(f"{base}/login", wait_until="networkidle")
    page.fill("input[name=email]", EMAIL)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_url("**/today", timeout=20000)
    page.wait_for_load_state("networkidle")


def set_appearance(page, base: str, theme: str, mode: str, text_size: str = "Large") -> None:
    page.goto(f"{base}/settings/appearance", wait_until="networkidle")
    page.click(f'button[role=radio][aria-label^="{theme}"]')
    page.locator("[role=radiogroup][aria-label=Mode] button[role=radio]", has_text=mode).first.click()
    page.locator('[role=radiogroup][aria-label="Text size"] button[role=radio]', has_text=text_size).first.click()
    page.wait_for_timeout(600)


def shot(page, name: str, full_page: bool = False) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path), full_page=full_page)
    print("wrote", path.relative_to(ROOT))


def goto(page, url: str, settle: int = 700) -> None:
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(settle)


def pane_line(page, contains: str = "waiting", timeout: int = 20000) -> str:
    """The reading-pane subtitle once the party has loaded."""
    page.wait_for_function(
        "(needle) => (document.querySelector('[data-testid=pane-line]')?.textContent || '').includes(needle)", arg=contains, timeout=timeout
    )
    return page.locator("[data-testid=pane-line]").inner_text()


def find_examples(base: str) -> dict:
    """Real parties to open read-only: one with two threads and unanswered marks, the Mondale booking."""
    s = api_session(base)
    items = s.get(f"{base}/api/v1/inbox/conversations", params={"view": "needs_reply", "page_size": 100}).json()["items"]
    multi = [i for i in items if i.get("thread_count", 0) > 1 and "TEST" not in (i.get("subject") or "")]
    unmatched = [i for i in items if not i.get("booking") and "TEST" not in (i.get("subject") or "")]
    mondale = s.get(f"{base}/api/v1/bookings", params={"bucket": "all", "q": "Mondale", "page_size": 1}).json()["items"]
    return {
        "multi": (multi[0]["party_key"] if multi else items[0]["party_key"]) if items else None,
        "unmatched": unmatched[0]["party_key"] if unmatched else None,
        "mondale": f"b:{mondale[0]['id']}" if mondale else None,
    }


def phase_shots(page_for, base: str) -> None:
    ex = find_examples(base)
    print("examples", ex)
    page = page_for(*VIEWPORT)
    login(page, base)
    for theme, mode, slug in THEMES:
        set_appearance(page, base, theme, mode)
        goto(page, f"{base}/mail")
        shot(page, f"mail-needs-reply-{slug}-1440")
        if ex["multi"]:
            goto(page, f"{base}/mail?party={quote(ex['multi'])}", 1200)
            shot(page, f"mail-party-two-threads-{slug}-1440")
            if slug == "graphite-light":
                # The composer's "Reply in:" selector (no send).
                page.keyboard.press("r")
                page.wait_for_selector("[data-testid=reply-in]", timeout=5000)
                page.wait_for_timeout(300)
                shot(page, f"mail-composer-reply-in-{slug}-1440")
                page.click("[data-testid=reply-in]")
                page.wait_for_selector("[role=menu]", timeout=5000)
                page.wait_for_timeout(300)
                shot(page, f"mail-composer-reply-in-menu-{slug}-1440")
                page.keyboard.press("Escape")
                page.wait_for_timeout(200)
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)
                # The Not a booking dialog, cancelled.
                page.click('button[aria-label="More actions"]')
                page.get_by_role("menuitem", name="Not a booking…").click()
                page.wait_for_selector("[role=alertdialog]", timeout=5000)
                page.wait_for_timeout(300)
                shot(page, f"mail-not-booking-dialog-{slug}-1440")
                page.get_by_role("button", name="Cancel").click()
                page.wait_for_timeout(300)
        if ex["mondale"]:
            goto(page, f"{base}/mail?party={quote(ex['mondale'])}&view=all", 1500)
            shot(page, f"mail-party-mondale-{slug}-1440")
        goto(page, f"{base}/mail?view=all")
        shot(page, f"mail-all-threads-{slug}-1440")
        goto(page, f"{base}/settings/mail-rules")
        shot(page, f"settings-mail-rules-{slug}-1440", full_page=True)
        goto(page, f"{base}/work?view=reply")
        page.wait_for_selector("[data-work-row]", timeout=15000)
        page.wait_for_timeout(500)
        shot(page, f"work-reply-{slug}-1440")
    # Work › Reply: the primary verb opens the person in Mail.
    set_appearance(page, base, "Graphite", "Light")
    goto(page, f"{base}/work?view=reply")
    page.wait_for_selector("[data-work-row]", timeout=15000)
    page.locator('button[aria-label^="Reply ·"]').first.click()
    page.wait_for_url("**/mail?party=*", timeout=10000)
    page.wait_for_timeout(800)
    print("work → mail url:", page.url)
    assert "party=" in page.url
    set_appearance(page, base, "Graphite", "Match system", "Large")
    page.context.close()


# -------------------------------------------------------------------- flow


def phase_flow(page_for, base: str, booking_id: int) -> None:
    s = api_session(base)
    page = page_for(*VIEWPORT)
    login(page, base)
    set_appearance(page, base, "Graphite", "Light")

    # 1. The unmatched TEST sender: E (done) → Undo; then Not a booking (learn) → Undo.
    sender_key = f"e:{SENDER_EMAIL}"
    goto(page, f"{base}/mail?party={quote(sender_key)}", 800)
    line = pane_line(page)
    print("sender header:", line)
    assert "1 message waiting" in line
    page.keyboard.press("e")
    page.get_by_role("button", name="Undo").wait_for(timeout=8000)
    page.wait_for_timeout(500)
    shot(page, "flow-01-done-toast-graphite-light-1440")
    after_done = s.get(f"{base}/api/v1/inbox/parties/{quote(sender_key)}").json()
    print("after done unanswered:", after_done.get("unanswered_count"))
    assert after_done.get("unanswered_count") == 0
    page.get_by_role("button", name="Undo").click()
    page.wait_for_timeout(1500)
    after_undo = s.get(f"{base}/api/v1/inbox/parties/{quote(sender_key)}").json()
    print("after undo unanswered:", after_undo.get("unanswered_count"))
    assert after_undo.get("unanswered_count") == 1

    goto(page, f"{base}/mail?party={quote(sender_key)}", 800)
    pane_line(page)
    page.click('button[aria-label="More actions"]')
    page.get_by_role("menuitem", name="Not a booking…").click()
    page.wait_for_selector("[role=alertdialog]", timeout=5000)
    assert page.locator("[role=alertdialog] button[role=checkbox]").get_attribute("data-state") == "checked"
    page.get_by_role("button", name="Mark and ignore sender").click()
    page.get_by_role("button", name="Undo").wait_for(timeout=8000)
    page.wait_for_timeout(400)
    shot(page, "flow-02-not-booking-toast-graphite-light-1440")
    rules = s.get(f"{base}/api/v1/inbox/ignored-senders").json()["items"]
    made = [r for r in rules if r["pattern"] in RULE_PATTERNS]
    print("rule created:", made)
    assert made, "no ignored-sender rule was created"
    page.get_by_role("button", name="Undo").click()
    page.wait_for_timeout(1500)
    rules = s.get(f"{base}/api/v1/inbox/ignored-senders").json()["items"]
    print("rules after undo:", [r["pattern"] for r in rules if r["pattern"] in RULE_PATTERNS])
    assert not [r for r in rules if r["pattern"] in RULE_PATTERNS]

    # 2. Booking › Conversation tab while two messages wait: badge, strip and marks.
    for theme, mode, slug in THEMES:
        set_appearance(page, base, theme, mode)
        goto(page, f"{base}/bookings/{booking_id}?tab=conversation", 800)
        page.wait_for_selector("[data-testid=waiting-strip]", timeout=15000)
        page.wait_for_timeout(800)
        if slug == "graphite-light":
            tab = page.get_by_role("tab", name="Conversation").inner_text()
            print("booking tab label:", tab.replace("\n", " "), "| marks:", page.locator("[data-unanswered=true]").count())
            assert "2" in tab
        shot(page, f"booking-conversation-{slug}-1440", full_page=True)
    set_appearance(page, base, "Graphite", "Light")

    # 3. The TEST booking party in Mail: two threads, two marks; reply in the older thread; marks clear.
    key = f"b:{booking_id}"
    goto(page, f"{base}/mail?party={quote(key)}", 800)
    line = pane_line(page, "2 messages waiting")
    print("booking header:", line)
    assert "2 messages waiting" in line
    marks = page.locator("[data-unanswered=true]").count()
    print("unanswered cards:", marks)
    assert marks == 2
    shot(page, "flow-03-test-party-graphite-light-1440")
    page.keyboard.press("r")
    page.wait_for_selector("[data-testid=reply-in]", timeout=5000)
    assert "Invoice query" in page.locator("[data-testid=reply-in]").inner_text()  # newest first
    page.click("[data-testid=reply-in]")
    page.get_by_role("menuitemradio", name="Group visit enquiry — TEST V3").click()
    page.wait_for_timeout(300)
    assert "Group visit" in page.locator("[data-testid=reply-in]").inner_text()
    assert "Re: Group visit enquiry — TEST V3" in page.get_by_text("Subject:").inner_text()
    page.fill("textarea[aria-label=Reply]", "Thank you for both messages — the price is R95 per person and gazebos are available. The proforma follows to accounts as well.")
    shot(page, "flow-04-reply-older-thread-graphite-light-1440")
    page.get_by_role("button", name="Send", exact=True).click()
    page.wait_for_timeout(6000)
    page.wait_for_function("document.querySelectorAll('[data-unanswered=true]').length === 0", timeout=20000)
    page.wait_for_timeout(800)
    shot(page, "flow-05-after-reply-graphite-light-1440")
    party = s.get(f"{base}/api/v1/inbox/parties/{quote(key)}").json()
    outbound = [i for i in party["items"] if i["type"] == "outbound"]
    print("after reply unanswered:", party.get("unanswered_count"), "outbound thrids:", [o.get("gmail_thrid") for o in outbound])
    assert party.get("unanswered_count") == 0
    assert str(THRID_A) in [str(o.get("gmail_thrid")) for o in outbound]
    print("header after reply:", page.locator("[data-testid=pane-line]").inner_text())

    # 4. Booking › Conversation tab afterwards: nothing waits, so no badge, strip or marks.
    goto(page, f"{base}/bookings/{booking_id}?tab=conversation", 1500)
    page.wait_for_selector("[role=log]:not([aria-busy='true'])", timeout=15000)
    print("booking tab after reply — marks:", page.locator("[data-unanswered=true]").count(), "strip:", page.locator("[data-testid=waiting-strip]").count())
    assert page.locator("[data-unanswered=true]").count() == 0

    # 5. Settings › Mail rules: add and remove by hand.
    goto(page, f"{base}/settings/mail-rules")
    page.fill('input[name=pattern]', "@test-v3.example")
    page.fill('input[name=reason]', "Playwright")
    page.get_by_role("button", name="Ignore sender").click()
    page.wait_for_selector("text=@test-v3.example", timeout=8000)
    page.wait_for_timeout(500)
    shot(page, "flow-06-mail-rules-added-graphite-light-1440", full_page=True)
    page.locator('button[aria-label="Remove @test-v3.example"]').click()
    page.get_by_role("button", name="Remove rule").click()
    page.wait_for_timeout(1200)
    rules = s.get(f"{base}/api/v1/inbox/ignored-senders").json()["items"]
    print("rules after remove:", [r["pattern"] for r in rules if "test-v3" in r["pattern"]])
    assert not [r for r in rules if r["pattern"] == "@test-v3.example"]

    set_appearance(page, base, "Graphite", "Match system", "Large")
    page.context.close()
    print("flow OK")


# ----------------------------------------------------------------- cleanup


def phase_cleanup(base: str) -> None:
    """Remove every fixture row: the synthetic threads, the TEST booking's messages and
    threads (the Sent sync re-threads a sent reply into a real Gmail thread id, so
    collect thrids by booking as well), any rule the flow made, then the booking."""
    from src.models import booking as bm
    from src.models.base import execute, query

    booking_ids = [int(r["id"]) for r in query("SELECT id FROM bookings WHERE group_name = %s", (TEST_GROUP,))]
    thrids = set(TEST_THRIDS)
    for bid in booking_ids:
        for r in query("SELECT DISTINCT gmail_thrid FROM email_messages WHERE booking_id = %s AND gmail_thrid IS NOT NULL", (bid,)):
            thrids.add(int(r["gmail_thrid"]))
        for r in query("SELECT gmail_thrid FROM email_threads WHERE booking_id = %s", (bid,)):
            thrids.add(int(r["gmail_thrid"]))
    for r in query("SELECT DISTINCT gmail_thrid FROM email_messages WHERE from_email IN (%s, %s) AND gmail_thrid IS NOT NULL", (CONTACT_EMAIL, SENDER_EMAIL)):
        thrids.add(int(r["gmail_thrid"]))
    marks = ", ".join(str(t) for t in sorted(thrids))
    for table in ("email_thread_notes", "email_threads", "email_messages"):
        n = execute(f"DELETE FROM {table} WHERE gmail_thrid IN ({marks})")
        print("deleted", n, "from", table)
    for bid in booking_ids:
        n = execute("DELETE FROM email_messages WHERE booking_id = %s", (bid,))
        if n:
            print("deleted", n, "stray messages of booking", bid)
    for row in query("SELECT id, pattern FROM mail_ignored_senders"):
        if row["pattern"] in RULE_PATTERNS or "test-v3" in row["pattern"]:
            execute("DELETE FROM mail_ignored_senders WHERE id = %s", (row["id"],))
            print("deleted rule", row["pattern"])
    for bid in booking_ids:
        bm.delete(bid)
        print("deleted booking", bid)
    left = query(f"SELECT COUNT(*) AS n FROM email_messages WHERE gmail_thrid IN ({marks})")
    print("remaining fixture messages:", left[0]["n"] if left else "?")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:5316")
    ap.add_argument("--phase", default="all", choices=["all", "seed", "shots", "flow", "cleanup"])
    args = ap.parse_args()

    booking_id: int | None = None
    if args.phase in ("all", "seed", "shots", "flow"):
        from src.models.base import query_one

        existing = query_one("SELECT id FROM bookings WHERE group_name = %s", (TEST_GROUP,))
        booking_id = int(existing["id"]) if existing else None
    if args.phase in ("all", "seed"):
        booking_id = phase_seed(args.base)["booking_id"]
    if args.phase in ("all", "shots", "flow"):
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch()

            def page_for(w: int, h: int):
                ctx = browser.new_context(viewport={"width": w, "height": h})
                return ctx.new_page()

            if args.phase in ("all", "shots"):
                phase_shots(page_for, args.base)
            if args.phase in ("all", "flow"):
                assert booking_id, "seed first"
                phase_flow(page_for, args.base, booking_id)
            browser.close()
    if args.phase in ("all", "cleanup"):
        phase_cleanup(args.base)


if __name__ == "__main__":
    main()
