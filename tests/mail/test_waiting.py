"""Per-person waiting (docs/handoff/waiting-v3-contract.md).

The ``compute`` tests are pure. The rest needs the local MySQL from .env and
skips otherwise; every row created has a thread id above
9_300_000_000_000_000_000, a gmail_msgid above 9_400_000_000_000_000_000, a
``TEST`` subject or a ``.test`` address, and is deleted afterwards. Nothing
talks to Gmail and nothing is sent: the reply test replaces
``mail_send.compose`` with an insert.
"""

from __future__ import annotations

import itertools
from datetime import datetime, timedelta

import pytest

from src.services import waiting

OWN = "thefarmyardpark@gmail.com"
T = datetime(2026, 10, 7, 9, 0, 0)


def h(hours: float) -> datetime:
    return T + timedelta(hours=hours)


def thread(thrid, counterpart=None, booking_id=None, **over):
    row = {
        "gmail_thrid": thrid, "booking_id": booking_id, "status": "open", "done_at": None,
        "counterpart_email": counterpart, "counterpart_name": None, "subject": f"TEST {thrid}",
        "last_message_at": None, "last_snippet": None, "has_attachments": 0,
    }
    row.update(over)
    return row


def msg(i, thrid, direction, at, frm=None, to=(OWN,), cc=(), **over):
    row = {
        "id": i, "gmail_thrid": thrid, "direction": direction, "sent_at": at,
        "from_email": frm or (OWN if direction == "outbound" else "x@example.test"),
        "to_emails": list(to), "cc_emails": list(cc), "booking_id": None,
        "send_status": "sent" if direction == "outbound" else None, "is_auto_generated": False,
    }
    row.update(over)
    return row


# ----------------------------------------------------------------- pure ---


def test_address_party_spans_threads_and_a_cc_counts_as_written_to():
    threads = [thread(1, "x@example.test"), thread(2, "x@example.test")]
    messages = [msg(1, 1, "inbound", h(0)), msg(2, 2, "inbound", h(1))]
    snap = waiting.compute(threads, messages, {}, OWN)
    assert snap.thread_party == {1: "e:x@example.test", 2: "e:x@example.test"}
    assert [m["id"] for m in snap.unanswered["e:x@example.test"]] == [1, 2]
    assert snap.unanswered_by_thread == {1: 1, 2: 1}
    assert snap.last_handled["e:x@example.test"] is None
    item = waiting.party_summary("e:X@example.test", snap)
    assert item["party_key"] == "e:x@example.test" and item["unanswered_count"] == 2
    assert item["oldest_unanswered_at"] == "2026-10-07T09:00:00" and item["thread_count"] == 2
    assert item["primary_thrid"] == "2" and item["booking"] is None

    # An outbound the Sent sync has not threaded yet, with x only in cc, answers both threads.
    messages.append(msg(3, None, "outbound", h(1.5), to=("other@example.test",), cc=("X@example.test",)))
    snap = waiting.compute(threads, messages, {}, OWN)
    assert snap.last_handled["e:x@example.test"] == h(1.5)
    assert snap.unanswered["e:x@example.test"] == [] and waiting.waiting_parties(snap=snap) == []

    messages.append(msg(4, 2, "inbound", h(2)))
    snap = waiting.compute(threads, messages, {}, OWN)
    assert [m["id"] for m in snap.unanswered["e:x@example.test"]] == [4]
    assert [p["party_key"] for p in waiting.waiting_parties(snap=snap)] == ["e:x@example.test"]


