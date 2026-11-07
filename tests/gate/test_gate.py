"""The Gate snapshot: log parsing is pure; the API test needs MySQL."""

from __future__ import annotations

import pytest

from src.services import gate

ROWS = [
    ["2026-10-07 06:01:00", "add_inventory", "INFO", "Starting inventory update process"],
    ["2026-10-07 06:01:30", "add_inventory", "ERROR", "Error: RuntimeError: Quicket down"],
    ["2026-10-07 18:00:00", "clear_inventory", "INFO", "Starting inventory clearing process"],
    ["2026-10-07 18:00:05", "clear_inventory", "INFO", "Inventory levels reset successfully"],
    ["2026-10-08 06:01:00", "add_inventory", "INFO", "Starting inventory update process"],
    ["2026-10-08 06:01:02", "bank", "INFO", "Bank poll #1 window ..."],
    ["2026-10-08 06:03:10", "add_inventory", "INFO", "Successfully processed 12 items (10 online tickets, 2 groups)"],
]


def test_last_run_picks_the_latest_start_and_its_outcome():
    add = gate.last_run("add_inventory", ROWS)
    assert add == {
        "last_run_at": "2026-10-08T06:01:00",
        "finished_at": "2026-10-08T06:03:10",
        "status": "success",
        "summary": "Successfully processed 12 items (10 online tickets, 2 groups)",
    }
    clear = gate.last_run("clear_inventory", ROWS)
    assert clear["status"] == "success" and clear["last_run_at"] == "2026-10-07T18:00:00"
    assert gate.last_run("add_inventory", ROWS[:2])["status"] == "failed"
    assert gate.last_run("add_inventory", ROWS[:5])["status"] == "running"
    assert gate.last_run("add_inventory", [])["status"] is None
    no_event = ROWS[:5] + [["2026-10-08 06:01:05", "add_inventory", "INFO", "No Quicket event scheduled for today"]]
    assert gate.last_run("add_inventory", no_event)["status"] == "no_event"


def test_sync_status_reads_env(monkeypatch):
    monkeypatch.setenv("COMPOSE_PROFILES", "scheduled")
    monkeypatch.setenv("ADD_INVENTORY_CRON", "5 6 * * *")
    s = gate.sync_status(ROWS)
    assert s["scheduled"] is True and s["cron"] == "5 6 * * *" and s["status"] == "success"
    assert s["clear_inventory"]["status"] == "success" and s["log_rows_scanned"] == len(ROWS)
    monkeypatch.delenv("COMPOSE_PROFILES")
    assert gate.sync_status([])["scheduled"] is False and gate.sync_status([])["status"] is None


def test_tail_rows_skips_header(tmp_path):
    log = tmp_path / "log.csv"
    log.write_text('timestamp,name,level,message\n2026-10-08 06:01:00,add_inventory,INFO,"Starting inventory update process"\n')
    rows = gate._tail_rows(log, 10)
    assert rows == [["2026-10-08 06:01:00", "add_inventory", "INFO", "Starting inventory update process"]]
    assert gate._tail_rows(tmp_path / "missing.csv") == []


# ------------------------------------------------------------------ DB ---

try:
    from src.models.base import query_one

    query_one("SELECT 1 AS ok")
    DB_OK = True
except Exception:  # noqa: BLE001
    DB_OK = False


@pytest.mark.skipif(not DB_OK, reason="MySQL not reachable")
@pytest.mark.parametrize("role", ["admin", "manager"])
def test_gate_endpoint_for_both_roles(role):
    from src.models.base import execute
    from web.api import SESSION_CSRF_KEY, SESSION_USER_KEY
    from web.app import create_app

    email = f"test-gate-{role}@example.test"
    execute("DELETE FROM users WHERE email = %s", (email,))
    user_id = execute(
        "INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active) "
        "VALUES (%s, 'TEST gate user', %s, 'x', 0, 1)",
        (email, role),
    )
    try:
        app = create_app()
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        with app.test_client() as c:
            with c.session_transaction() as sess:
                sess[SESSION_USER_KEY] = user_id
                sess[SESSION_CSRF_KEY] = "test-csrf"
            r = c.get("/api/v1/gate")
            assert r.status_code == 200, r.get_json()
            body = r.get_json()
            assert set(body) == {"date", "arrivals", "open_tickets", "sync"}
            assert {"totals", "bookings", "is_closed"} <= set(body["arrivals"])
            assert {"groups", "expected_people", "arrived_people", "arrived_groups"} <= set(body["arrivals"]["totals"])
            assert isinstance(body["open_tickets"], list)
            assert {"scheduled", "cron", "last_run_at", "status", "clear_inventory"} <= set(body["sync"])
            r = c.get("/api/v1/gate?date=2026-11-07")
            assert r.status_code == 200 and r.get_json()["date"] == "2026-11-07"
            assert c.get("/api/v1/gate?date=nope").status_code == 422
    finally:
        execute("DELETE FROM users WHERE id = %s", (user_id,))
