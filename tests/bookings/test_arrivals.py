"""Loyverse arrivals counting (pure parts; the API call itself is not exercised)."""

from datetime import date

import pytest

from src.services import arrivals
from src.services.arrivals import ArrivalsError, count_arrivals, sast_day_bounds_utc

BARCODE = "2009864589605"


def receipt(lines, receipt_type="SALE"):
    return {"receipt_type": receipt_type, "line_items": lines}


def line(quantity, sku=None, item_name="Something else"):
    return {"quantity": quantity, "sku": sku, "item_name": item_name}


def test_day_bounds_are_the_sast_day_in_utc():
    start, end = sast_day_bounds_utc(date(2026, 11, 13))
    assert start == "2026-11-12T22:00:00.000Z"
    assert end == "2026-11-13T21:59:59.000Z"


def test_sums_quantities_for_the_barcode_sku():
    receipts = [
        receipt([line(12, sku=BARCODE), line(3, sku="other")]),
        receipt([line(8.0, sku=BARCODE)]),
    ]
    assert count_arrivals(receipts, BARCODE, "TEST School") == 20


def test_refunds_subtract():
    receipts = [
        receipt([line(12, sku=BARCODE)]),
        receipt([line(2, sku=BARCODE)], receipt_type="REFUND"),
    ]
    assert count_arrivals(receipts, BARCODE, "TEST School") == 10


def test_falls_back_to_item_name_when_no_sku_matches():
    receipts = [
        receipt([line(7, sku=None, item_name="test school")]),
        receipt([line(5, sku=None, item_name="TEST School ")]),
        receipt([line(99, sku=None, item_name="Visitor")]),
    ]
    assert count_arrivals(receipts, BARCODE, "TEST School") == 12


def test_sku_match_takes_precedence_over_name_match():
    receipts = [
        receipt([line(4, sku=BARCODE, item_name="TEST School")]),
        receipt([line(50, sku=None, item_name="TEST School")]),
    ]
    assert count_arrivals(receipts, BARCODE, "TEST School") == 4


def test_nothing_matched_is_zero_never_negative():
    assert count_arrivals([], BARCODE, "TEST School") == 0
    refunds_only = [receipt([line(3, sku=BARCODE)], receipt_type="REFUND")]
    assert count_arrivals(refunds_only, BARCODE, "TEST School") == 0


def test_missing_api_key_raises(monkeypatch):
    monkeypatch.setattr(arrivals, "LOYVERSE_API_KEY", None)
    with pytest.raises(ArrivalsError):
        arrivals.fetch_loyverse_arrivals(
            {"visit_date": date(2026, 11, 13), "barcode": BARCODE, "group_name": "x"}
        )


def test_network_failure_raises_arrivals_error(monkeypatch):
    import requests

    monkeypatch.setattr(arrivals, "LOYVERSE_API_KEY", "not-a-real-key")

    class BrokenService:
        def __init__(self, *a, **k):
            pass

        def get_receipts(self, **kwargs):
            raise requests.ConnectionError("boom")

    monkeypatch.setattr(arrivals, "LoyverseService", BrokenService)
    with pytest.raises(ArrivalsError):
        arrivals.fetch_loyverse_arrivals(
            {"visit_date": "2026-11-13", "barcode": BARCODE, "group_name": "x", "reference": "FY1"}
        )