def test_booking_party_collects_contacts_threads_and_done_marks():
    bookings = {5: {"id": 5, "reference": "FY1700", "group_name": "TEST school", "status": "confirmed",
                    "visit_date": datetime(2026, 11, 7).date(), "contact_name": "Jen", "contact_email": "X@example.test"}}
    threads = [thread(3, "x@example.test", booking_id=5), thread(4, "y@example.test", booking_id=5)]
    messages = [
        msg(5, 3, "inbound", h(0), frm="x@example.test"),
        msg(6, 4, "inbound", h(1), frm="y@example.test"),
        msg(7, None, "outbound", h(0.5), to=("x@example.test",), booking_id=5),
    ]
    snap = waiting.compute(threads, messages, bookings, OWN)
    assert snap.addresses["b:5"] == {"x@example.test", "y@example.test"}
    assert snap.last_handled["b:5"] == h(0.5)
    assert [m["id"] for m in snap.unanswered["b:5"]] == [6]
    item = waiting.party_summary("b:5", snap)
    assert item["booking"]["reference"] == "FY1700" and item["counterpart_email"] == "x@example.test"
    assert item["counterpart_name"] == "Jen" and item["unanswered_count"] == 1

    # A failed send and an automated inbound change nothing.
    messages += [
        msg(8, 4, "outbound", h(1.5), to=("y@example.test",), send_status="failed"),
        msg(9, 4, "inbound", h(2), frm="noreply@example.test", is_auto_generated=True),
    ]
    snap = waiting.compute(threads, messages, bookings, OWN)
    assert [m["id"] for m in snap.unanswered["b:5"]] == [6]

    # A done mark on the thread covers the message inside it.
    threads[1]["done_at"] = h(1.25)
    snap = waiting.compute(threads, messages, bookings, OWN)
    assert snap.unanswered["b:5"] == [] and snap.last_handled["b:5"] == h(1.25)
    msg10 = msg(10, 4, "inbound", h(3), frm="y@example.test")
    snap = waiting.compute(threads, messages + [msg10], bookings, OWN)
    assert [m["id"] for m in snap.unanswered["b:5"]] == [10]


def test_party_assignment_edge_cases():
    threads = [thread(6, "z@example.test"), thread(7, None), thread(8, OWN)]
    messages = [
        msg(11, 6, "inbound", h(0), frm="z@example.test", booking_id=9),  # linked message, unlinked thread row
        msg(12, 8, "inbound", h(0), frm=OWN),                            # our own copy in INBOX
    ]
    snap = waiting.compute(threads, messages, {}, OWN)
    assert snap.thread_party == {6: "b:9", 8: f"e:{OWN}"}
    assert snap.unanswered[f"e:{OWN}"] == []  # we never wait on ourselves
    assert waiting.party_key_for_thread(thread(7, None)) is None
    with pytest.raises(waiting.PartyError):
        waiting.parse_party_key("x:1")
    with pytest.raises(waiting.PartyError):
        waiting.parse_party_key("e:not-an-address")
    assert waiting.parse_party_key("b:12") == ("b", 12)
    assert waiting.normalise_party_key("e:Jo@Example.Test") == "e:jo@example.test"


def test_waiting_parties_order_and_search():
    threads = [thread(1, "a@example.test", counterpart_name="Anna"), thread(2, "b@example.test", subject="Bus trip")]
    messages = [msg(1, 1, "inbound", h(2), frm="a@example.test"), msg(2, 2, "inbound", h(1), frm="b@example.test")]
    snap = waiting.compute(threads, messages, {}, OWN)
    assert [p["party_key"] for p in waiting.waiting_parties(snap=snap)] == ["e:b@example.test", "e:a@example.test"]
    assert [p["party_key"] for p in waiting.waiting_parties(q="anna", snap=snap)] == ["e:a@example.test"]
    assert [p["party_key"] for p in waiting.waiting_parties(q="bus", snap=snap)] == ["e:b@example.test"]
    assert waiting.waiting_count(snap) == 2
    items = [{"type": "inbound", "id": 1}, {"type": "outbound", "id": 3}, {"type": "note", "id": 4}]
    marked = waiting.mark_unanswered(items, "e:a@example.test", snap)
    assert [i.get("unanswered") for i in marked] == [True, False, None]


# ------------------------------------------------------------------- DB ---

try:
    from src.models.base import execute, query_one

    query_one("SELECT 1 AS ok")
    DB_OK = True
