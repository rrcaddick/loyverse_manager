"""Work views, up_next ordering, the stale rule and the Work API against TEST rows.

Every row these tests create is a ``TEST ...`` booking, a thread id in the
TEST_THRID range or a bank fingerprint starting ``TEST-work-``; all are deleted
afterwards. ``recompute_reminders`` runs as part of the fixture: it is the
daily job and idempotent, so real rows end up exactly as the cron leaves them.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from src.models.base import dumps, execute, query, query_one
from src.services import reminders, work
from src.services.public_form import _fallback_create_booking
from src.utils.date import get_today
from tests.ops.conftest import delete_test_bookings

pytestmark = pytest.mark.usefixtures("db")

TEST_THRID = 999900000000000001
ROW_KEYS = {
    "kind", "id", "booking", "title", "context", "amount", "age_days", "group",
    "primary", "secondary", "sort_key",
}


def make(group, visit, status, **cols):
    booking = _fallback_create_booking(
        {
            "group_name": group,
            "group_type": "church",
            "contact_name": "Test Contact",
            "contact_email": f"{group.split()[-1].lower()}@example.test",
            "contact_mobile": "27820000000",
            "visit_date": visit.isoformat(),
            "adults": 50,
            "children": 10,
            "people_booked": 60,
            "price_per_person": "95.00",
        },
        "manual",
        None,
    )
    cols.setdefault("status", status)
    assignments = ", ".join(f"{k} = %s" for k in cols)
    execute(f"UPDATE bookings SET {assignments} WHERE id = %s", (*cols.values(), booking["id"]))
    return query_one("SELECT * FROM bookings WHERE id = %s", (booking["id"],))


def at(day, hour=9):
    return datetime.combine(day, datetime.min.time()).replace(hour=hour)


def cleanup():
    execute("DELETE FROM email_threads WHERE gmail_thrid BETWEEN %s AND %s", (TEST_THRID, TEST_THRID + 9))
    execute("DELETE FROM bank_transactions WHERE fingerprint LIKE 'TEST-work-%%'")
    delete_test_bookings()


@pytest.fixture
def rows():
    cleanup()
    today = get_today()
    now = datetime.now()
    r = {}
    r["hold_past"] = make(
        "TEST Hold Past", today + timedelta(days=5), "proforma_sent",
        proforma_sent_at=at(today - timedelta(days=3)), hold_expires_on=today - timedelta(days=2),
    )
    r["hold_soon"] = make(
        "TEST Hold Soon", today + timedelta(days=9), "proforma_sent",
        proforma_sent_at=at(today - timedelta(days=3)), hold_expires_on=today + timedelta(days=2),
    )
    r["arrival_yesterday"] = make("TEST Arrival Yesterday", today - timedelta(days=1), "confirmed", confirmed_at=now)
    r["arrival_today"] = make("TEST Arrival Today", today, "confirmed", confirmed_at=now)
    r["request"] = make(
        "TEST New Request", today + timedelta(days=20), "enquiry",
        enquiry_date=today - timedelta(days=4), source="form",
    )
    r["ticket"] = make(
        "TEST Ticket Mobile", today + timedelta(days=3), "confirmed",
        confirmed_at=at(today - timedelta(days=200)), contact_email=None,
    )
    r["reminder"] = make(
        "TEST Reminder Live", today + timedelta(days=30), "proforma_sent",
        proforma_sent_at=at(today - timedelta(days=10)),
    )
    r["stale_old"] = make(
        "TEST Stale Old", today + timedelta(days=40), "proforma_sent",
        proforma_sent_at=at(today - timedelta(days=100)),
    )
    r["stale_proforma"] = make(
        "TEST Stale Proforma", today + timedelta(days=10), "proforma_sent",
        proforma_sent_at=at(today - timedelta(days=70)),
    )
    execute(
        """
        INSERT INTO email_threads (gmail_thrid, booking_id, status, subject, counterpart_name,
            counterpart_email, message_count, last_message_at, last_inbound_at, last_direction,
            has_automated_only)
        VALUES (%s, %s, 'open', 'Re: TEST visit', 'Thandi Test', 'thandi@example.test', 2, %s, %s,
                'inbound', 0)
        """,
        (TEST_THRID, r["reminder"]["id"], now - timedelta(days=2), now - timedelta(days=2)),
    )
    suggestions = [{
        "booking_id": r["reminder"]["id"], "reference": r["reminder"]["reference"],
        "group_name": r["reminder"]["group_name"], "score": 40,
        "reasons": ["Amount equals the deposit"],
    }]
    execute(
        """
        INSERT INTO bank_transactions (fingerprint, account_number, booking_date, description, amount,
            credit_debit, match_status, suggestions)
        VALUES ('TEST-work-sugg', 'TEST', %s, 'TEST EFT DEPOSIT  FY0000', 3800, 'CREDIT', 'suggested', %s),
               ('TEST-work-unm', 'TEST', %s, 'TEST  UNKNOWN  CREDIT', 500, 'CREDIT', 'unmatched', NULL),
               ('TEST-work-old', 'TEST', %s, 'TEST OLD CREDIT', 700, 'CREDIT', 'unmatched', NULL)
        """,
        (today - timedelta(days=6), dumps(suggestions), today - timedelta(days=5), today - timedelta(days=45)),
    )
    reminders.recompute_reminders()
    r["today"] = today
    yield r
    cleanup()


def reminder_rows(booking_id):
    return {x["kind"]: x for x in query("SELECT * FROM booking_reminders WHERE booking_id = %s", (booking_id,))}


def ids(rows):
    return [x["id"] for x in rows]


def by_id(rows, ident):
    return next(x for x in rows if x["id"] == ident)


def verbs(row):
    return [a["verb"] for a in row["secondary"]]


# ------------------------------------------------------------- stale rule ---


def test_stale_rule_flags_old_and_quiet_reminders(rows):
    today = rows["today"]
    live = reminder_rows(rows["reminder"]["id"])
    assert live["still_interested"]["due_on"] == today - timedelta(days=3)
    assert live["still_interested"]["stale"] == 0

    old = reminder_rows(rows["stale_old"]["id"])
    assert old["still_interested"]["due_on"] < today - timedelta(days=30)
    assert old["still_interested"]["stale"] == 1  # clause 1: due more than 30 days ago

    quiet = reminder_rows(rows["stale_proforma"]["id"])
    assert quiet["deposit_reminder"]["due_on"] == today - timedelta(days=4)
    # Clause 2 (old unpaid proforma) only parks "still interested" nudges; a
    # deposit reminder for an upcoming visit stays live however old the proforma.
    assert quiet["deposit_reminder"]["stale"] == 0
    assert quiet["lapse"]["due_on"] == today + timedelta(days=3)
    assert quiet["lapse"]["stale"] == 0  # not due yet, so never stale

    n_live = query_one(
        "SELECT COUNT(*) AS n FROM booking_reminders WHERE status = 'due' AND stale = 0 AND due_on <= %s",
        (today,),
    )["n"]
    assert reminders.due_reminder_count(today) == int(n_live)


def test_stale_rule_unflags_when_condition_stops(rows):
    old = reminder_rows(rows["stale_old"]["id"])["still_interested"]
    execute("UPDATE booking_reminders SET due_on = %s WHERE id = %s", (rows["today"], old["id"]))
    execute("UPDATE bookings SET proforma_sent_at = %s WHERE id = %s", (at(rows["today"]), rows["stale_old"]["id"]))
    reminders.flag_stale(rows["today"])
    assert query_one("SELECT stale FROM booking_reminders WHERE id = %s", (old["id"],))["stale"] == 0


def test_bulk_dismiss_skips_unknown_and_non_due(rows):
    old = reminder_rows(rows["stale_old"]["id"])["still_interested"]
    result = reminders.bulk_dismiss([old["id"], 999999999], actor=None)
    assert result == {"dismissed": 1, "ids": [old["id"]], "skipped": [999999999]}
    row = query_one("SELECT * FROM booking_reminders WHERE id = %s", (old["id"],))
    assert row["status"] == "dismissed" and row["stale"] == 0
    assert query_one(
        "SELECT 1 AS one FROM booking_events WHERE booking_id = %s AND kind = 'reminder_dismissed'",
        (rows["stale_old"]["id"],),
    )
    again = reminders.bulk_dismiss([old["id"]], actor=None)
    assert again["dismissed"] == 0 and again["skipped"] == [old["id"]]
    assert reminders.bulk_dismiss([], None) == {"dismissed": 0, "ids": [], "skipped": []}


# ------------------------------------------------------------------ views ---


def test_every_row_has_the_same_shape(rows):
    snap = work.snapshot()
    for view, items in snap["views"].items():
        assert snap["counts"][view] == len(items)
        for row in items:
            assert set(row) == ROW_KEYS, (view, row["id"])
            assert row["id"].startswith(f"{row['kind']}:")
            assert {"verb", "action"} <= set(row["primary"])
            assert all({"verb", "action"} <= set(a) for a in row["secondary"])
            assert isinstance(row["age_days"], int) and row["age_days"] >= 0
            assert row["booking"] is None or set(row["booking"]) == {
                "id", "reference", "group_name", "visit_date", "status", "people_booked"
            }
    assert snap["counts"]["total"] == sum(len(snap["views"][v]) for v in work.LIVE_VIEWS)
    assert snap["counts"]["up_next"] == len(snap["up_next"]) <= work.UP_NEXT_SIZE
    assert work.counts() == snap["counts"]


def test_holds_view(rows):
    holds = work.snapshot()["views"]["holds"]
    past = by_id(holds, f"hold:{rows['hold_past']['id']}")
    soon = by_id(holds, f"hold:{rows['hold_soon']['id']}")
    assert holds.index(past) < holds.index(soon)
    assert past["context"].startswith("Hold expired 2 d ago · deposit R")
    assert past["age_days"] == 2 and past["amount"] == float(rows["hold_past"]["deposit_due"])
    assert past["primary"] == {
        "verb": "Extend", "action": "extend_hold", "booking_id": rows["hold_past"]["id"],
        "hold_expires_on": (rows["today"] - timedelta(days=2)).isoformat(),
    }
    assert verbs(past) == ["Send expiry", "Open", "Dismiss"]
    assert soon["context"].startswith("Hold expires in 2 d") and soon["age_days"] == 0
    assert past["sort_key"] < soon["sort_key"]
    # the booking whose lapse reminder is stale/dismissed leaves the view
    execute(
        "UPDATE booking_reminders SET stale = 1 WHERE booking_id = %s AND kind = 'lapse'",
        (rows["hold_past"]["id"],),
    )
    assert f"hold:{rows['hold_past']['id']}" not in ids(work.snapshot()["views"]["holds"])


def test_arrivals_view(rows):
    arrivals = work.snapshot()["views"]["arrivals"]
    today_row = by_id(arrivals, f"arrival:{rows['arrival_today']['id']}")
    yesterday = by_id(arrivals, f"arrival:{rows['arrival_yesterday']['id']}")
    assert arrivals.index(today_row) < arrivals.index(yesterday)  # most recent first
    assert today_row["context"] == "Visited today · 60 booked"
    assert today_row["primary"] == {
        "verb": "Record", "action": "open_day", "date": rows["today"].isoformat(),
        "booking_id": rows["arrival_today"]["id"],
    }
    assert verbs(today_row) == ["Open"]
    assert verbs(yesterday) == ["Open", "No show"]
    assert yesterday["secondary"][1]["status"] == "no_show" and yesterday["age_days"] == 1


def test_new_requests_tickets_and_reminders(rows):
    views = work.snapshot()["views"]
    req = by_id(views["new_requests"], f"new_request:{rows['request']['id']}")
    assert req["context"] == "Form request · Test Contact · waiting 4 d" and req["age_days"] == 4
    assert req["primary"] == {"verb": "Send proforma", "action": "open_booking", "booking_id": rows["request"]["id"]}
    assert req["secondary"] == []

    ticket = by_id(views["send_tickets"], f"ticket:{rows['ticket']['id']}")
    assert ticket["primary"] == {
        "verb": "Send ticket", "action": "booking_action", "booking_id": rows["ticket"]["id"],
        "name": "send-ticket-whatsapp",
    }
    assert ticket["context"].endswith("in 3 d · WhatsApp only") and ticket["age_days"] == 0
    assert verbs(ticket) == ["Open"]

    live = by_id(views["reminders"], f"reminder:{reminder_rows(rows['reminder']['id'])['still_interested']['id']}")
    assert live["group"] == "Still interested?"
    assert live["primary"]["action"] == "booking_action" and live["primary"]["kind"] == "still_interested"
    assert live["context"].startswith("Due 3 d ago · visit ")
    assert verbs(live) == ["Open", "Dismiss"]
    assert all(r["group"] != "Hold expiring" for r in views["reminders"])  # holds have their own view
    stale_id = reminder_rows(rows["stale_old"]["id"])["still_interested"]["id"]
    assert f"reminder:{stale_id}" not in ids(views["reminders"])
    # reminders view is contiguous by kind
    groups = [r["group"] for r in views["reminders"]]
    seen, order = set(), []
    for g in groups:
        if g not in seen:
            seen.add(g)
            order.append(g)
    assert groups == [g for g in order for _ in range(groups.count(g))]


def test_stale_view(rows):
    stale = work.snapshot()["views"]["stale"]
    old = reminder_rows(rows["stale_old"]["id"])["still_interested"]
    row = by_id(stale, f"reminder:{old['id']}")
    assert row["primary"] == {"verb": "Dismiss", "action": "dismiss_reminders", "ids": [old["id"]]}
    assert row["context"].endswith("· stale") and row["age_days"] == 93
    quiet = reminder_rows(rows["stale_proforma"]["id"])["deposit_reminder"]
    assert f"reminder:{quiet['id']}" not in ids(stale)  # old proforma alone no longer parks a deposit reminder


def test_reply_and_money_views(rows):
    views = work.snapshot()["views"]
    reply = by_id(views["reply"], f"reply:{TEST_THRID}")
    assert reply["booking"]["reference"] == rows["reminder"]["reference"]
    assert reply["context"] == "Thandi Test · waiting 2 d" and reply["age_days"] == 2
    assert reply["primary"] == {
        "verb": "Reply", "action": "open_conversation", "thrid": str(TEST_THRID),
        "booking_id": rows["reminder"]["id"],
    }

    money = views["confirm_money"]
    sugg = query_one("SELECT id FROM bank_transactions WHERE fingerprint = 'TEST-work-sugg'")["id"]
    unm = query_one("SELECT id FROM bank_transactions WHERE fingerprint = 'TEST-work-unm'")["id"]
    old = query_one("SELECT id FROM bank_transactions WHERE fingerprint = 'TEST-work-old'")["id"]
    s = by_id(money, f"money:{sugg}")
    u = by_id(money, f"money:{unm}")
    assert f"money:{old}" not in ids(money)
    assert s["title"] == "TEST EFT DEPOSIT FY0000" and s["amount"] == 3800.0
    assert s["context"] == f"Suggested {rows['reminder']['reference']} · equals the deposit"
    assert s["booking"]["id"] == rows["reminder"]["id"]
    assert s["primary"] == {"verb": "Confirm", "action": "match_transaction", "tx_id": sugg, "booking_id": rows["reminder"]["id"]}
    assert verbs(s) == ["Open", "Ignore"]
    assert u["booking"] is None and u["primary"] == {"verb": "Match", "action": "open_transaction", "tx_id": unm}
    assert u["secondary"] == [{"verb": "Not a booking", "action": "ignore_transaction", "tx_id": unm, "reason": "Not a booking"}]
    assert all(r["sort_key"] < u["sort_key"] for r in money if r["primary"]["verb"] == "Confirm")


def test_reply_fallback_uses_messages_when_threads_table_is_empty(rows):
    now = datetime.now()
    execute(
        """
        INSERT INTO email_messages (direction, from_name, from_email, subject, sent_at, booking_id, snippet, gmail_thrid)
        VALUES ('outbound', 'Park', 'park@example.test', 'Your proforma', %s, %s, 'Attached', %s),
               ('inbound', 'Customer', 'request@example.test', 'Re: Your proforma', %s, %s, 'Thanks', %s)
        """,
        (now - timedelta(hours=2), rows["request"]["id"], TEST_THRID + 1, now - timedelta(hours=1), rows["request"]["id"], TEST_THRID + 1),
    )
    fallback = work._reply_rows(rows["today"], use_threads=False)
    row = by_id(fallback, f"reply:{TEST_THRID + 1}")
    assert row["booking"]["id"] == rows["request"]["id"] and row["context"] == "Customer · waiting 0 d"


# ---------------------------------------------------------------- up next ---


def test_up_next_orders_by_tier_then_age(rows):
    snap = work.snapshot()
    up = snap["up_next"]
    tiers = [int(r["sort_key"][:2]) for r in up]
    assert tiers == sorted(tiers)
    assert [r["sort_key"] for r in up] == sorted(r["sort_key"] for r in up)
    order = ids(up)
    past, today_row, yesterday = (
        f"hold:{rows['hold_past']['id']}",
        f"arrival:{rows['arrival_today']['id']}",
        f"arrival:{rows['arrival_yesterday']['id']}",
    )
    assert order.index(past) < order.index(today_row) < order.index(yesterday)
    assert all(r["kind"] != "reminder" or not r["context"].endswith("stale") for r in up)
    needs = work.needs_you(snap)
    assert needs["count"] == snap["counts"]["total"]
    assert needs["oldest_days"] >= 93 - 0 or needs["oldest_days"] >= 4  # at least the live TEST ages


def test_merge_up_next_is_pure_and_limited():
    views = {
        "reply": [{"sort_key": "03:a", "id": "reply:1"}],
        "holds": [{"sort_key": "01:z", "id": "hold:1"}, {"sort_key": "07:b", "id": "hold:2"}],
        "arrivals": [{"sort_key": "02:m", "id": "arrival:1"}],
        "stale": [{"sort_key": "00:0", "id": "reminder:9"}],
    }
    merged = work.merge_up_next(views, limit=3)
    assert [r["id"] for r in merged] == ["hold:1", "arrival:1", "reply:1"]


def test_formatting_helpers():
    assert work._rel(3) == "3 d ago" and work._rel(0) == "today" and work._rel(-2) == "in 2 d"
    assert work._rands(3800) == "R3 800" and work._rands("3290.5") == "R3 290.50" and work._rands(0) == "R0"
    assert work._reason_text("Amount equals the deposit") == "equals the deposit"
    assert work._reason_text("Reference FY1710 in description") == "reference FY1710 in description"
    assert work._reason_text(None) == "possible match"
    assert work._key(7, datetime(2026, 10, 5), 12) == "07:2026-10-05T00:00:00:00000012"


def test_list_work_pages_and_rejects_unknown_views(rows):
    page = work.list_work("holds", page=1, page_size=1)
    assert page["page_size"] == 1 and len(page["items"]) == 1 and page["total"] >= 2
    assert page["view"] == "holds" and "counts" in page and page["today"] == rows["today"].isoformat()
    with pytest.raises(ValueError):
        work.list_work("nope")


# -------------------------------------------------------------------- API ---


@pytest.fixture(scope="module")
def app():
    from web.app import create_app

    app = create_app()
    app.config.update(TESTING=True)
    import web.api.today as today_api
    import web.api.work as work_api

    for mod in (work_api, today_api):
        if mod.bp.name not in app.blueprints:
            app.register_blueprint(mod.bp)
    return app


def _client(app, role):
    from web.api import SESSION_CSRF_KEY, SESSION_USER_KEY

    email = f"test-work-{role}@example.test"
    execute("DELETE FROM users WHERE email = %s", (email,))
    uid = execute(
        """
        INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
        VALUES (%s, %s, %s, 'not-a-real-hash', 0, 1)
        """,
        (email, f"TEST work {role}", role),
    )
    client = app.test_client()
    with client.session_transaction() as sess:
        sess[SESSION_USER_KEY] = uid
        sess[SESSION_CSRF_KEY] = "test-csrf"
    return client, uid


@pytest.fixture
def admin(app):
    client, uid = _client(app, "admin")
    yield client
    execute("DELETE FROM users WHERE id = %s", (uid,))


@pytest.fixture
def manager(app):
    client, uid = _client(app, "manager")
    yield client
    execute("DELETE FROM users WHERE id = %s", (uid,))


CSRF = {"X-CSRF-Token": "test-csrf"}


def test_work_endpoints(rows, admin, manager):
    res = admin.get("/api/v1/work?view=holds&page_size=200")
    assert res.status_code == 200
    body = res.get_json()
    assert {"items", "total", "page", "page_size", "counts", "view", "today"} <= set(body)
    assert f"hold:{rows['hold_past']['id']}" in ids(body["items"])
    assert admin.get("/api/v1/work?view=bogus").status_code == 422
    assert admin.get("/api/v1/work?page=x").status_code == 400
    assert manager.get("/api/v1/work").status_code == 403
    assert manager.get("/api/v1/work/counts").status_code == 403
    counts = admin.get("/api/v1/work/counts").get_json()["counts"]
    assert counts == body["counts"]

    old = reminder_rows(rows["stale_old"]["id"])["still_interested"]
    res = admin.post("/api/v1/work/reminders/dismiss", json={"ids": [f"reminder:{old['id']}"]}, headers=CSRF)
    assert res.status_code == 200
    assert res.get_json()["dismissed"] == 1 and res.get_json()["counts"]["stale"] == counts["stale"] - 1
    assert admin.post("/api/v1/work/reminders/dismiss", json={"ids": "x"}, headers=CSRF).status_code == 422
    assert admin.post("/api/v1/work/reminders/dismiss", json={"ids": ["a"]}, headers=CSRF).status_code == 422
    assert admin.post("/api/v1/work/reminders/dismiss", json={"ids": [1]}).status_code == 403  # CSRF


def test_extend_hold_endpoint(rows, admin):
    bid = rows["hold_past"]["id"]
    new_hold = rows["today"] + timedelta(days=4)
    assert admin.post(f"/api/v1/work/holds/{bid}/extend", json={}, headers=CSRF).status_code == 422
    assert admin.post(f"/api/v1/work/holds/{bid}/extend", json={"hold_expires_on": "nope"}, headers=CSRF).status_code == 422
    assert admin.post(f"/api/v1/work/holds/{bid}/extend", json={"hold_expires_on": "2020-01-01"}, headers=CSRF).status_code == 422
    assert admin.post(f"/api/v1/work/holds/{bid}/extend", json={"hold_expires_on": "2099-01-01"}, headers=CSRF).status_code == 422
    assert admin.post("/api/v1/work/holds/999999999/extend", json={"hold_expires_on": new_hold.isoformat()}, headers=CSRF).status_code == 404
    confirmed = rows["arrival_today"]["id"]
    assert admin.post(f"/api/v1/work/holds/{confirmed}/extend", json={"hold_expires_on": new_hold.isoformat()}, headers=CSRF).status_code == 409

    res = admin.post(f"/api/v1/work/holds/{bid}/extend", json={"hold_expires_on": new_hold.isoformat()}, headers=CSRF)
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["booking"]["hold_expires_on"] == new_hold.isoformat()
    lapse = reminder_rows(bid)["lapse"]
    assert lapse["due_on"] == new_hold and lapse["status"] == "due" and lapse["stale"] == 0
    assert f"hold:{bid}" not in ids(work.snapshot()["views"]["holds"])  # beyond the 3-day window now
    assert query_one("SELECT 1 AS one FROM booking_events WHERE booking_id = %s AND kind = 'updated'", (bid,))


def test_preferences_endpoint(admin, manager):
    res = manager.put("/api/v1/users/me/preferences", json={"theme": " Sand ", "mode": "dark"}, headers=CSRF)
    assert res.status_code == 200
    assert res.get_json()["user"]["preferences"] == {"theme": "sand", "mode": "dark", "text_size": "large"}
    res = manager.put("/api/v1/users/me/preferences", json={"text_size": "xlarge"}, headers=CSRF)
    assert res.get_json()["user"]["preferences"] == {"theme": "sand", "mode": "dark", "text_size": "xlarge"}
    res = manager.put("/api/v1/users/me/preferences", json={"theme": "no spaces", "mode": "blue", "text_size": "huge"}, headers=CSRF)
    assert res.status_code == 422 and set(res.get_json()["error"]["fields"]) == {"theme", "mode", "text_size"}
    assert manager.put("/api/v1/users/me/preferences", json={}, headers=CSRF).status_code == 422
    assert manager.put("/api/v1/users/me/preferences", json={"theme": "x" * 33}, headers=CSRF).status_code == 422
    assert manager.put("/api/v1/users/me/preferences", json={"theme": "sand"}).status_code == 403  # CSRF
    res = admin.put("/api/v1/users/me/preferences", json={"theme": "graphite"}, headers=CSRF)
    assert res.status_code == 200 and res.get_json()["user"]["preferences"]["mode"] == "system"
    session = admin.get("/api/v1/auth/session").get_json()
    assert session["user"]["preferences"]["theme"] == "graphite"
