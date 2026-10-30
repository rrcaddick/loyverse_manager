"""Arrivals come from the terminal tables; the Loyverse API is never called."""

from datetime import date

import pytest

from src.services import arrivals

BARCODE = "2004161372592"


class FakeService:
    def __init__(self, heads_today=0, heads_converted=0, fail=False):
        self.heads_today = heads_today
        self.heads_converted = heads_converted
        self.fail = fail
        self.calls = []

    def status(self, barcode, group_name=None, day=None):
        self.calls.append((barcode, group_name, day))
        if self.fail:
            raise RuntimeError("table missing")
        return {"heads_today": self.heads_today, "heads_converted": self.heads_converted}


@pytest.fixture
def service(monkeypatch):
    svc = FakeService()
    monkeypatch.setattr(arrivals, "_service", lambda: svc)
    return svc


def booking(**over):
    row = {"id": 7, "reference": "FY1", "barcode": BARCODE, "group_name": "TEST School", "visit_date": date(2026, 11, 13), "status": "confirmed", "arrived_count": None}
    row.update(over)
    return row


def test_sums_ticket_sales_and_conversions_on_the_visit_date(service):
    service.heads_today, service.heads_converted = 48, 6
    assert arrivals.arrivals_from_terminals(booking()) == 54
    assert service.calls == [(BARCODE, "TEST School", date(2026, 11, 13))]


def test_a_failure_in_the_terminal_tables_is_an_arrivals_error(service):
    service.fail = True
    with pytest.raises(arrivals.ArrivalsError):
        arrivals.arrivals_from_terminals(booking())


def test_refresh_records_only_a_change(service, monkeypatch):
    recorded = []
    monkeypatch.setattr("src.services.booking.record_arrivals", lambda bid, count, source, actor: recorded.append((bid, count, source)))
    # nothing yet stays nothing: a zero is not written
    assert arrivals.refresh_booking(booking()) is None and recorded == []
    service.heads_today = 20
    row = booking()
    assert arrivals.refresh_booking(row) == 20
    assert recorded == [(7, 20, "loyverse")] and row["arrived_count"] == 20
    # the same count again is not written again
    assert arrivals.refresh_booking(booking(arrived_count=20)) == 20 and len(recorded) == 1
    # more cars: written
    service.heads_today = 32
    assert arrivals.refresh_booking(booking(arrived_count=20)) == 32 and recorded[-1] == (7, 32, "loyverse")


def test_refresh_rows_only_touches_todays_firm_bookings(service, monkeypatch):
    recorded = []
    monkeypatch.setattr("src.services.booking.record_arrivals", lambda bid, count, source, actor: recorded.append((bid, count)))
    service.heads_today = 10
    today = date(2026, 11, 13)
    rows = [booking(id=1), booking(id=2, visit_date=date(2026, 11, 14)), booking(id=3, status="proforma_sent"), booking(id=4, arrived_count=10)]
    assert arrivals.refresh_rows(rows, today) == 1
    assert recorded == [(1, 10)]


def test_refresh_rows_survives_a_broken_table(service, monkeypatch):
    monkeypatch.setattr("src.services.booking.record_arrivals", lambda *a: None)
    service.fail = True
    assert arrivals.refresh_rows([booking()], date(2026, 11, 13)) == 0


def test_barcodes_in_receipt_skips_voided_lines():
    receipt = {"items": [{"sku": BARCODE, "quantity": 20}, {"sku": "", "name": "Public"}, {"sku": "9999", "voided": True}]}
    assert arrivals.barcodes_in_receipt(receipt) == [BARCODE]
    assert arrivals.barcodes_in_receipt(None) == []
