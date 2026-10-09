"""DB-backed conversation views and done/reopen semantics.

Needs the local MySQL from .env with migration 008 applied; skipped otherwise.
Every row it creates uses a thread id above 9_000_000_000_000_000_000 and a
``TEST`` subject, and is deleted at the end. Nothing talks to Gmail.
"""

from __future__ import annotations

import itertools
from datetime import datetime, timedelta

import pytest

try:
    from src.models.base import execute, query_one

    query_one("SELECT 1 AS ok")
    DB_OK = True
except Exception:  # noqa: BLE001 - any connection problem means skip
    DB_OK = False

pytestmark = pytest.mark.skipif(not DB_OK, reason="MySQL not reachable")

from src.models import email_message as em  # noqa: E402
from src.models import email_thread as et  # noqa: E402
from src.services import conversations as cv  # noqa: E402

BASE_THRID = 9_100_000_000_000_000_000
BASE_MSGID = 9_200_000_000_000_000_000
OWN = "thefarmyardpark@gmail.com"
_msgids = itertools.count(1)


@pytest.fixture
def sandbox():
    """Track created message ids / thread ids and clean up afterwards."""
    state = {"messages": [], "threads": set(), "bookings": []}
    yield state
    for mid in state["messages"]:
        execute("DELETE FROM email_messages WHERE id = %s", (mid,))
    for thrid in state["threads"]:
        et.delete(thrid)
    for bid in state["bookings"]:
        execute("DELETE FROM booking_events WHERE booking_id = %s", (bid,))
        execute("DELETE FROM bookings WHERE id = %s", (bid,))


def add_message(sandbox, thrid, direction, at, **over):
    data = {
        "gmail_msgid": BASE_MSGID + next(_msgids),
        "gmail_thrid": thrid,
        "gmail_uid": 1,
        "folder": "INBOX" if direction == "inbound" else "[Gmail]/Sent Mail",
        "message_id_header": f"<test-{thrid}-{len(sandbox['messages'])}@example.com>",
        "direction": direction,
        "from_name": "Test Person" if direction == "inbound" else "The Farmyard Park",
        "from_email": "test.person@example.com" if direction == "inbound" else OWN,
        "to_emails": [OWN] if direction == "inbound" else ["test.person@example.com"],
        "cc_emails": [],
        "subject": "TEST conversation",
        "sent_at": at,
        "snippet": "test",
        "body_text": "Test body",
        "body_html": "<p>Test body</p>",
        "body_new_html": "<p>Test body</p>",
        "body_new_text": "Test body",
        "split_version": 1,
        "has_attachments": False,
        "review_status": "pending" if direction == "inbound" else "none",
        "is_auto_generated": False,
        "send_status": None if direction == "inbound" else "sent",
    }
    data.update(over)
    mid = em.insert(data)
    sandbox["messages"].append(mid)
    sandbox["threads"].add(thrid)
    return mid


def make_booking(sandbox):
    bid = execute(
        """
        INSERT INTO bookings (reference, doc_number, status, group_name, contact_name, contact_email,
                              visit_date, people_booked, price_per_person, deposit_due, barcode, source, enquiry_date)
        VALUES (%s, %s, 'enquiry', 'TEST conv group', 'Test Person', 'test.person@example.com',
                %s, 40, 95.00, 3800.00, %s, 'manual', %s)
        """,
        (f"T{BASE_THRID % 100000}", 9_900_000 + len(sandbox["bookings"]), datetime.now().date() + timedelta(days=30),
         f"TST{BASE_THRID % 10**10}", datetime.now().date()),
    )
    sandbox["bookings"].append(bid)
    return bid


def thread_ids_in(view, chip=None):
    rows, _total = et.list_conversations(view=view, chip=chip, page=1, page_size=200)
    return {int(r["gmail_thrid"]) for r in rows}


def test_views_follow_the_latest_counting_message(sandbox):
    t_needs = BASE_THRID + 1
    t_waiting = BASE_THRID + 2
    t_auto = BASE_THRID + 3
    now = datetime.now().replace(microsecond=0)
    add_message(sandbox, t_needs, "inbound", now - timedelta(hours=2))
    add_message(sandbox, t_waiting, "inbound", now - timedelta(hours=3))
    add_message(sandbox, t_waiting, "outbound", now - timedelta(hours=1))
    add_message(sandbox, t_auto, "inbound", now - timedelta(hours=1), is_auto_generated=True,
                from_email="noreply@example.com")
    for t in (t_needs, t_waiting, t_auto):
        cv.refresh_thread(t)

    assert t_needs in thread_ids_in("needs_reply") and t_waiting not in thread_ids_in("needs_reply")
    assert t_waiting in thread_ids_in("waiting") and t_needs not in thread_ids_in("waiting")
    assert {t_needs, t_waiting} <= thread_ids_in("unmatched")
    assert t_auto not in thread_ids_in("needs_reply") | thread_ids_in("unmatched") | thread_ids_in("waiting")
    assert t_auto in thread_ids_in("all") and t_auto in thread_ids_in("all", chip="automated")
    assert t_waiting in thread_ids_in("all", chip="sent") and t_needs not in thread_ids_in("all", chip="sent")
    assert t_needs in thread_ids_in("all", chip="inbound")

    # A failed send keeps the thread in Needs reply.
    add_message(sandbox, t_needs, "outbound", now - timedelta(minutes=30), send_status="failed", send_error="boom")
    cv.refresh_thread(t_needs)
    assert t_needs in thread_ids_in("needs_reply") and t_needs in thread_ids_in("all", chip="failed")

    row = et.get(t_needs)
    assert row["counterpart_email"] == "test.person@example.com" and row["message_count"] == 2
    assert row["subject"] == "TEST conversation" and row["last_snippet"] == "You: Test body"
    api = cv.thread_to_api(row)
    assert api["thrid"] == str(t_needs) and api["unread"] is True and api["status"] == "open"
    counts = et.counts()
    assert counts["needs_reply"] >= 1 and counts["all"] >= 3


