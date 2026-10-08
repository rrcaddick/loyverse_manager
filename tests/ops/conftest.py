"""Shared fixtures for the ops agent's tests.

Pure tests build a Settings object from the defaults. Database tests use the
local MySQL from .env and skip cleanly when it is not reachable; every row
they create has a group_name starting with "TEST " and is removed afterwards.
"""

from __future__ import annotations

import copy
from datetime import date

import pytest

from src.services.settings import DEFAULTS, Settings

TODAY = date(2026, 10, 8)  # a Thursday; season opens Sat 2026-10-31


@pytest.fixture
def settings() -> Settings:
    return Settings(copy.deepcopy(DEFAULTS))


@pytest.fixture(scope="session")
def db():
    try:
        from src.models.base import query

        query("SELECT 1")
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"MySQL not reachable: {exc}")
    yield True


def delete_test_bookings() -> None:
    from src.models.base import execute, query

    ids = [r["id"] for r in query("SELECT id FROM bookings WHERE group_name LIKE 'TEST %%'")]
    if ids:
        marks = ",".join(["%s"] * len(ids))
        execute(f"DELETE FROM form_submissions WHERE booking_id IN ({marks})", ids)
        execute(f"DELETE FROM email_messages WHERE booking_id IN ({marks})", ids)
        execute(f"DELETE FROM bookings WHERE id IN ({marks})", ids)