except Exception:  # noqa: BLE001
    DB_OK = False

from src.models import email_message as em  # noqa: E402
from src.models import email_thread as et  # noqa: E402
from src.models import ignored_sender  # noqa: E402
from src.services import conversations as cv  # noqa: E402

BASE_THRID = 9_300_000_000_000_000_000
BASE_MSGID = 9_400_000_000_000_000_000
ADDR = "test.waiting@example.test"
_ids = itertools.count(1)

db = pytest.mark.skipif(not DB_OK, reason="MySQL not reachable")


@pytest.fixture
def sandbox():
    state = {"messages": [], "threads": set(), "bookings": [], "rules": [], "users": []}
    yield state
    for mid in state["messages"]:
        execute("DELETE FROM email_messages WHERE id = %s", (mid,))
    execute("DELETE FROM email_messages WHERE gmail_msgid >= %s", (BASE_MSGID,))
    for thrid in state["threads"]:
        et.delete(thrid)
    for bid in state["bookings"]:
        execute("DELETE FROM booking_events WHERE booking_id = %s", (bid,))
        execute("DELETE FROM bookings WHERE id = %s", (bid,))
    for pattern in state["rules"]:
        execute("DELETE FROM mail_ignored_senders WHERE pattern = %s", (pattern,))
    for uid in state["users"]:
        execute("DELETE FROM users WHERE id = %s", (uid,))


def add(sandbox, thrid, direction, at, frm=ADDR, to=None, cc=(), **over):
    data = {
        "gmail_msgid": BASE_MSGID + next(_ids), "gmail_thrid": thrid, "gmail_uid": 1,
        "folder": "INBOX" if direction == "inbound" else "[Gmail]/Sent Mail",
        "message_id_header": f"<test-waiting-{thrid}-{next(_ids)}@example.test>",
        "direction": direction, "from_name": "Test Waiting" if direction == "inbound" else "The Farmyard Park",
        "from_email": frm if direction == "inbound" else OWN,
        "to_emails": list(to) if to is not None else ([OWN] if direction == "inbound" else [ADDR]),
        "cc_emails": list(cc), "subject": "TEST waiting", "sent_at": at, "snippet": "test",
        "body_text": "Test body", "body_html": "<p>Test body</p>", "body_new_html": "<p>Test body</p>",
        "body_new_text": "Test body", "split_version": 1, "has_attachments": False,
        "review_status": "pending" if direction == "inbound" else "none", "is_auto_generated": False,
        "send_status": None if direction == "inbound" else "sent",
    }
    data.update(over)
    mid = em.insert(data)
    sandbox["messages"].append(mid)
    if thrid:
        sandbox["threads"].add(thrid)
        cv.refresh_thread(thrid)
    return mid


def make_booking(sandbox, email=ADDR):
    n = len(sandbox["bookings"])
    bid = execute(
        """
        INSERT INTO bookings (reference, doc_number, status, group_name, contact_name, contact_email,
                              visit_date, people_booked, price_per_person, deposit_due, barcode, source, enquiry_date)
        VALUES (%s, %s, 'enquiry', 'TEST waiting group', 'Test Waiting', %s, %s, 40, 95.00, 3800.00, %s, 'manual', %s)
        """,
        (f"TW{n}", 9_910_000 + n, email, datetime.now().date() + timedelta(days=30), f"TSTW{n:09d}", datetime.now().date()),
    )
    sandbox["bookings"].append(bid)
    return bid