def test_done_reopen_and_not_booking(sandbox):
    thrid = BASE_THRID + 10
    now = datetime.now().replace(microsecond=0)
    mid = add_message(sandbox, thrid, "inbound", now - timedelta(hours=2))
    cv.refresh_thread(thrid)
    assert thrid in thread_ids_in("needs_reply")

    done = cv.mark_done(thrid, actor=None)
    assert done["status"] == "done" and done["done_at"] is not None
    assert thrid in thread_ids_in("done")
    assert thrid not in thread_ids_in("needs_reply") and thrid not in thread_ids_in("unmatched")
    assert em.get(mid)["review_status"] == "resolved"  # legacy flag kept in step

    # An older inbound arriving late (e.g. a resync) does not reopen; a newer one does.
    cv.refresh_thread(thrid)
    assert et.get(thrid)["status"] == "done"
    add_message(sandbox, thrid, "inbound", now + timedelta(minutes=1))
    cv.refresh_thread(thrid)
    # Open again, but the mark survives: the party computation still knows
    # everything up to done_at was handled (docs/handoff/waiting-v3.md).
    assert et.get(thrid)["status"] == "open" and et.get(thrid)["done_at"] is not None
    assert thrid in thread_ids_in("needs_reply")

    reopened = cv.reopen(thrid, actor=None)
    assert reopened["status"] == "open" and reopened["done_at"] is None

    flagged = cv.set_not_booking(thrid, actor=None)
    assert flagged["not_booking"] is True and flagged["status"] == "done"
    assert thrid not in thread_ids_in("unmatched") and thrid in thread_ids_in("done")
    add_message(sandbox, thrid, "inbound", now + timedelta(minutes=2))
    cv.refresh_thread(thrid)
    row = et.get(thrid)
    assert row["status"] == "open" and row["not_booking"] == 1
    assert thrid in thread_ids_in("needs_reply") and thrid not in thread_ids_in("unmatched")


def test_attach_detach_and_notes_link_the_whole_thread(sandbox):
    thrid = BASE_THRID + 20
    now = datetime.now().replace(microsecond=0)
    m1 = add_message(sandbox, thrid, "inbound", now - timedelta(hours=3))
    m2 = add_message(sandbox, thrid, "outbound", now - timedelta(hours=2))
    cv.refresh_thread(thrid)
    booking_id = make_booking(sandbox)

    attached = cv.attach(thrid, booking_id, actor=None)
    assert attached["booking"]["id"] == booking_id
    assert em.get(m1)["booking_id"] == booking_id and em.get(m2)["booking_id"] == booking_id
    assert em.get(m1)["review_status"] == "resolved"
    assert int(query_one("SELECT email_thread_id FROM bookings WHERE id = %s", (booking_id,))["email_thread_id"]) == thrid
    assert thrid not in thread_ids_in("unmatched")

    note = cv.add_note(thrid, "  Phoned, will pay Friday  ", actor=None)
    assert note["type"] == "note" and note["body"] == "Phoned, will pay Friday" and note["source"] == "thread"
    stream = cv.get_conversation(thrid)
    types = [i["type"] for i in stream["items"]]
    assert types.count("note") == 1  # the booking-event mirror is deduped
    # attach writes an email_received event, but it duplicates the inbound card so the stream drops it
    assert query_one("SELECT COUNT(*) AS n FROM booking_events WHERE booking_id = %s AND kind = 'email_received'",
                     (booking_id,))["n"] == 1
    assert "event" not in types
    assert stream["thread"]["thrid"] == str(thrid) and stream["booking"]["id"] == booking_id

    via_booking = cv.booking_conversation(booking_id)
    assert [t["thrid"] for t in via_booking["threads"]] == [str(thrid)]
    assert {i["key"] for i in via_booking["items"]} >= {f"msg-{m1}", f"msg-{m2}", f"note-{note['id']}"}

    detached = cv.detach(thrid, actor=None)
    assert detached["booking"] is None
    assert em.get(m1)["booking_id"] is None and em.get(m1)["review_status"] == "pending"
    assert query_one("SELECT email_thread_id FROM bookings WHERE id = %s", (booking_id,))["email_thread_id"] is None
    assert thrid in thread_ids_in("unmatched")


def test_refresh_removes_the_row_when_the_last_message_goes(sandbox):
    thrid = BASE_THRID + 30
    mid = add_message(sandbox, thrid, "inbound", datetime.now())
    cv.refresh_thread(thrid)
    assert et.exists(thrid)
    execute("DELETE FROM email_messages WHERE id = %s", (mid,))
    sandbox["messages"].remove(mid)
    assert cv.refresh_thread(thrid) is None and not et.exists(thrid)
    with pytest.raises(cv.ConversationNotFound):
        cv.get_conversation(thrid)
