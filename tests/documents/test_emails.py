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
        "invoice": {"payments": payments, "document": {"number": "FY1703-S", "total": 6365, "paid": 3800, "due": 2565}},
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
    "acknowledgement": ["Thanks for your booking request", "FY1703", "67 visitors", "Nothing is paid now"],
    "proforma": ["Deposit due", "R3 800.00", "Bank details", "62871182764", "31 October 2026", "<ol", "Attached:</span> FY1703 Proforma.pdf"],
    "invoice": ["Your date is confirmed", "FY1703-S", "R2 565.00", "deposit receipt and statement", "Attached:</span> FY1703-S Statement.pdf"],
    "final_invoice": ["Thank you for visiting", "61 visitors", "R1 995.00", "Tax invoice INV1703", "Attached:</span> INV1703 Tax invoice.pdf"],
    "ticket": ["driver of each vehicle", "barcode", "farmyardpark.co.za", "Attached:</span> Vehicle ticket FY1703.pdf"],
    "payment_confirmation": ["R3 800.00", "2 October 2026", "confirmed", "deposit receipt and statement is attached", "Attached:</span> FY1703-S Statement.pdf"],
    "still_interested": ["Still planning to visit?", "R3 800.00", "Attached:</span> FY1703 Proforma.pdf"],
    "deposit_reminder": ["14 days", "R3 800.00", "31 October 2026", "Attached:</span> FY1703 Proforma.pdf"],
    "final_details": ["3 days", "sent earlier", "R2 565.00"],
    "expiry": ["lapsed", "no longer reserved"],
    "answers": ["Can we bring a braai?", "braai facilities", "come back to you"],
    "bounce_back": ["Request a group booking", FORM],
    "reply": ["extra minibus"],
}

# Amount-first subjects; group and date go to the preheader.
SUBJECTS = {
    "acknowledgement": "Request received FY1703 – Sat 7 Nov",
    "proforma": "Proforma FY1703 – R3 800 deposit by 31 Oct",
    "invoice": "Statement FY1703-S – R2 565 balance on 7 Nov",
    "final_invoice": "Tax invoice INV1703 – R1 995 due",
    "ticket": "Vehicle ticket FY1703 – Sat 7 Nov",
    "payment_confirmation": "Payment received: R3 800.00 – FY1703",
    "still_interested": "Still planning to visit on 7 Nov? – FY1703",
    "deposit_reminder": "Deposit R3 800 due by 31 Oct – FY1703",
    "final_details": "Your visit on Sat 7 Nov – FY1703",
    "expiry": "Booking FY1703 released – 7 Nov",
    "answers": "Your questions – FY1703",
    "bounce_back": "Group bookings at The Farmyard Park",
    "reply": "FY1703 – Hillside Community Church – Saturday 7 November 2026",
}

# The first card row is the amount (or the key figure) on every money email.
FIRST_ROW = {
    "proforma": ("Deposit due", "R3 800.00"),
    "invoice": ("Balance due on the day", "R2 565.00"),
    "final_invoice": ("Balance outstanding", "R1 995.00"),
    "payment_confirmation": ("Amount received", "R3 800.00"),
    "deposit_reminder": ("Deposit due", "R3 800.00"),
    "still_interested": ("Deposit due", "R3 800.00"),
    "final_details": ("Balance due at the gate", "R2 565.00"),
    "ticket": ("Balance due at the gate", "R2 565.00"),
}


def _plain(s: str) -> str:
    return s.replace("&nbsp;", " ").replace("\u00a0", " ").replace("\u202f", " ")


def _rows(html: str) -> list[tuple[str, str]]:
    import re

    cells = re.findall(r'<td class="row-k"[^>]*>(.*?)</td>\s*<td class="row-v[^"]*"[^>]*>(.*?)</td>', html, re.S)
    return [(re.sub(r"<[^>]+>", "", k).strip(), re.sub(r"<[^>]+>", "", v).strip()) for k, v in cells]


@pytest.mark.parametrize("kind", KINDS)
def test_every_kind_renders(settings, booking, payments, preview_dir, kind):
    b = None if kind == "bounce_back" else booking
    r = render_email(kind, b, settings, logo_url=LOGO, **_ctx(kind, payments))
    assert isinstance(r, RenderedEmail)
    assert r.subject and r.html and r.text
    assert _plain(r.subject) == SUBJECTS[kind]
    assert len(r.subject) <= 60 or kind == "reply"
    if kind not in ("bounce_back", "reply"):
        # group and date in the preheader
        assert "Hillside Community Church · Saturday 7 November 2026" in r.html
    html = _plain(r.html)  # css_inline re-serialises NBSP as an entity
    for needle in EXPECTED[kind]:
        assert needle in html, f"{needle!r} missing from {kind} html"
    if kind in FIRST_ROW:
        assert _rows(html)[0] == FIRST_ROW[kind], f"{kind}: first card row is not the amount"
    assert "max-width: 480px" in r.html  # card rows stack on narrow screens
    if kind in ("expiry", "answers", "bounce_back", "reply"):
        assert "Attached:" not in r.html
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
    r = render_email("invoice", booking, settings, document={"number": "FY1790-S", "total": 1, "paid": 0, "due": 1})
    assert r.subject.startswith("Statement FY1790-S – ")


def test_subjects_follow_the_money(settings, booking, payments):
    waived = dict(booking, deposit_waived=1)
    assert _plain(render_email("proforma", waived, settings).subject) == "Proforma FY1703 – R6 365 payable on the day"
    no_hold = dict(booking, hold_expires_on=None)
    assert _plain(render_email("proforma", no_hold, settings).subject) == "Proforma FY1703 – R3 800 deposit secures 7 Nov"
    paid = [{"id": 1, "kind": "eft", "amount": 6365, "paid_on": "2026-10-02", "reference": "FY1703"}]
    assert render_email("invoice", booking, settings, payments=paid).subject == "Statement FY1703-S – paid in full"
    assert _plain(render_email("final_invoice", booking, settings, payments=paid).subject) == "Tax invoice INV1703 – R570 credit"
    settled = [{"id": 1, "kind": "eft", "amount": 5795, "paid_on": "2026-10-02", "reference": "FY1703"}]
    assert render_email("final_invoice", booking, settings, payments=settled).subject == "Tax invoice INV1703 – paid in full"
    r = render_email("payment_confirmation", booking, settings, payments=payments, payment={"amount": "1250.5", "paid_on": "2026-10-02"})
    assert _plain(r.subject) == "Payment received: R1 250.50 – FY1703"


def test_attached_line_can_be_given_or_suppressed(settings, booking):
    r = render_email("proforma", booking, settings, attached="FY1703 Proforma (revised).pdf")
    assert "Attached:</span> FY1703 Proforma (revised).pdf" in r.html and "Attached: FY1703 Proforma (revised).pdf" in r.text
    r = render_email("proforma", booking, settings, attached=None)
    assert "Attached:" not in r.html
    r = render_email("final_details", booking, settings, ticket_attached=False)
    assert "Attached:" not in r.html
    r = render_email("payment_confirmation", booking, settings, payment={"amount": 1}, invoice_attached=False)
    assert "Attached:" not in r.html
