"""Finance documents: proforma, invoice and final invoice as PDFs.

Rendering is pure (``render_document_pdf``) so previews and tests need no
database; ``issue_document`` is the side-effecting path that versions the
file under ``DATA_DIR/documents/<booking_id>/``, stores a ``documents`` row
with a snapshot of everything that went into it, and logs a booking event.

    pdf = render_document_pdf(booking_row, "proforma", get_settings(), payments)
    doc = issue_document(booking_id, "invoice", actor=user_id)
    filename, data = document_bytes(doc["id"])

Money rules (docs/booking-system.md §4): prices are VAT inclusive;
``total = qty × price_per_person`` where qty is ``people_booked`` (proforma and
invoice) or ``arrived_count`` (final invoice); ``vat = total × r / (100 + r)``;
``paid = Σ payments``; ``due = total − paid``.
"""

from __future__ import annotations

import os
import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from config.settings import BASE_DIR, DATA_DIR
from src.models import document as document_model
from src.models.base import dumps, execute, query, query_one, serialize_row, transaction
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("documents")

KINDS = document_model.KINDS
KIND_LABELS = {
    "proforma": "Proforma",
    "invoice": "Invoice",
    "final_invoice": "Final invoice",
}
# What the document itself is headed. "Tax invoice" is the wording SARS
# expects on a VAT invoice; a proforma is explicitly not one.
KIND_TITLES = {
    "proforma": "Proforma invoice",
    "invoice": "Tax invoice",
    "final_invoice": "Final tax invoice",
}
PAYMENT_KIND_LABELS = {"eft": "EFT", "cash": "Cash", "card": "Card", "other": "Payment"}

TEMPLATES_DIR = Path(BASE_DIR) / "web" / "templates"
STATIC_DIR = Path(BASE_DIR) / "web" / "static"
FONT_FILE = STATIC_DIR / "brand" / "fonts" / "InterVariable.ttf"
LOGO_FILE = STATIC_DIR / "brand" / "logo.svg"
DOCUMENTS_SUBDIR = "documents"

CENT = Decimal("0.01")
NBSP = " "
MINUS = "−"


class DocumentError(Exception):
    """Raised for a missing booking/document or an unusable kind."""


# ------------------------------------------------------------- formatting ---


def D(value: Any) -> Decimal:
    """Coerce DB/JSON values (Decimal, float, int, str, None) to Decimal."""
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def money(value: Any, symbol: str = "R") -> str:
    """R6 365.00 style: thin thousands grouping, 2dp, real minus sign."""
    amount = D(value).quantize(CENT, rounding=ROUND_HALF_UP)
    sign = MINUS if amount < 0 else ""
    whole, _, frac = f"{abs(amount):.2f}".partition(".")
    grouped = f"{int(whole):,}".replace(",", NBSP)
    return f"{sign}{symbol}{grouped}.{frac}"