@db
def test_done_and_reopen_per_party_across_threads(sandbox):
    now = datetime.now().replace(microsecond=0)
    t1, t2 = BASE_THRID + 1, BASE_THRID + 2
    bid = make_booking(sandbox)
    m1 = add(sandbox, t1, "inbound", now - timedelta(hours=3), booking_id=bid)
    add(sandbox, t2, "inbound", now - timedelta(hours=2), frm="colleague@example.test", booking_id=bid)
    key = f"b:{bid}"
    assert waiting.party_summary(key)["unanswered_count"] == 2
    assert waiting.party_addresses(key) == {ADDR, "colleague@example.test"}
    assert key in {p["party_key"] for p in waiting.waiting_parties()}
    assert cv.counts()["needs_reply"] == waiting.waiting_count()

    done = waiting.mark_done(key, actor=None)
    assert done["unanswered_count"] == 0
    assert all(et.get(t)["status"] == "done" and et.get(t)["done_at"] for t in (t1, t2))
    assert em.get(m1)["review_status"] == "resolved"
    assert key not in {p["party_key"] for p in waiting.waiting_parties()}

    # A later inbound makes the party waiting again, counting only the new message.
    m3 = add(sandbox, t1, "inbound", now + timedelta(minutes=1), booking_id=bid)
    assert et.get(t1)["status"] == "open" and et.get(t1)["done_at"] is not None
    assert [m["id"] for m in waiting.unanswered_messages(key)] == [m3]

    reopened = waiting.reopen(key, actor=None)
    assert reopened["unanswered_count"] == 3  # the mark is gone: nothing was ever written to them
    assert all(et.get(t)["done_at"] is None for t in (t1, t2))

    stream = waiting.party_stream(key)
    assert stream["party_key"] == key and stream["unanswered_count"] == 3
    assert [t["thrid"] for t in stream["threads"]] == [str(t2), str(t1)] or {t["thrid"] for t in stream["threads"]} == {str(t1), str(t2)}
    assert all(t["party_key"] == key for t in stream["threads"])
    assert all(i["unanswered"] is True for i in stream["items"] if i["type"] == "inbound")
    booking_view = cv.booking_conversation(bid)
    assert booking_view["party_key"] == key and booking_view["unanswered_count"] == 3
    thread_view = cv.get_conversation(t1)
    assert thread_view["party_key"] == key and thread_view["thread"]["unanswered_count"] == 2
    assert [i["unanswered"] for i in thread_view["items"] if i["type"] == "inbound"] == [True, True]


@db
def test_address_party_and_not_booking_learns_the_sender(sandbox):
    now = datetime.now().replace(microsecond=0)
    t1, t2, t3 = BASE_THRID + 11, BASE_THRID + 12, BASE_THRID + 13
    add(sandbox, t1, "inbound", now - timedelta(hours=2), frm="sales@testvendor.example")
    add(sandbox, t2, "inbound", now - timedelta(hours=1), frm="accounts@testvendor.example")
    add(sandbox, t3, "inbound", now - timedelta(hours=1), frm="jo.test@gmail.com")
    sandbox["rules"] += ["testvendor.example", "jo.test@gmail.com"]
    assert waiting.party_summary("e:sales@testvendor.example")["unanswered_count"] == 1
    assert cv.learn_scope_for("jo.test@gmail.com") == "address"
    assert cv.learn_scope_for("x@mail.yahoo.co.uk") == "address" and cv.learn_scope_for("x@hotmail.fr") == "address"
    assert cv.learn_scope_for("sales@testvendor.example") == "domain"
    assert cv.learn_scope_for("sales@testvendor.example", "address") == "address"

    result = cv.not_booking(t1, actor=None, learn=True)
    assert result["scope"] == "domain" and result["rule"]["pattern"] == "@testvendor.example"
    assert result["rule"]["kind"] == "domain" and result["threads_closed"] == 2
    for t in (t1, t2):
        row = et.get(t)
        assert row["status"] == "done" and row["not_booking"] == 1
    assert et.get(t3)["status"] == "open"
    assert ignored_sender.matches("anyone@testvendor.example")["kind"] == "domain"
    assert ignored_sender.matches("anyone@sub.testvendor.example") is not None
    assert ignored_sender.matches("anyone@nottestvendor.example") is None
    assert "e:sales@testvendor.example" not in {p["party_key"] for p in waiting.waiting_parties()}

    gmail = cv.not_booking(t3, actor=None, learn=True)
    assert gmail["scope"] == "address" and gmail["rule"]["pattern"] == "jo.test@gmail.com"
    assert ignored_sender.matches("jo.test@gmail.com")["kind"] == "address"
    assert ignored_sender.matches("other@gmail.com") is None
    # Learning twice is idempotent.
    assert cv.not_booking(t3, actor=None, learn=True)["rule"]["id"] == gmail["rule"]["id"]


