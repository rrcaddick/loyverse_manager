"""Unit tests for the mail agent run without a database or network.

Model lookups used by the matcher are monkeypatched onto
``src.models.email_message``; nothing here opens a MySQL connection.
"""

from __future__ import annotations

import pytest

from src.models import email_message as em


class FakeBookings:
    """In-memory stand-in for the booking lookups in src.models.email_message."""

    def __init__(self, bookings: list[dict]):
        self.bookings = bookings
        self.linked_threads: dict[int, int] = {}  # thrid -> booking_id

    def by_doc_number(self, number):
        return next((b for b in self.bookings if b.get("doc_number") == number), None)

    def by_thread(self, thrid):
        bid = self.linked_threads.get(thrid)
        if bid is not None:
            return next((b for b in self.bookings if b["id"] == bid), None)
        return next((b for b in self.bookings if b.get("email_thread_id") == thrid), None)

    def by_contact_email(self, address):
        hits = [b for b in self.bookings if (b.get("contact_email") or "").lower() == address.lower()]
        hits.sort(key=lambda b: (b.get("status") not in ("cancelled", "lapsed"), b.get("visit_date")), reverse=True)
        return hits[0] if hits else None

    def by_contact_mobile(self, digits):
        return next((b for b in self.bookings if b.get("contact_mobile") == digits), None)


@pytest.fixture
def fake_bookings(monkeypatch):
    def install(bookings: list[dict]) -> FakeBookings:
        fake = FakeBookings(bookings)
        monkeypatch.setattr(em, "booking_by_doc_number", fake.by_doc_number)
        monkeypatch.setattr(em, "booking_by_thread", fake.by_thread)
        monkeypatch.setattr(em, "booking_by_contact_email", fake.by_contact_email)
        monkeypatch.setattr(em, "booking_by_contact_mobile", fake.by_contact_mobile)
        monkeypatch.setattr(em, "candidate_bookings", lambda *a, **k: list(bookings))
        return fake

    return install