def as_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value)[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def date_long(value: Any) -> str:
    """Saturday 7 November 2026."""
    d = as_date(value)
    return f"{d:%A} {d.day} {d:%B %Y}" if d else ""


def date_medium(value: Any) -> str:
    """7 November 2026."""
    d = as_date(value)
    return f"{d.day} {d:%B %Y}" if d else ""


def date_short(value: Any) -> str:
    """7 Nov 2026."""
    d = as_date(value)
    return f"{d.day} {d:%b %Y}" if d else ""


def phone_display(value: Any) -> str:
    """E.164 digits without '+' (27821234567) → 082 123 4567."""
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        return ""
    if digits.startswith("27") and len(digits) == 11:
        digits = "0" + digits[2:]
    if len(digits) == 10:
        return f"{digits[:3]} {digits[3:6]} {digits[6:]}"
    return "+" + digits if len(digits) > 10 else digits


def first_name(full_name: Any) -> str:
    parts = str(full_name or "").strip().split()
    return parts[0] if parts else ""


def plural(n: Any, singular: str, plural_form: str | None = None) -> str:
    n = int(n or 0)
    word = singular if n == 1 else (plural_form or singular + "s")
    return f"{n} {word}"


_env: Environment | None = None


def jinja_env() -> Environment:
    """Standalone Jinja environment over web/templates (no Flask context needed)."""
    global _env
    if _env is None:
        env = Environment(
            loader=FileSystemLoader(str(TEMPLATES_DIR)),
            autoescape=select_autoescape(("html", "xml")),
            trim_blocks=True,
            lstrip_blocks=True,
        )
        env.filters.update(
            money=money,
            date_long=date_long,
            date_medium=date_medium,
            date_short=date_short,
            phone=phone_display,
            first_name=first_name,
            plural=plural,
        )
        _env = env
    return _env


# ---------------------------------------------------------------- finance ---


def document_number(booking: dict, kind: str, settings) -> str:
    """FY1703 for a proforma, INV1703 for an invoice or final invoice."""
    if kind not in KINDS:
        raise DocumentError(f"Unknown document kind: {kind}")
    number = booking.get("doc_number")
    if number is None or number == "":
        # Legacy/imported rows without a number fall back to the reference.
        return str(booking.get("reference") or "")
    prefix = settings.documents.proforma_prefix if kind == "proforma" else settings.documents.invoice_prefix
    return f"{prefix}{int(number)}"


def compute_finance(booking: dict, kind: str, settings, payments: list[dict] | None = None) -> dict:
    """Every money figure a document or email needs, as Decimals.

    The final invoice bills the counted arrivals; everything else bills the
    booked headcount. Deposit figures come straight from the booking row.
    """
    payments = payments or []
    rate = D(settings.pricing.vat_rate)
    price = D(booking.get("price_per_person")).quantize(CENT)
    people_booked = int(booking.get("people_booked") or 0)
    raw_arrived = booking.get("arrived_count")
    arrived: int | None = int(raw_arrived) if raw_arrived is not None and raw_arrived != "" else None
    uses_arrivals = kind == "final_invoice" and arrived is not None
    qty: int = arrived if (uses_arrivals and arrived is not None) else people_booked

    total = (price * qty).quantize(CENT)
    vat = (total * rate / (100 + rate)).quantize(CENT, rounding=ROUND_HALF_UP)
    subtotal = total - vat
    unit_ex_vat = (price * 100 / (100 + rate)).quantize(CENT, rounding=ROUND_HALF_UP)
    unit_vat = price - unit_ex_vat

    paid = sum((D(p.get("amount")) for p in payments), Decimal("0")).quantize(CENT)
    due = total - paid

    waived = bool(booking.get("deposit_waived"))
    deposit_due = Decimal("0") if waived else D(booking.get("deposit_due")).quantize(CENT)
    deposit_due = min(deposit_due, total) if total > 0 else deposit_due
    deposit_outstanding = max(deposit_due - paid, Decimal("0"))
    balance_on_day = max(total - max(paid, deposit_due), Decimal("0"))

    return {
        "qty": qty,
        "uses_arrivals": uses_arrivals,
        "people_booked": people_booked,
        "arrived_count": arrived,
        "price": price,
        "unit_ex_vat": unit_ex_vat,
        "unit_vat": unit_vat,
        "vat_rate": rate,
        "subtotal": subtotal,
        "vat": vat,
        "total": total,
        "paid": paid,
        "due": due,
        "deposit_due": deposit_due,
        "deposit_waived": waived,
        "deposit_outstanding": deposit_outstanding,
        "balance_on_day": balance_on_day,
    }


def finance_display(finance: dict) -> dict:
    """The same figures formatted for templates (``*_display`` keys added)."""
    out = dict(finance)
    for key in (
        "price", "unit_ex_vat", "unit_vat", "subtotal", "vat", "total", "paid", "due",
        "deposit_due", "deposit_outstanding", "balance_on_day",
    ):
        out[f"{key}_display"] = money(finance[key])
    rate = finance["vat_rate"]
    out["vat_rate_display"] = f"{rate.normalize():f}" if rate == rate.to_integral() else f"{rate}"
    return out


# ------------------------------------------------------------ sample data ---


def sample_booking() -> dict:
    """A realistic, fictitious booking for previews and tests."""
    return {
        "id": 0,
        "reference": "FY1703",
        "doc_number": 1703,
        "status": "proforma_sent",
        "group_name": "Hillside Community Church",
        "group_type": "church",
        "area": "Kuils River",
        "contact_name": "Thandi Mokoena",
        "contact_email": "thandi.mokoena@example.org",
        "contact_mobile": "27821234567",
        "visit_date": date(2026, 11, 7),
        "alternative_date": None,
        "arrival_time": "10:00",
        "adults": 40,
        "children": 27,
        "people_booked": 67,
        "vehicles": 3,
        "gazebos": 1,
        "price_tier_code": "church_weekend",
        "price_per_person": Decimal("95.00"),
        "price_overridden": 0,
        "deposit_due": Decimal("3800.00"),
        "deposit_overridden": 0,
        "deposit_waived": 0,
        "arrived_count": 61,
        "arrived_source": "loyverse",
        "barcode": "6009880017034",
        "source": "form",
        "enquiry_date": date(2026, 9, 29),
        "hold_expires_on": date(2026, 10, 31),
        "customer_notes": "We will arrive in two minibuses and one bakkie.",
    }


def sample_payments() -> list[dict]:
    return [
        {
            "id": 0,
            "booking_id": 0,
            "kind": "eft",
            "amount": Decimal("3800.00"),
            "paid_on": date(2026, 10, 2),
            "reference": "FY1703 HILLSIDE",
            "note": None,
        }
    ]


# ----------------------------------------------------------------- render ---


def booking_display(booking: dict) -> dict:
    """The booking row plus the formatted fields templates use."""
    b = dict(booking)
    b["visit_date_long"] = date_long(b.get("visit_date"))
    b["visit_date_medium"] = date_medium(b.get("visit_date"))
    b["enquiry_date_medium"] = date_medium(b.get("enquiry_date"))
    b["hold_expires_on_long"] = date_long(b.get("hold_expires_on"))
    b["hold_expires_on_medium"] = date_medium(b.get("hold_expires_on"))
    b["contact_mobile_display"] = phone_display(b.get("contact_mobile"))
    b["contact_first_name"] = first_name(b.get("contact_name"))
    b["people_booked"] = int(b.get("people_booked") or 0)
    b["vehicles"] = int(b.get("vehicles") or 0)
    b["gazebos"] = int(b.get("gazebos") or 0)
    b["price_per_person_display"] = money(b.get("price_per_person"))
    b["deposit_due_display"] = money(b.get("deposit_due"))
    return b


def payments_display(payments: list[dict] | None) -> list[dict]:
    rows = []
    for p in sorted(payments or [], key=lambda p: (str(as_date(p.get("paid_on")) or ""), p.get("id") or 0)):
        rows.append(
            {
                **p,
                "paid_on_display": date_medium(p.get("paid_on")),
                "kind_label": PAYMENT_KIND_LABELS.get(str(p.get("kind") or ""), "Payment"),
                "amount_display": money(p.get("amount")),
            }
        )
    return rows


def build_document_context(
    booking: dict,
    kind: str,
    settings,
    payments: list[dict] | None = None,
    *,
    number: str | None = None,
    version: int = 1,
    issued_on: date | None = None,
) -> dict:
    """Everything the document templates see. Also what goes into the snapshot."""
    if kind not in KINDS:
        raise DocumentError(f"Unknown document kind: {kind}")
    finance = compute_finance(booking, kind, settings, payments)
    issued_on = issued_on or get_today()
    number = number or document_number(booking, kind, settings)
    b = booking_display(booking)

    description = f"Visitors @ {money(finance['price'])}"
    lines = [
        {
            "qty": finance["qty"],
            "description": description,
            "unit_ex_vat": finance["unit_ex_vat"],
            "unit_ex_vat_display": money(finance["unit_ex_vat"]),
            # One line per document, so the line VAT is the VAT total: it is
            # derived from the inclusive total rather than unit VAT × qty, which
            # would drift by a few cents from the figure in the totals block.
            "vat": finance["vat"],
            "vat_display": money(finance["vat"]),
            "unit_vat_display": money(finance["unit_vat"]),
            "total": finance["total"],
            "total_display": money(finance["total"]),
        }
    ]

    company = dict(settings.documents)
    company.setdefault("trading_name", company.get("company_name"))

    return {
        "doc": {
            "kind": kind,
            "label": KIND_LABELS[kind],
            "title": KIND_TITLES[kind],
            "number": number,
            "version": int(version),
            "issued_on": issued_on,
            "issued_on_long": date_medium(issued_on),
            "is_proforma": kind == "proforma",
            "is_invoice": kind == "invoice",
            "is_final": kind == "final_invoice",
            "payment_reference": b.get("reference") or number,
        },
        "booking": b,
        "company": company,
        "email_settings": dict(settings.email),
        "finance": finance_display(finance),
        "lines": lines,
        "payments": payments_display(payments),
        "font_url": FONT_FILE.resolve().as_uri(),
        "logo_url": LOGO_FILE.resolve().as_uri(),
    }


def render_document_html(booking: dict, kind: str, settings, payments: list[dict] | None = None, **kw) -> str:
    ctx = build_document_context(booking, kind, settings, payments, **kw)
    template = jinja_env().get_template(f"documents/{kind}.html")
    return template.render(**ctx)


def render_document_pdf(
    booking: dict,
    kind: str,
    settings,
    payments: list[dict] | None = None,
    **kw,
) -> bytes:
    """Render the PDF with no side effects (used for previews and by issue)."""
    from weasyprint import HTML  # heavy import; keep it off the email path

    html = render_document_html(booking, kind, settings, payments, **kw)
    return HTML(string=html, base_url=str(STATIC_DIR)).write_pdf()


# ------------------------------------------------------------ persistence ---


def load_booking(booking_id: int, conn=None) -> dict:
    row = query_one("SELECT * FROM bookings WHERE id = %s", (booking_id,), conn=conn)
    if row is None:
        raise DocumentError(f"Booking {booking_id} not found")
    return row


def load_payments(booking_id: int, conn=None) -> list[dict]:
    return query(
        "SELECT * FROM payments WHERE booking_id = %s ORDER BY paid_on, id",
        (booking_id,),
        conn=conn,
    )


def serialize_document(row: dict | None, with_snapshot: bool = False) -> dict | None:
    return None if row is None else _serialize_document(row, with_snapshot)


def _serialize_document(row: dict, with_snapshot: bool = False) -> dict:
    out = serialize_row({k: v for k, v in row.items() if k != "snapshot"}) or {}
    out["label"] = KIND_LABELS.get(row.get("kind", ""), row.get("kind"))
    out["filename"] = document_filename(row)
    if with_snapshot and "snapshot" in row:
        from src.models.base import loads

        out["snapshot"] = loads(row["snapshot"])
    return out


def document_filename(row: dict) -> str:
    """Attachment-friendly name: 'FY1703 Proforma.pdf', 'INV1703 Final invoice.pdf'."""
    return f"{row['number']} {KIND_LABELS.get(row['kind'], row['kind'])}.pdf"


def document_path(row: dict) -> Path:
    path = Path(row["file_path"])
    return path if path.is_absolute() else Path(DATA_DIR) / path


def list_documents(booking_id: int) -> list[dict]:
    return [_serialize_document(r) for r in document_model.list_for_booking(booking_id)]


def get_document(document_id: int, with_snapshot: bool = False) -> dict | None:
    return serialize_document(document_model.get(document_id), with_snapshot=with_snapshot)


def preview_document(booking_id: int, kind: str, settings=None) -> bytes:
    """PDF for the booking as it stands, without issuing anything."""
    if settings is None:
        from src.services.settings import get_settings

        settings = get_settings()
    booking = load_booking(booking_id)
    payments = load_payments(booking_id)
    number = document_number(booking, kind, settings)
    version = document_model.latest_version_for_number(booking_id, number) + 1
    return render_document_pdf(booking, kind, settings, payments, number=number, version=version)


def issue_document(booking_id: int, kind: str, actor: int | None, settings=None) -> dict:
    """Render, store and record a new version of ``kind`` for the booking.

    Returns the serialized ``documents`` row. Raises ``DocumentError`` when the
    booking does not exist or the kind is unknown.
    """
    if kind not in KINDS:
        raise DocumentError(f"Unknown document kind: {kind}")
    if settings is None:
        from src.services.settings import get_settings

        settings = get_settings()

    written: Path | None = None
    try:
        with transaction() as conn:
            # Lock the booking row so two clicks cannot mint the same version.
            if query_one("SELECT id FROM bookings WHERE id = %s FOR UPDATE", (booking_id,), conn=conn) is None:
                raise DocumentError(f"Booking {booking_id} not found")
            booking = load_booking(booking_id, conn=conn)
            payments = load_payments(booking_id, conn=conn)
            number = document_number(booking, kind, settings)
            version = document_model.latest_version_for_number(booking_id, number, conn=conn) + 1
            issued_on = get_today()

            ctx = build_document_context(
                booking, kind, settings, payments, number=number, version=version, issued_on=issued_on
            )
            html = jinja_env().get_template(f"documents/{kind}.html").render(**ctx)
            from weasyprint import HTML

            pdf = HTML(string=html, base_url=str(STATIC_DIR)).write_pdf()

            rel_path = Path(DOCUMENTS_SUBDIR) / str(booking_id) / f"{number}-v{version}.pdf"
            abs_path = Path(DATA_DIR) / rel_path
            abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_bytes(pdf)
            written = abs_path

            finance = ctx["finance"]
            snapshot = {
                "kind": kind,
                "number": number,
                "version": version,
                "issued_on": issued_on.isoformat(),
                "booking": serialize_row(booking),
                "lines": [serialize_row(line) for line in ctx["lines"]],
                "totals": {
                    k: (float(v) if isinstance(v, Decimal) else v)
                    for k, v in finance.items()
                    if not k.endswith("_display")
                },
                "payments": [serialize_row(p) for p in payments],
                "settings": {
                    "documents": dict(settings.documents),
                    "vat_rate": float(settings.pricing.vat_rate),
                },
            }
            doc_id = document_model.insert(
                booking_id,
                kind,
                number,
                version,
                rel_path.as_posix(),
                finance["total"],
                finance["paid"],
                finance["due"],
                snapshot,
                actor,
                conn=conn,
            )
            summary = f"{KIND_LABELS[kind]} {number} issued (v{version})"
            execute(
                """
                INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id)
                VALUES (%s, 'document_issued', %s, %s, %s)
                """,
                (
                    booking_id,
                    summary,
                    dumps(
                        {
                            "document_id": doc_id,
                            "kind": kind,
                            "number": number,
                            "version": version,
                            "total": float(finance["total"]),
                            "paid": float(finance["paid"]),
                            "due": float(finance["due"]),
                        }
                    ),
                    actor,
                ),
                conn=conn,
            )
            row = document_model.get(doc_id, conn=conn)
            if row is None:  # cannot happen inside the transaction, but keeps the types honest
                raise DocumentError(f"Document {doc_id} vanished after insert")
    except Exception:
        if written is not None and written.exists():
            try:
                os.remove(written)
            except OSError:
                pass
        raise

    logger.info(f"{summary} for booking {booking_id} by user {actor}")
    return _serialize_document(row)


def document_bytes(document_id: int) -> tuple[str, bytes]:
    """(attachment filename, PDF bytes) for an issued document."""
    row = document_model.get(document_id)
    if row is None:
        raise DocumentError(f"Document {document_id} not found")
    path = document_path(row)
    if not path.exists():
        raise DocumentError(f"File for document {document_id} is missing: {row['file_path']}")
    return document_filename(row), path.read_bytes()