# ------------------------------------------------------------------- API ---


@pytest.fixture(scope="module")
def app():
    from web.app import create_app

    app = create_app()
    app.config.update(TESTING=True)
    return app


@pytest.fixture
def admin(app, sandbox):
    from web.api import SESSION_CSRF_KEY, SESSION_USER_KEY

    email = "test-waiting-admin@example.test"
    execute("DELETE FROM users WHERE email = %s", (email,))
    uid = execute(
        "INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active) "
        "VALUES (%s, 'TEST waiting admin', 'admin', 'not-a-real-hash', 0, 1)",
        (email,),
    )
    sandbox["users"].append(uid)
    client = app.test_client()
    with client.session_transaction() as sess:
        sess[SESSION_USER_KEY] = uid
        sess[SESSION_CSRF_KEY] = "test-csrf"
    return client


CSRF = {"X-CSRF-Token": "test-csrf"}


@db
def test_party_endpoints(sandbox, admin, monkeypatch):
    now = datetime.now().replace(microsecond=0)
    t1, t2 = BASE_THRID + 21, BASE_THRID + 22
    add(sandbox, t1, "inbound", now - timedelta(hours=3))
    add(sandbox, t2, "inbound", now - timedelta(hours=2))
    key = f"e:{ADDR}"

    res = admin.get("/api/v1/inbox/conversations?view=needs_reply&page_size=200")
    assert res.status_code == 200
    body = res.get_json()
    item = next(i for i in body["items"] if i["party_key"] == key)
    assert set(item) == {
        "party_key", "booking", "counterpart_name", "counterpart_email", "unanswered_count", "oldest_unanswered_at",
        "last_message_at", "last_snippet", "subject", "thread_count", "primary_thrid", "has_attachments",
    }
    assert item["unanswered_count"] == 2 and item["thread_count"] == 2 and item["primary_thrid"] == str(t2)
    assert body["counts"]["needs_reply"] == body["total"]
    assert admin.get(f"/api/v1/inbox/conversations?view=needs_reply&q={ADDR}").get_json()["total"] == 1
    unmatched = admin.get("/api/v1/inbox/conversations?view=unmatched&page_size=200").get_json()["items"]
    row = next(i for i in unmatched if i["thrid"] == str(t1))
    assert row["party_key"] == key and row["unanswered_count"] == 1

    res = admin.get(f"/api/v1/inbox/parties/{key}")
    assert res.status_code == 200
    party = res.get_json()
    assert party["unanswered_count"] == 2 and len(party["threads"]) == 2
    assert [i["unanswered"] for i in party["items"]] == [True, True]
    assert admin.get("/api/v1/inbox/parties/e:nobody@nowhere.test").status_code == 404
    assert admin.get("/api/v1/inbox/parties/b:999999999").status_code == 404
    assert admin.get("/api/v1/inbox/parties/nope").status_code == 422

    # Reply on the party: threads onto the newest thread, no SMTP (compose is replaced).
    sent: dict = {}

    def fake_compose(*, to, subject, body_html, booking_id, actor, cc=(), attachments=(), body_text=None,
                     thread_message_id=None, gmail_thrid=None, kind=None):
        mid = add(sandbox, gmail_thrid, "outbound", now - timedelta(minutes=30), to=to, cc=cc,
                  subject=subject, kind=kind, booking_id=booking_id)
        sent.update(to=to, thrid=gmail_thrid, parent=thread_message_id)
        return {**em.get(mid), "id": mid}

    import src.services.mail_send as mail_send

    monkeypatch.setattr(mail_send, "compose", fake_compose)
    res = admin.post(f"/api/v1/inbox/parties/{key}/reply", json={"body_html": "<p>Thanks, noted.</p>"}, headers=CSRF)
    assert res.status_code == 201, res.get_json()
    out = res.get_json()
    assert sent["to"] == [ADDR] and sent["thrid"] == t2 and sent["parent"]
    assert out["party"]["unanswered_count"] == 0 and out["item"]["type"] == "outbound"
    assert key not in {i["party_key"] for i in admin.get("/api/v1/inbox/conversations?view=needs_reply&page_size=200").get_json()["items"]}
    assert admin.post(f"/api/v1/inbox/parties/{key}/reply", json={"body_html": "x", "thrid": "1"}, headers=CSRF).status_code == 422
    assert admin.post(f"/api/v1/inbox/parties/{key}/reply", json={"body_html": "x"}).status_code == 403  # CSRF

    # Another inbound (after our reply, before the done mark) → waiting; done; reopen.
    add(sandbox, t1, "inbound", now - timedelta(minutes=10))
    assert admin.get(f"/api/v1/inbox/parties/{key}").get_json()["unanswered_count"] == 1
    res = admin.post(f"/api/v1/inbox/parties/{key}/done", headers=CSRF)
    assert res.status_code == 200
    assert res.get_json()["party"]["unanswered_count"] == 0 and all(t["status"] == "done" for t in res.get_json()["threads"])
    res = admin.post(f"/api/v1/inbox/parties/{key}/reopen", headers=CSRF)
    assert res.status_code == 200 and res.get_json()["party"]["unanswered_count"] == 1
    assert all(t["status"] == "open" and t["done_at"] is None for t in res.get_json()["threads"])

    # Not a booking with learning, through the API.
    sandbox["rules"].append(ADDR)
    res = admin.post(f"/api/v1/inbox/conversations/{t1}/not-booking", json={"learn": True, "scope": "address"}, headers=CSRF)
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["rule"]["pattern"] == ADDR and body["threads_closed"] == 2 and body["thread"]["not_booking"] is True
    assert admin.post(f"/api/v1/inbox/conversations/{t1}/not-booking", json={"scope": "planet"}, headers=CSRF).status_code == 422
    res = admin.post(f"/api/v1/inbox/conversations/{t1}/not-booking", json={"value": False}, headers=CSRF)
    assert res.status_code == 200 and res.get_json()["thread"]["not_booking"] is False


