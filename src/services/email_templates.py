"""Outbound customer emails: subject, HTML and plain-text for every kind.

    rendered = render_email("proforma", booking_row, get_settings(), document=doc, logo_url=url)
    rendered.subject, rendered.html, rendered.text

Every kind shares ``web/templates/emails/base.html`` (table layout, logo or
wordmark header, signature from ``settings.email``, company footer). CSS is
inlined with css_inline; the text alternative comes from html2text over a
logo-free render. See docs/handoff/documents.md for the per-kind context.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import css_inline
import html2text

from src.services.documents import (
    D,
    as_date,
    booking_display,
    compute_finance,
    date_long,
    date_medium,
    document_number,
    finance_display,
    jinja_env,
    money,
)
from src.utils.date import get_today

KINDS = (
    "acknowledgement",
    "proforma",
    "invoice",
    "final_invoice",
    "ticket",
    "payment_confirmation",
    "still_interested",
    "deposit_reminder",
    "final_details",
    "expiry",
    "answers",
    "bounce_back",
    "reply",
)
# Kinds that make sense without a booking.
BOOKING_OPTIONAL = {"bounce_back", "reply"}
DASH = " – "


@dataclass
class RenderedEmail:
    subject: str
    html: str
    text: str


class EmailTemplateError(Exception):
    pass


def _document_display(document: dict | None) -> dict | None:
    if not document:
        return None
    d = dict(document)
    for key in ("total", "paid", "due"):
        if key in d:
            d[f"{key}_display"] = money(d[key])
    d["issued_on_display"] = date_medium(d.get("issued_at") or d.get("issued_on"))
    return d


def _payment_display(payment: dict | None) -> dict | None:
    if not payment:
        return None
    p = dict(payment)
    p["amount_display"] = money(p.get("amount"))
    p["paid_on_display"] = date_medium(p.get("paid_on"))
    return p


def _subject(kind: str, booking: dict | None, document: dict | None, settings, ctx: dict) -> str:
    if ctx.get("subject"):
        return str(ctx["subject"])
    if booking is None:
        if kind == "bounce_back":
            return f"Group bookings at {settings.documents.trading_name}"
        return str(settings.documents.trading_name)
    tail = f"{booking['group_name']}{DASH}{booking['visit_date_long']}"
    ref = booking["reference"]
    number = (document or {}).get("number")
    if kind == "proforma":
        return f"Proforma {number or document_number(booking, 'proforma', settings)}{DASH}{tail}"
    if kind == "invoice":
        return f"Invoice {number or document_number(booking, 'invoice', settings)}{DASH}{tail}"
    if kind == "final_invoice":
        return f"Final invoice {number or document_number(booking, 'final_invoice', settings)}{DASH}{tail}"
    heads = {
        "acknowledgement": "Booking request",
        "ticket": "Vehicle ticket",
        "payment_confirmation": "Payment received",
        "still_interested": "Still planning to visit?",
        "deposit_reminder": "Deposit reminder",
        "final_details": "Final details",
        "expiry": "Booking released",
        "answers": "Your questions",
    }
    head = heads.get(kind)
    if head:
        return f"{head} {ref}{DASH}{tail}"
    return f"{ref}{DASH}{tail}"


def _preheader(kind: str, c: dict) -> str:
    b = c.get("booking") or {}
    f = c.get("finance") or {}
    p = c.get("payment") or {}
    date = b.get("visit_date_long", "")
    return {
        "acknowledgement": f"We have received your request for {date}. Your reference is {b.get('reference', '')}.",
        "proforma": (
            f"A deposit of {f.get('deposit_outstanding_display', '')} secures {date} for your group."
            if f and not f.get("deposit_waived")
            else f"Your proforma for {date} is attached."
        ),
        "invoice": f"Your deposit has been received and {date} is confirmed.",
        "final_invoice": "Thank you for visiting. Your final invoice is attached.",
        "ticket": f"Your vehicle entry ticket for {date} is attached. Please share it with each driver.",
        "payment_confirmation": f"We have received {p.get('amount_display', 'your payment')}. Thank you.",
        "still_interested": f"We sent a proforma for {date} and would love to know if you would like to go ahead.",
        "deposit_reminder": f"The deposit of {f.get('deposit_outstanding_display', '')} for {date} is still outstanding.",
        "final_details": f"Everything you need for {date}: arrival, your ticket and the balance due.",
        "expiry": "We have not received the deposit, so the date is no longer reserved.",
        "answers": "Answers to the questions you asked with your booking request.",
        "bounce_back": "For a group visit, our booking request form is the quickest way to get a quote.",
        "reply": "",
    }.get(kind, "")


def _to_text(html: str) -> str:
    h = html2text.HTML2Text()
    h.body_width = 0
    h.ignore_images = True
    h.ignore_emphasis = True
    h.ignore_tables = True
    h.unicode_snob = True
    # Templates always show a link's URL or address as its text, so dropping
    # the markdown link syntax loses nothing and reads cleanly.
    h.ignore_links = True
    h.single_line_break = False
    text = h.handle(html)
    text = text.replace(" ", " ")
    text = re.sub(r"^#{1,6} ", "", text, flags=re.M)  # markdown heading markers
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def render_email(kind: str, booking: dict | None, settings, **ctx: Any) -> RenderedEmail:
    """Render one outbound email. ``booking`` is the raw bookings row (or None
    for bounce_back/reply). Extra context by kind:

    document      dict with number/total/paid/due   (proforma, invoice, final_invoice, still_interested, deposit_reminder)
    payments      list of payments rows              (any kind; used for paid/due figures)
    payment       dict amount/paid_on/reference      (payment_confirmation)
    questions     [{question, answer}]               (answers)
    form_url      str                                (bounce_back, acknowledgement)
    body_html     str                                (reply)
    subject       str                                (reply, or to override any kind)
    days_left     int                                (deposit_reminder, final_details)
    hold_expires_on  date                            (proforma, still_interested, deposit_reminder; defaults to the booking's)
    ticket_attached  bool                            (final_details; default True)
    invoice_attached bool                            (payment_confirmation; default False)
    rules_url     str                                (ticket, final_details; defaults to the website)
    logo_url      str absolute https URL             (all; falls back to a text wordmark)
    """
    if kind not in KINDS:
        raise EmailTemplateError(f"Unknown email kind: {kind}")
    if booking is None and kind not in BOOKING_OPTIONAL:
        raise EmailTemplateError(f"Email kind {kind} needs a booking")

    today = get_today()
    b = booking_display(booking) if booking else None
    finance: dict | None = None
    if booking is not None:
        fin_kind = "final_invoice" if kind == "final_invoice" else "invoice"
        finance = finance_display(compute_finance(booking, fin_kind, settings, ctx.get("payments") or []))

    document = _document_display(ctx.get("document"))
    if document is None and booking is not None and finance is not None and kind in ("proforma", "invoice", "final_invoice"):
        document = _document_display(
            {
                "number": document_number(booking, kind, settings),
                "total": finance["total"],
                "paid": finance["paid"],
                "due": finance["due"],
            }
        )

    hold = ctx.get("hold_expires_on", (booking or {}).get("hold_expires_on"))
    hold_date = as_date(hold)
    days_left = ctx.get("days_left")
    if days_left is None and b is not None and as_date(b.get("visit_date")):
        days_left = (as_date(b["visit_date"]) - today).days

    website = str(settings.email.website or "").strip()
    rules_url = ctx.get("rules_url") or (f"https://{website}" if website and not website.startswith("http") else website)

    context = {
        "kind": kind,
        "booking": b,
        "finance": finance,
        "document": document,
        "payment": _payment_display(ctx.get("payment")),
        "questions": ctx.get("questions") or [],
        "form_url": ctx.get("form_url"),
        "rules_url": rules_url,
        "body_html": ctx.get("body_html") or "",
        "days_left": days_left if days_left is None or days_left >= 0 else 0,
        "hold_expires_on": hold_date,
        "hold_expires_on_long": date_long(hold_date),
        "ticket_attached": bool(ctx.get("ticket_attached", True)),
        "invoice_attached": bool(ctx.get("invoice_attached", False)),
        "logo_url": ctx.get("logo_url"),
        "company": dict(settings.documents),
        "email_settings": dict(settings.email),
        "today": today,
    }
    subject = _subject(kind, b, document, settings, ctx)
    preheader = ctx.get("preheader", _preheader(kind, context))

    template = jinja_env().get_template(f"emails/{kind}.html")
    raw_html = template.render(**context, subject=subject, preheader=preheader, text_mode=False)
    html = css_inline.inline(raw_html, keep_at_rules=True, remove_inlined_selectors=False)
    text_html = template.render(**context, subject=subject, preheader="", text_mode=True)
    text = _to_text(text_html)
    return RenderedEmail(subject=subject, html=html, text=text)


__all__ = ["KINDS", "RenderedEmail", "EmailTemplateError", "render_email", "D"]
