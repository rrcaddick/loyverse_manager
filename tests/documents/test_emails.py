"""Every email kind renders (HTML + text) for the sample booking."""

from __future__ import annotations

import pytest

from src.services import documents as d
from src.services.email_templates import KINDS, EmailTemplateError, RenderedEmail, render_email

LOGO = "https://bookings.farmyardpark.co.za/static/brand/logo-black-600.png"
FORM = "https://bookings.farmyardpark.co.za/request"


def _ctx(kind: str, payments: list[dict]) -> dict:
    return {
        "acknowledgement": {"form_url": FORM},
        "proforma": {"document": {"number": "FY1703", "total": 6365, "paid": 0, "due": 6365}},
        "invoice": {"payments": payments, "document": {"number": "INV1703", "total": 6365, "paid": 3800, "due": 2565}},
        "final_invoice": {"payments": payments, "document": {"number": "INV1703", "total": 5795, "paid": 3800, "due": 1995}},
        "ticket": {"payments": payments},
        "payment_confirmation": {"payments": payments, "payment": payments[0], "invoice_attached": True},
        "still_interested": {"document": {"number": "FY1703"}},
        "deposit_reminder": {"days_left": 14},
        "final_details": {"payments": payments, "days_left": 3, "ticket_attached": False},
        "expiry": {},
        "answers": {"questions": [{"question": "Can we bring a braai?", "answer": "Yes, braai facilities are available."}, {"question": "Bus parking?", "answer": None}]},
        "bounce_back": {"form_url": FORM},
        "reply": {"body_html": "<p>Hi Thandi,</p><p>Thanks for letting us know about the extra minibus.</p>"},
    }[kind]


EXPECTED = {
    "acknowledgement": ["Thanks for your booking request", "FY1703", "67 visitors"],
    "proforma": ["Deposit due", "R3 800.00", "Bank details", "62871182764", "31 October 2026"],
    "invoice": ["Your date is confirmed", "INV1703", "R2 565.00"],
    "final_invoice": ["Thank you for visiting", "61 visitors", "R1 995.00"],
    "ticket": ["driver of each vehicle", "barcode", "farmyardpark.co.za"],
    "payment_confirmation": ["R3 800.00", "2 October 2026", "confirmed"],
    "still_interested": ["Still planning to visit?", "R3 800.00"],
    "deposit_reminder": ["14 days", "R3 800.00", "31 October 2026"],
    "final_details": ["3 days", "sent earlier", "R2 565.00"],
    "expiry": ["lapsed", "no longer reserved"],
    "answers": ["Can we bring a braai?", "braai facilities", "come back to you"],
    "bounce_back": ["Request a group booking", FORM],
    "reply": ["extra minibus"],
}


@pytest.mark.parametrize("kind", KINDS)
def test_every_kind_renders(settings, booking, payments, preview_dir, kind):
    b = None if kind == "bounce_back" else booking
    r = render_email(kind, b, settings, logo_url=LOGO, **_ctx(kind, payments))
    assert isinstance(r, RenderedEmail)
    assert r.subject and r.html and r.text
    if kind != "bounce_back":
        assert "FY1703" in r.subject or "INV1703" in r.subject
        assert "Hillside Community Church" in r.subject
        assert "Saturday 7 November 2026" in r.subject
    html = r.html.replace("&nbsp;", " ")  # css_inline re-serialises NBSP as an entity
    for needle in EXPECTED[kind]:
        assert needle in html, f"{needle!r} missing from {kind} html"
    # layout and signature
    assert LOGO in r.html
    assert "Linda Caddick" in r.html and "Linda Caddick" in r.text
    assert "4780 308 575" in r.html
    assert 'style="' in r.html  # css_inline ran
    assert "@media" in r.html  # responsive block kept
    assert "[" not in r.text or kind == "reply"  # no markdown link syntax
    assert "#" not in r.text.split("\n")[0]
    (preview_dir / f"email-{kind}.html").write_text(r.html)
    (preview_dir / f"email-{kind}.txt").write_text(f"Subject: {r.subject}\n\n{r.text}")


def test_wordmark_fallback_without_logo(settings, booking):
    r = render_email("expiry", booking, settings)
    assert "<img" not in r.html
    assert "THE FARMYARD PARK" in r.html


def test_subject_override_and_reply_default(settings, booking):
    assert render_email("reply", booking, settings, subject="Re: parking", body_html="<p>x</p>").subject == "Re: parking"
    assert render_email("reply", None, settings, body_html="<p>x</p>").subject == "The Farmyard Park"


def test_unknown_kind_and_missing_booking(settings, booking):
    with pytest.raises(EmailTemplateError):
        render_email("newsletter", booking, settings)
    with pytest.raises(EmailTemplateError):
        render_email("proforma", None, settings)


def test_waived_deposit_copy(settings, booking):
    booking["deposit_waived"] = 1
    r = render_email("proforma", booking, settings)
    assert "No deposit is needed" in r.html and "Bank details" not in r.html


def test_subject_uses_document_number_when_given(settings, booking):
    r = render_email("invoice", booking, settings, document={"number": "INV1790", "total": 1, "paid": 0, "due": 1})
    assert r.subject.startswith("Invoice INV1790 – ")
