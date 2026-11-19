"""Fixtures for the documents agent's tests.

Rendering tests need no database: settings come from the typed defaults and
the booking is the service's sample. Tests that touch MySQL are marked ``db``
and skip themselves when the database is unreachable.
"""

from __future__ import annotations

import copy
from pathlib import Path

import pytest

from config.settings import DATA_DIR
from src.services import documents as documents_service
from src.services.settings import DEFAULTS, Settings

PREVIEW_DIR = Path(DATA_DIR) / "documents" / "preview"


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings({k: copy.deepcopy(v) for k, v in DEFAULTS.items()})


@pytest.fixture
def booking() -> dict:
    return documents_service.sample_booking()


@pytest.fixture
def payments() -> list[dict]:
    return documents_service.sample_payments()


@pytest.fixture(scope="session")
def preview_dir() -> Path:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    return PREVIEW_DIR


@pytest.fixture(scope="session")
def db_available() -> bool:
    try:
        from src.models.base import query_one

        query_one("SELECT 1 AS ok")
        return True
    except Exception:  # noqa: BLE001 - any connection problem means "skip"
        return False


@pytest.fixture
def require_db(db_available: bool):
    if not db_available:
        pytest.skip("MySQL not reachable")
