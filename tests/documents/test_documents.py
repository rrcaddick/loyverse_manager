"""Finance documents: money rules, every kind renders, and renders fast."""

from __future__ import annotations

import time
from decimal import Decimal

import pytest

from src.services import documents as d

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")


def _plain(text: str) -> str:
    """Normal spaces for the NBSP/thin-space thousands separators."""
    return text.replace("\u00a0", " ").replace("\u202f", " ")


def _pdf_text(pdf: bytes) -> str:
    import pymupdf

    doc = pymupdf.open(stream=pdf, filetype="pdf")
    return _plain("\n".join(page.get_text() for page in doc)), len(doc)


def test_money_formatting():
    assert d.money(Decimal("6365")) == "R6 365.00"
    assert d.money(Decimal("830.217")) == "R830.22"
    assert d.money(Decimal("-100.5")) == "−R100.50"
    assert d.money(None) == "R0.00"
    assert d.money(1234567.891) == "R1 234 567.89"


def test_date_and_phone_formatting():
    assert d.date_long("2026-11-07") == "Saturday 7 November 2026"
    assert d.date_medium("2026-11-07") == "7 November 2026"
    assert d.phone_display("27821234567") == "082 123 4567"
    assert d.phone_display("0821234567") == "082 123 4567"
    assert d.phone_display(None) == ""


def test_finance_matches_reference_figures(settings, booking):
    """67 visitors at R95 inclusive: the figures on the hand-made 1726 documents."""
    f = d.compute_finance(booking, "proforma", settings, [])
    assert f["total"] == Decimal("6365.00")
    assert f["vat"] == Decimal("830.22")
    assert f["subtotal"] == Decimal("5534.78")
    assert f["unit_ex_vat"] == Decimal("82.61")
    assert f["unit_vat"] == Decimal("12.39")
    assert f["paid"] == 0
    assert f["due"] == Decimal("6365.00")
    assert f["deposit_due"] == Decimal("3800.00")
    assert f["deposit_outstanding"] == Decimal("3800.00")
    assert f["balance_on_day"] == Decimal("2565.00")


def test_finance_after_deposit_and_final(settings, booking, payments):
    inv = d.compute_finance(booking, "invoice", settings, payments)
    assert inv["paid"] == Decimal("3800.00")
    assert inv["due"] == Decimal("2565.00")
    assert inv["deposit_outstanding"] == 0
    assert inv["balance_on_day"] == Decimal("2565.00")

    fin = d.compute_finance(booking, "final_invoice", settings, payments)
    assert fin["uses_arrivals"] and fin["qty"] == 61
    assert fin["total"] == Decimal("5795.00")
    assert fin["due"] == Decimal("1995.00")


def test_finance_without_arrivals_falls_back_to_booked(settings, booking):
    booking["arrived_count"] = None
    fin = d.compute_finance(booking, "final_invoice", settings, [])
    assert not fin["uses_arrivals"] and fin["qty"] == 67


def test_finance_deposit_waived(settings, booking):
    booking["deposit_waived"] = 1
    f = d.compute_finance(booking, "proforma", settings, [])
    assert f["deposit_due"] == 0 and f["deposit_waived"]
    assert f["balance_on_day"] == Decimal("6365.00")


def test_document_numbers(settings, booking):
    assert d.document_number(booking, "proforma", settings) == "FY1703"
    assert d.document_number(booking, "invoice", settings) == "FY1703-S"  # the deposit statement
    assert d.document_number(booking, "final_invoice", settings) == "INV1703"  # the only tax invoice
    booking["doc_number"] = None
    booking["reference"] = "LEG0004"
    assert d.document_number(booking, "proforma", settings) == "LEG0004"
    assert d.document_number(booking, "invoice", settings) == "LEG0004-S"
    with pytest.raises(d.DocumentError):
        d.document_number(booking, "receipt", settings)


def test_labels_titles_and_filenames():
    assert d.KIND_LABELS == {"proforma": "Proforma", "invoice": "Statement", "final_invoice": "Tax invoice"}
    assert d.KIND_TITLES == {"proforma": "Proforma invoice", "invoice": "Statement of account", "final_invoice": "Tax invoice"}
    assert d.document_filename({"number": "FY1703", "kind": "proforma"}) == "FY1703 Proforma.pdf"
    assert d.document_filename({"number": "FY1703-S", "kind": "invoice"}) == "FY1703-S Statement.pdf"
    assert d.document_filename({"number": "INV1703", "kind": "final_invoice"}) == "INV1703 Tax invoice.pdf"
    assert _plain(d.money_short(3800)) == "R3 800" and _plain(d.money_short("3800.50")) == "R3 800.50"
    assert d.date_day_month("2026-11-07") == "7 Nov" and d.date_weekday_short("2026-11-07") == "Sat 7 Nov"


COMMON = [
    "Hillside Community Church", "Thandi Mokoena", "Saturday 7 November 2026", "4780 308 575",
    # the supply, the line as an equation and the VAT it includes
    "Group day admission, Saturday 7 November 2026", "R95.00", "Includes VAT 15 %",
    # billing address and customer VAT number under Bill to
    "14 Protea Avenue", "Kuils River", "7580", "VAT 4123456789",
]


