"""issue_document against MySQL on a throwaway booking (deleted afterwards)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from config.settings import DATA_DIR
from src.models import document as document_model
from src.models.base import execute, query, query_one
from src.services import documents as d

pytestmark = pytest.mark.usefixtures("require_db")


@pytest.fixture
def test_booking_id():
    bid = execute(
        """
        INSERT INTO bookings (reference, doc_number, status, group_name, area, contact_name, contact_email,
            contact_mobile, visit_date, arrival_time, adults, children, people_booked, vehicles, gazebos,
            price_tier_code, price_per_person, deposit_due, barcode, source, enquiry_date, hold_expires_on)
        VALUES ('TST9902', 9902, 'enquiry', 'TEST documents pytest', 'Kuils River', 'Thandi Mokoena',
            'thandi@example.org', '27821234567', '2026-11-07', '10:00', 40, 27, 67, 3, 1, 'church_weekend',
            95.00, 3800.00, 'TEST9902000001', 'manual', '2026-09-29', '2026-10-31')
        """
    )
    try:
        yield bid
    finally:
        execute("DELETE FROM bookings WHERE id = %s", (bid,))
        shutil.rmtree(Path(DATA_DIR) / "documents" / str(bid), ignore_errors=True)
        assert query_one("SELECT COUNT(*) AS n FROM documents WHERE booking_id = %s", (bid,))["n"] == 0


def test_issue_versions_events_and_bytes(test_booking_id):
    bid = test_booking_id
    p1 = d.issue_document(bid, "proforma", actor=None)
    assert (p1["number"], p1["version"], p1["file_path"]) == ("FY9902", 1, f"documents/{bid}/FY9902-v1.pdf")
    assert p1["total"] == 6365.0 and p1["paid"] == 0.0 and p1["due"] == 6365.0
    assert p1["filename"] == "FY9902 Proforma.pdf"
    p2 = d.issue_document(bid, "proforma", actor=None)
    assert p2["version"] == 2

    execute("INSERT INTO payments (booking_id, kind, amount, paid_on, reference) VALUES (%s, 'eft', 3800, '2026-10-02', 'TST9902')", (bid,))
    inv = d.issue_document(bid, "invoice", actor=None)
    assert (inv["number"], inv["version"], inv["paid"], inv["due"]) == ("INV9902", 1, 3800.0, 2565.0)

    execute("UPDATE bookings SET arrived_count = 61, arrived_source = 'manual' WHERE id = %s", (bid,))
    fin = d.issue_document(bid, "final_invoice", actor=None)
    # Shares the invoice number, so it is v2 of INV9902 and the file name stays unique.
    assert (fin["number"], fin["version"], fin["total"], fin["due"]) == ("INV9902", 2, 5795.0, 1995.0)

    listed = d.list_documents(bid)
    assert [(x["kind"], x["version"]) for x in listed] == [("final_invoice", 2), ("invoice", 1), ("proforma", 2), ("proforma", 1)]
    assert document_model.latest(bid, "proforma")["version"] == 2
    assert document_model.latest(bid, "invoice")["version"] == 1

    filename, data = d.document_bytes(fin["id"])
    assert filename == "INV9902 Final invoice.pdf" and data.startswith(b"%PDF")

    events = query("SELECT kind, summary FROM booking_events WHERE booking_id = %s ORDER BY id", (bid,))
    assert [e["summary"] for e in events] == [
        "Proforma FY9902 issued (v1)",
        "Proforma FY9902 issued (v2)",
        "Invoice INV9902 issued (v1)",
        "Final invoice INV9902 issued (v2)",
    ]
    assert all(e["kind"] == "document_issued" for e in events)

    snap = d.get_document(fin["id"], with_snapshot=True)["snapshot"]
    assert snap["totals"]["total"] == 5795.0 and snap["lines"][0]["qty"] == 61 and len(snap["payments"]) == 1

    assert d.preview_document(bid, "proforma").startswith(b"%PDF")
    assert document_model.latest_version_for_number(bid, "FY9902") == 2  # preview did not issue


def test_issue_unknown_booking_or_kind():
    with pytest.raises(d.DocumentError):
        d.issue_document(999_999_999, "proforma", actor=None)
    with pytest.raises(d.DocumentError):
        d.issue_document(1, "receipt", actor=None)
    with pytest.raises(d.DocumentError):
        d.document_bytes(999_999_999)