@db
def test_ignored_sender_endpoints(sandbox, admin):
    sandbox["rules"] += ["testignore.example", "someone@testignore.example"]
    res = admin.post("/api/v1/inbox/ignored-senders", json={"pattern": "@TestIgnore.Example", "reason": "spam"}, headers=CSRF)
    assert res.status_code == 201, res.get_json()
    item = res.get_json()["item"]
    assert item["pattern"] == "@testignore.example" and item["kind"] == "domain" and item["reason"] == "spam"
    res = admin.post("/api/v1/inbox/ignored-senders", json={"pattern": "Someone@TestIgnore.Example"}, headers=CSRF)
    assert res.status_code == 201 and res.get_json()["item"]["kind"] == "address"
    assert admin.post("/api/v1/inbox/ignored-senders", json={"pattern": "nonsense"}, headers=CSRF).status_code == 422
    assert admin.post("/api/v1/inbox/ignored-senders", json={}, headers=CSRF).status_code == 422
    listed = admin.get("/api/v1/inbox/ignored-senders").get_json()["items"]
    assert {i["pattern"] for i in listed} >= {"@testignore.example", "someone@testignore.example"}
    assert set(listed[0]) == {"id", "pattern", "kind", "reason", "created_by", "created_at"}
    assert admin.delete(f"/api/v1/inbox/ignored-senders/{item['id']}", headers=CSRF).status_code == 200
    assert admin.delete(f"/api/v1/inbox/ignored-senders/{item['id']}", headers=CSRF).status_code == 404
    assert ignored_sender.matches("x@testignore.example") is None