@pytest.mark.parametrize(
    "kind, with_payments, expected, absent",
    [
        (
            "proforma", False,
            ["Proforma invoice", "FY1703", "67 × R95.00 = R6 365.00", "R830.22", "Deposit due", "R3 800.00", "Balance due on the day", "R2 565.00",
             "not a tax invoice", "VAT may not be claimed on this document", "Payment reference", "62871182764"],
            ["Booking ref", "INV1703"],
        ),
        (
            "invoice", True,
            ["Statement of account", "Deposit receipt and statement", "FY1703-S", "R830.22", "Booking ref", "Payments received", "R3 800.00",
             "Paid to date", "Balance due on the day", "R2 565.00", "This is not a tax invoice", "Payment reference", "62871182764"],
            ["INV1703"],
        ),
        (
            "final_invoice", True,
            ["Tax invoice", "INV1703", "Booking ref", "FY1703", "61 visitors", "67 booked", "61 × R95.00 = R5 795.00", "R755.87",
             "Balance due at the gate", "R1 995.00", "Payment reference", "62871182764"],
            ["Final tax invoice", "not a tax invoice", "Statement"],
        ),
    ],
)
def test_each_kind_renders_one_page(settings, booking, payments, preview_dir, kind, with_payments, expected, absent):
    pdf = d.render_document_pdf(booking, kind, settings, payments if with_payments else [])
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 20_000
    text, pages = _pdf_text(pdf)
    assert pages == 1
    import re

    lowered = re.sub(r"\s+", " ", text.lower())  # headings are uppercased by CSS; notes wrap
    for needle in expected + COMMON:
        assert needle.lower() in lowered, f"{needle!r} missing from {kind}"
    for needle in absent:
        assert needle.lower() not in lowered, f"{needle!r} should not be on the {kind}"
    # The contact's phone and email are no longer printed.
    assert "082 123 4567" not in text and "thandi.mokoena@example.org" not in text
    (preview_dir / f"{kind}.pdf").write_bytes(pdf)


def test_bill_to_falls_back_to_area_without_billing_details(settings, booking):
    booking["billing_address"] = None
    booking["customer_vat_number"] = ""
    html = d.render_document_html(booking, "proforma", settings)
    assert "Kuils River" in html and "14 Protea Avenue" not in html and "VAT 4123456789" not in html


def test_paid_final_invoice_has_no_bank_box(settings, booking, preview_dir):
    pays = [{"id": 1, "kind": "eft", "amount": Decimal("5795.00"), "paid_on": "2026-10-02", "reference": "FY1703"}]
    html = d.render_document_html(booking, "final_invoice", settings, pays)
    assert 'class="pay"' not in html and "Paid in full" in html and "62871182764" not in html
    assert 'class="terms full"' in html
    text, pages = _pdf_text(d.render_document_pdf(booking, "final_invoice", settings, pays))
    assert pages == 1 and "Paid in full" in text and "Payment reference" not in text
    # Still owed: the bank box is back.
    html = d.render_document_html(booking, "final_invoice", settings, [])
    assert 'class="pay"' in html and "62871182764" in html


def test_context_flags(settings, booking, payments):
    ctx = d.build_document_context(booking, "invoice", settings, payments)
    assert ctx["doc"]["show_booking_ref"] is True and ctx["doc"]["show_bank_box"] is True
    assert ctx["doc"]["description"] == "Deposit receipt and statement" and ctx["doc"]["is_tax_invoice"] is False
    assert _plain(ctx["lines"][0]["equation"]) == "67 × R95.00 = R6 365.00"
    assert ctx["booking"]["billing_address_lines"] == ["Hillside Community Church", "14 Protea Avenue", "Kuils River", "7580"]
    ctx = d.build_document_context(booking, "proforma", settings)
    assert ctx["doc"]["show_booking_ref"] is False
    ctx = d.build_document_context(booking, "final_invoice", settings, payments)
    assert ctx["doc"]["is_tax_invoice"] is True and ctx["doc"]["show_booking_ref"] is True


def test_final_invoice_three_payments_still_one_page(settings, booking, payments):
    more = payments + [
        {**payments[0], "id": 1, "amount": Decimal("1000.00"), "paid_on": "2026-10-20", "reference": "FY1703 2ND"},
        {**payments[0], "id": 2, "amount": Decimal("500.00"), "paid_on": "2026-11-07", "reference": None, "kind": "card", "note": "Gate card"},
    ]
    _, pages = _pdf_text(d.render_document_pdf(booking, "final_invoice", settings, more))
    assert pages == 1


def test_overpaid_final_invoice_shows_credit(settings, booking):
    pays = [{"id": 1, "kind": "eft", "amount": Decimal("6365.00"), "paid_on": "2026-10-02", "reference": "FY1703"}]
    text, _ = _pdf_text(d.render_document_pdf(booking, "final_invoice", settings, pays))
    assert "Credit due to you" in text and "R570.00" in text


def test_render_is_fast(settings, booking, payments):
    d.render_document_pdf(booking, "invoice", settings, payments)  # warm the font cache
    start = time.perf_counter()
    d.render_document_pdf(booking, "invoice", settings, payments)
    assert time.perf_counter() - start < 2.0


def test_html_embeds_font_and_logo_as_file_urls(settings, booking):
    html = d.render_document_html(booking, "proforma", settings)
    assert "file://" in html and "InterVariable.ttf" in html and "logo.svg" in html
