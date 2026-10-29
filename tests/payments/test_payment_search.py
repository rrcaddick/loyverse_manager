"""Pure checks on the booking-side payment search (no database)."""

from __future__ import annotations

import copy
from decimal import Decimal

from src.services import booking as bs
from src.services import payment_search as ps
from src.services.settings import DEFAULTS, Settings


def _pending_booking() -> dict:
    return {"id": 1, "price_per_person": "82.00", "people_booked": 50, "deposit_due": "4000.00", "deposit_waived": False, "arrived_count": None}


def test_expected_amounts_reads_the_finance_keys(monkeypatch):
    """Deposit, balance and total all come through: the cap in search() is the
    balance plus the leeway, so a missing balance once hid every credit over R1 000."""
    monkeypatch.setattr(bs, "get_settings", lambda: Settings(copy.deepcopy(DEFAULTS)))
    monkeypatch.setattr(bs.payment_model, "sum_for_booking", lambda _id: Decimal("0"))
    fin = bs.booking_finance(_pending_booking())
    assert {"deposit_outstanding", "deposit_due", "balance_due", "total_amount"} <= set(fin)
    assert ps.expected_amounts(_pending_booking()) == {"deposit": Decimal("4000.00"), "balance": Decimal("4100.00"), "total": Decimal("4100.00")}


def test_expected_amounts_after_the_deposit(monkeypatch):
    """The deposit stays as a hint once paid (deposit_due); the balance follows the money."""
    monkeypatch.setattr(bs, "get_settings", lambda: Settings(copy.deepcopy(DEFAULTS)))
    monkeypatch.setattr(bs.payment_model, "sum_for_booking", lambda _id: Decimal("4000"))
    assert ps.expected_amounts(_pending_booking()) == {"deposit": Decimal("4000.00"), "balance": Decimal("100.00"), "total": Decimal("4100.00")}
