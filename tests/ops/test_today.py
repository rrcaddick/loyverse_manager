"""The Today service: label, tile maths, next visit day, system status."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from src.models.base import execute, query_one
from src.services import today as today_service
from tests.ops.conftest import delete_test_bookings
from tests.ops.test_work import make


def test_day_label():
    assert today_service.day_label(date(2026, 10, 8)) == "Thursday 8 October"
    assert today_service.day_label(date(2026, 1, 1)) == "Thursday 1 January"


def test_parse_log_line():
    row = today_service._parse_log_line('"2026-10-08 06:01:02,123",add_inventory,INFO,"Processed 3, done"')
    assert row["name"] == "add_inventory" and row["level"] == "INFO" and row["message"] == "Processed 3, done"
    assert row["at"] == datetime(2026, 10, 8, 6, 1, 2, 123000)
    assert today_service._parse_log_line("garbage") is None
    assert today_service._parse_log_line("") is None


@pytest.mark.parametrize(
    "lines, outcome",
    [
        (["Starting inventory update process", "Successfully processed 3 items (2 online tickets, 1 groups)"], "success"),
        (["Starting inventory update process", "No tickets or groups to process for today"], "no_event"),
        (["Starting inventory update process", "Error: RuntimeError: boom"], "failed"),
        (["Starting inventory update process"], "running"),
    ],
)
def test_loyverse_last_run_from_log(tmp_path, monkeypatch, lines, outcome):
    log = tmp_path / "inventory_updates.log"
    content = ['"2026-10-07 06:01:00,000",add_inventory,INFO,Starting inventory update process',
               '"2026-10-07 06:02:00,000",add_inventory,INFO,Successfully processed 9 items (9 online tickets, 0 groups)',
               '"2026-10-08 06:00:00,000",booking,INFO,Something else']
    for i, line in enumerate(lines):
        level = "ERROR" if line.startswith("Error") else "INFO"
        content.append(f'"2026-10-08 06:0{i}:00,000",add_inventory,{level},{line}')
    log.write_text("\n".join(content) + "\n")
    monkeypatch.setattr(today_service, "LOG_FILE", log)
    run = today_service.loyverse_last_run()
    assert run["outcome"] == outcome and run["at"] == "2026-10-08T06:00:00"


def test_loyverse_last_run_without_log(tmp_path, monkeypatch):
    monkeypatch.setattr(today_service, "LOG_FILE", tmp_path / "missing.log")
    assert today_service.loyverse_last_run() is None


def test_fresh_accepts_datetimes_and_iso_text():
    now = datetime.now(today_service.SAST).replace(tzinfo=None)
    assert today_service._fresh(now - timedelta(minutes=1), timedelta(minutes=5))
    assert today_service._fresh((now - timedelta(minutes=1)).isoformat(), timedelta(minutes=5))
    assert not today_service._fresh(now - timedelta(hours=1), timedelta(minutes=5))
    assert not today_service._fresh(None, timedelta(minutes=5))
    assert not today_service._fresh("not a date", timedelta(minutes=5))


# ------------------------------------------------------------------ DB ----


pytestmark_db = pytest.mark.usefixtures("db")


def _empty_open_saturday(start: date) -> date | None:
    from src.services import booking as booking_service

    d = start + timedelta(days=(5 - start.weekday()) % 7)
    for _ in range(26):
        day = booking_service.calendar_days(d, d)[0]
        if not day["is_closed"] and day["booking_count"] == 0:
            return d
        d += timedelta(days=7)
    return None


@pytest.fixture
def visit_day(db):
    from src.utils.date import get_today

    delete_test_bookings()
    d = _empty_open_saturday(get_today() + timedelta(days=150))
    if d is None:
        pytest.skip("No empty open Saturday to test with")
    confirmed = make("TEST Today Confirmed", d, "confirmed", people_booked=100, confirmed_at=datetime.now(),
                     ticket_emailed_at=datetime.now())
    tentative = make("TEST Today Tentative", d, "proforma_sent", people_booked=50, proforma_sent_at=datetime.now())
    make("TEST Today Cancelled", d, "cancelled", people_booked=30)
    execute(
        "INSERT INTO payments (booking_id, kind, amount, paid_on, reference) VALUES (%s, 'eft', 2000, %s, 'TEST')",
        (confirmed["id"], d),
    )
    yield {"date": d, "confirmed": confirmed, "tentative": tentative}
    delete_test_bookings()


@pytest.mark.usefixtures("db")
def test_today_tiles_maths(visit_day):
    d = visit_day["date"]
    page = today_service.today(d)
    assert page["date"] == d.isoformat() and page["label"] == today_service.day_label(d)
    assert page["is_closed"] is False and page["day_type"] == "weekend"
    assert page["tiles"]["groups"] == {"total": 2, "arrived": 0}
    assert page["tiles"]["people"] == {"total": 150, "confirmed": 100}
    # owed = (100 × 95 − 2000) + 50 × 95 ; paid = 2000
    assert page["tiles"]["owed_at_gate"] == {"total": 12250.0, "paid": 2000.0}
    assert set(page["tiles"]["needs_you"]) == {"count", "oldest_days"}
    assert [g["reference"] for g in page["groups"]] == [
        visit_day["confirmed"]["reference"], visit_day["tentative"]["reference"]
    ]
    card = page["groups"][0]
    assert set(card) == {
        "id", "reference", "group_name", "status", "people_booked", "arrived_count", "ticket_sent",
        "paid_total", "balance_due", "contact_name", "contact_mobile", "vehicles", "gazebos", "arrival_time",
    }
    assert card["ticket_sent"] is True and card["paid_total"] == 2000.0 and card["balance_due"] == 7500.0
    assert page["next_visit_day"] is None  # today has groups
    strip = page["seven_day_strip"]
    assert len(strip) == 7 and strip[0] == {
        "date": d.isoformat(), "groups": 2, "people": 150, "confirmed_people": 100, "is_closed": False
    }
    assert len(page["up_next"]) <= 5 and set(page["system"]) == {"mail", "bank", "loyverse_sync"}
    assert "work_counts" in page

    # arrivals recorded on the confirmed group: balance is now against the final amount
    execute("UPDATE bookings SET arrived_count = 80, arrived_source = 'manual' WHERE id = %s", (visit_day["confirmed"]["id"],))
    page = today_service.today(d)
    assert page["tiles"]["groups"] == {"total": 2, "arrived": 1}
    assert page["tiles"]["owed_at_gate"] == {"total": 5600.0 + 4750.0, "paid": 2000.0}

    stripped = today_service.today(d, for_manager=True)
    assert set(stripped["tiles"]) == {"groups", "people"}
    assert "up_next" not in stripped and "work_counts" not in stripped
    assert stripped["groups"][0]["balance_due"] == 5600.0  # the gate still sees per-group money


@pytest.mark.usefixtures("db")
def test_today_on_a_closed_or_empty_day_points_at_the_next_visit(visit_day):
    d = visit_day["date"]
    before = d - timedelta(days=1)  # Friday: open but empty, or closed; either way no TEST groups
    page = today_service.today(before)
    assert page["tiles"]["groups"]["total"] == 0 or page["next_visit_day"] is None
    if page["tiles"]["groups"]["total"] == 0:
        nxt = page["next_visit_day"]
        assert nxt is not None and nxt["date"] <= d.isoformat()
        if nxt["date"] == d.isoformat():
            assert nxt == {"date": d.isoformat(), "groups": 2, "people": 150}


@pytest.mark.usefixtures("db")
def test_system_status_shape():
    status = today_service.system_status()
    assert set(status) == {"mail", "bank", "loyverse_sync"}
    assert set(status["mail"]) == {"last_synced_at", "ok"}
    assert set(status["bank"]) == {"last_poll_at", "ok"}
    assert set(status["loyverse_sync"]) == {"scheduled", "last_run", "status"}
    assert status["loyverse_sync"]["status"] in {"off", "ok", "failed", "running", "unknown"}
    with_errors = today_service.system_status(with_errors=True)
    assert "last_error" in with_errors["mail"] and "last_error" in with_errors["bank"]
    assert "last_error" in with_errors["loyverse_sync"]


@pytest.mark.usefixtures("db")
def test_today_endpoint_strips_for_managers(visit_day):
    from tests.ops.test_work import _client, app as make_app  # noqa: F401

    from web.app import create_app
    import web.api.today as today_api

    app = create_app()
    app.config.update(TESTING=True)
    if today_api.bp.name not in app.blueprints:
        app.register_blueprint(today_api.bp)
    d = visit_day["date"].isoformat()
    admin, admin_id = _client(app, "admin")
    manager, manager_id = _client(app, "manager")
    try:
        res = admin.get(f"/api/v1/today?date={d}")
        assert res.status_code == 200 and "owed_at_gate" in res.get_json()["tiles"]
        res = manager.get(f"/api/v1/today?date={d}")
        assert res.status_code == 200
        body = res.get_json()
        assert "owed_at_gate" not in body["tiles"] and "up_next" not in body
        assert admin.get("/api/v1/today?date=bad").status_code == 422
        assert admin.get("/api/v1/today").status_code == 200
        assert app.test_client().get("/api/v1/today").status_code == 401
    finally:
        execute("DELETE FROM users WHERE id IN (%s, %s)", (admin_id, manager_id))
