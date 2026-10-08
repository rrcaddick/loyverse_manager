"""Fixtures for the payments agent's tests.

Client and matching-rule tests need no database or network. Tests that touch
MySQL use ``require_db`` and skip when it is unreachable; every row they create
has a group_name starting with "TEST " (or a fingerprint starting with
"test-") and is deleted afterwards.
"""

from __future__ import annotations

import json
import secrets
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"

# Five-digit doc numbers (the reference regex takes 3-5 digits), far above the real counter.
TEST_DOC_BASE = 90000


def load_fixture(name: str):
    with open(FIXTURES / name, encoding="utf-8") as fh:
        return json.load(fh)


def entries_of(name: str) -> list[dict]:
    """The raw entry list from either fixture shape (captured response or bare list)."""
    data = load_fixture(name)
    if isinstance(data, list):
        return data
    return data["body"].get("entry") or []


@pytest.fixture
def fixture():
    return load_fixture


@pytest.fixture
def entries():
    return entries_of


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


class TestData:
    """Creates TEST bookings and bank transactions directly in SQL and removes them."""

    def __init__(self):
        self.booking_ids: list[int] = []
        self.tx_ids: list[int] = []
        self.user_ids: list[int] = []
        self._doc = TEST_DOC_BASE + secrets.randbelow(9000)

    def booking(
        self,
        *,
        group_name: str = "TEST Pytest Primary School",
        contact_name: str = "Thandi Test",
        status: str = "proforma_sent",
        visit_date: date | None = None,
        people: int = 50,
        price: Decimal | str = "70.00",
        deposit: Decimal | str | None = None,
        deposit_waived: bool = False,
        doc_number: int | None = None,
    ) -> dict:
        from src.models.base import execute, query_one

        self._doc += 1
        doc = doc_number if doc_number is not None else self._doc
        visit_date = visit_date or (date.today() + timedelta(days=30))
        price_d = Decimal(str(price))
        deposit_d = Decimal(str(deposit)) if deposit is not None else (price_d * 40)
        barcode = "TST" + "".join(str(secrets.randbelow(10)) for _ in range(10))
        booking_id = execute(
            """
            INSERT INTO bookings
                (reference, doc_number, status, group_name, contact_name, visit_date,
                 people_booked, price_per_person, deposit_due, deposit_waived, barcode, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'manual')
            """,
            (
                f"FY{doc}",
                doc,
                status,
                group_name if group_name.startswith("TEST ") else f"TEST {group_name}",
                contact_name,
                visit_date,
                people,
                price_d,
                deposit_d,
                int(deposit_waived),
                barcode,
            ),
        )
        self.booking_ids.append(booking_id)
        return query_one("SELECT * FROM bookings WHERE id = %s", (booking_id,))

    def transaction(
        self,
        *,
        amount: Decimal | str,
        description: str,
        end_to_end_id: str | None = None,
        credit_debit: str = "CREDIT",
        booking_date: date | None = None,
    ) -> dict:
        from src.models import bank_transaction as bank_model

        fp = "test-" + secrets.token_hex(12)
        tx_id, created = bank_model.upsert_by_fingerprint(
            {
                "fingerprint": fp,
                "account_number": "00000000000",
                "entry_id": "20260101000001",
                "booking_date": booking_date or date.today(),
                "value_date": booking_date or date.today(),
                "description": description,
                "end_to_end_id": end_to_end_id,
                "amount": Decimal(str(amount)),
                "credit_debit": credit_debit,
                "balance_after": None,
                "raw": None,
            }
        )
        assert created
        self.tx_ids.append(tx_id)
        return bank_model.get(tx_id)

    def admin_user(self) -> dict:
        from src.models.base import execute, query_one

        email = f"test-payments-{secrets.token_hex(4)}@example.test"
        user_id = execute(
            """
            INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
            VALUES (%s, 'TEST Payments Admin', 'admin', 'x', 0, 1)
            """,
            (email,),
        )
        self.user_ids.append(user_id)
        return query_one("SELECT * FROM users WHERE id = %s", (user_id,))

    def cleanup(self) -> None:
        from src.models.base import execute

        for tx_id in self.tx_ids:
            execute("DELETE FROM payments WHERE bank_transaction_id = %s", (tx_id,))
        for booking_id in self.booking_ids:  # cascades payments and events
            execute("DELETE FROM bookings WHERE id = %s", (booking_id,))
        for tx_id in self.tx_ids:
            execute("DELETE FROM bank_transactions WHERE id = %s", (tx_id,))
        for user_id in self.user_ids:
            execute("DELETE FROM users WHERE id = %s", (user_id,))


@pytest.fixture
def data(require_db):
    td = TestData()
    yield td
    td.cleanup()
