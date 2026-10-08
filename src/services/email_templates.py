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
    KIND_DESCRIPTIONS,
    KIND_LABELS,
    D,
    as_date,
    booking_display,
    compute_finance,
    date_day_month,
    date_long,
    date_medium,
    date_weekday_short,
    document_filename,
    document_number,
    finance_display,
    jinja_env,
    money,
    money_short,
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


def _subject(
    kind: str,
    booking: dict | None,
    document: dict | None,
    settings,
    ctx: dict,
    finance: dict | None = None,
    hold_date=None,
) -> str:
    """Amount-first subjects (docs/redesign-spec.md §9): the key fact, then the
    reference. Group and date live in the preheader, not the subject."""
    if ctx.get("subject"):
        return str(ctx["subject"])
    if booking is None:
        if kind == "bounce_back":
            return f"Group bookings at {settings.documents.trading_name}"
        return str(settings.documents.trading_name)
    ref = booking["reference"]
    visit = booking.get("visit_date")
    day = date_day_month(visit)
    weekday = date_weekday_short(visit)
    f = finance or {}
    number = (document or {}).get("number")
    if kind == "proforma":
        number = number or document_number(booking, "proforma", settings)
        if f.get("deposit_waived"):
            return f"Proforma {number}{DASH}{money_short(f.get('total'))} payable on the day"
        deposit = money_short(f.get("deposit_outstanding") or f.get("deposit_due"))
        if hold_date:
            return f"Proforma {number}{DASH}{deposit} deposit by {date_day_month(hold_date)}"
        return f"Proforma {number}{DASH}{deposit} deposit secures {day}"
    if kind == "invoice":
        number = number or document_number(booking, "invoice", settings)
        due = D(f.get("due"))
        if due > 0:
            return f"Statement {number}{DASH}{money_short(due)} balance on {day}"
        return f"Statement {number}{DASH}paid in full"
    if kind == "final_invoice":
        number = number or document_number(booking, "final_invoice", settings)
        due = D(f.get("due"))
        if due > 0:
            return f"Tax invoice {number}{DASH}{money_short(due)} due"
        if due < 0:
            return f"Tax invoice {number}{DASH}{money_short(-due)} credit"
        return f"Tax invoice {number}{DASH}paid in full"
    if kind == "payment_confirmation":
        amount = money((ctx.get("payment") or {}).get("amount"))
        return f"Payment received: {amount}{DASH}{ref}"
    if kind == "deposit_reminder":
        deposit = money_short(f.get("deposit_outstanding") or f.get("deposit_due"))
        if hold_date:
            return f"Deposit {deposit} due by {date_day_month(hold_date)}{DASH}{ref}"
        return f"Deposit {deposit} due for {day}{DASH}{ref}"
    if kind == "still_interested":
        return f"Still planning to visit on {day}?{DASH}{ref}"
    if kind == "acknowledgement":
        return f"Request received {ref}{DASH}{weekday}"
    if kind == "ticket":
        return f"Vehicle ticket {ref}{DASH}{weekday}"
    if kind == "final_details":
        return f"Your visit on {weekday}{DASH}{ref}"
    if kind == "expiry":
        return f"Booking {ref} released{DASH}{day}"
    if kind == "answers":
        return f"Your questions{DASH}{ref}"
    return f"{ref}{DASH}{booking['group_name']}{DASH}{booking['visit_date_long']}"


def _preheader(kind: str, c: dict) -> str:
    """Group and date first, then one sentence."""
    b = c.get("booking") or {}
    f = c.get("finance") or {}
    p = c.get("payment") or {}
    date = b.get("visit_date_long", "")
    lead = " · ".join(x for x in (b.get("group_name"), date) if x)
    sentence = {
        "acknowledgement": f"We have received your request. Your reference is {b.get('reference', '')}.",
        "proforma": (
            f"A deposit of {f.get('deposit_outstanding_display', '')} secures the date for your group."
            if f and not f.get("deposit_waived")
            else "Your proforma is attached."
        ),
        "invoice": (
            f"Deposit received, date confirmed. Balance on the day {f.get('due_display', '')}."
            if f and D(f.get("due")) > 0
            else "Deposit received, date confirmed. Paid in full."
        ),
        "final_invoice": "Thank you for visiting. Your tax invoice is attached.",
        "ticket": "Your vehicle entry ticket is attached. Please share it with each driver.",
        "payment_confirmation": f"We have received {p.get('amount_display', 'your payment')}. Thank you.",
        "still_interested": "We sent a proforma and would love to know if you would like to go ahead.",
        "deposit_reminder": f"The deposit of {f.get('deposit_outstanding_display', '')} is still outstanding.",
        "final_details": "Everything you need for the day: arrival, your ticket and the balance due.",
        "expiry": "We have not received the deposit, so the date is no longer reserved.",
        "answers": "Answers to the questions you asked with your booking request.",
        "bounce_back": "For a group visit, our booking request form is the quickest way to get a quote.",
        "reply": "",
    }.get(kind, "")
    if kind in ("bounce_back", "reply") or not lead:
        return sentence
    return f"{lead} · {sentence}" if sentence else lead


def _attached_name(kind: str, booking: dict | None, document: dict | None, ctx: dict) -> str | None:
    """The 'Attached: FY1703 Proforma.pdf' line. ``attached`` in ctx wins; otherwise
    derived from the document number (documents) or the booking (ticket)."""
    if "attached" in ctx:
        value = ctx.get("attached")
        return str(value) if value else None
    if booking is None:
        return None
    number = (document or {}).get("number")
    if kind in ("proforma", "invoice", "final_invoice") and number:
        return document_filename({"number": number, "kind": kind})
    if kind in ("still_interested", "deposit_reminder") and number:
        return document_filename({"number": number, "kind": "proforma"})
    if kind == "ticket" or (kind == "final_details" and ctx.get("ticket_attached", True)):
        return f"Vehicle ticket {booking.get('reference') or booking.get('barcode')}.pdf"
    if kind == "payment_confirmation" and ctx.get("invoice_attached") and number:
        return document_filename({"number": number, "kind": "invoice"})
    return None


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
    attached      str filename for the "Attached: …" line (derived from the document/ticket when absent)
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
    if document is None and booking is not None and kind in ("still_interested", "deposit_reminder"):
        document = _document_display({"number": document_number(booking, "proforma", settings)})
    if document is None and booking is not None and kind == "payment_confirmation" and ctx.get("invoice_attached"):
        document = _document_display({"number": document_number(booking, "invoice", settings)})

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
        "attached": _attached_name(kind, b, document, ctx),
        "document_label": KIND_LABELS,
        "document_description": KIND_DESCRIPTIONS,
    }
    context["company"].setdefault("deposit_statement_label", KIND_DESCRIPTIONS["invoice"])
    subject = _subject(kind, b, document, settings, ctx, finance=finance, hold_date=hold_date)
    preheader = ctx.get("preheader", _preheader(kind, context))

    template = jinja_env().get_template(f"emails/{kind}.html")
    raw_html = template.render(**context, subject=subject, preheader=preheader, text_mode=False)
    html = css_inline.inline(raw_html, keep_at_rules=True, remove_inlined_selectors=False)
    text_html = template.render(**context, subject=subject, preheader="", text_mode=True)
    text = _to_text(text_html)
    return RenderedEmail(subject=subject, html=html, text=text)


__all__ = ["KINDS", "RenderedEmail", "EmailTemplateError", "render_email", "D"]
