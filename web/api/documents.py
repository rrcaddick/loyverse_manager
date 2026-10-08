"""Finance documents and email previews (admin only).

    GET  /api/v1/documents/<id>/pdf                      inline PDF of an issued document
    GET  /api/v1/bookings/<id>/documents                 issued documents, newest first
    POST /api/v1/bookings/<id>/documents/preview {kind}  PDF of the booking as it stands, nothing stored
    GET  /api/v1/documents/email-preview/<kind>?booking_id=&format=html|text|json
                                                         rendered email; sample booking when booking_id is omitted

Issuing lives in the booking actions (``POST /bookings/:id/actions/issue-proforma``
and friends, bookings agent) which call ``documents_service.issue_document``.
"""

from __future__ import annotations

from flask import Response, request

from src.services import documents as documents_service
from src.services import email_templates
from src.services.settings import get_settings
from web.api import ApiError, make_blueprint, ok, parse_json, require_role

bp = make_blueprint("documents", "")


def _pdf_response(data: bytes, filename: str, inline: bool = True) -> Response:
    disposition = "inline" if inline else "attachment"
    safe_name = filename.replace('"', "")
    return Response(
        data,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{safe_name}"',
            "Cache-Control": "no-store",
            "Content-Length": str(len(data)),
        },
    )


@bp.get("/documents/<int:document_id>/pdf")
@require_role("admin")
def document_pdf(document_id: int):
    try:
        filename, data = documents_service.document_bytes(document_id)
    except documents_service.DocumentError as exc:
        raise ApiError("not_found", str(exc), 404)
    inline = request.args.get("download") not in ("1", "true")
    return _pdf_response(data, filename, inline=inline)


@bp.get("/bookings/<int:booking_id>/documents")
@require_role("admin")
def list_booking_documents(booking_id: int):
    return ok({"items": documents_service.list_documents(booking_id)})


@bp.post("/bookings/<int:booking_id>/documents/preview")
@require_role("admin")
def preview_booking_document(booking_id: int):
    data = parse_json(("kind",))
    kind = str(data["kind"])
    if kind not in documents_service.KINDS:
        raise ApiError(
            "validation_error",
            f"kind must be one of {', '.join(documents_service.KINDS)}",
            422,
            {"kind": "Unknown document kind"},
        )
    try:
        pdf = documents_service.preview_document(booking_id, kind)
    except documents_service.DocumentError as exc:
        raise ApiError("not_found", str(exc), 404)
    label = documents_service.KIND_LABELS[kind]
    return _pdf_response(pdf, f"Preview {label}.pdf", inline=True)


@bp.get("/documents/email-preview/<kind>")
@require_role("admin")
def email_preview(kind: str):
    if kind not in email_templates.KINDS:
        raise ApiError(
            "validation_error", f"kind must be one of {', '.join(email_templates.KINDS)}", 422
        )
    settings = get_settings()
    booking_id = request.args.get("booking_id", type=int)
    payments: list[dict] = []
    booking: dict | None
    ctx: dict
    if booking_id:
        try:
            booking = documents_service.load_booking(booking_id)
        except documents_service.DocumentError as exc:
            raise ApiError("not_found", str(exc), 404)
        payments = documents_service.load_payments(booking_id)
        latest = documents_service.list_documents(booking_id)
        document: dict | None = next((d for d in latest if d["kind"] == _document_kind_for(kind)), None)
        ctx = {"payments": payments, "document": document}
    else:
        booking = documents_service.sample_booking()
        payments = documents_service.sample_payments() if kind != "proforma" else []
        ctx = _sample_context(kind, payments)
    if kind == "bounce_back":
        booking = None

    logo_url = request.args.get("logo_url") or request.url_root.rstrip("/") + "/static/brand/logo-black-600.png"
    rendered = email_templates.render_email(kind, booking, settings, logo_url=logo_url, **ctx)

    fmt = request.args.get("format", "html")
    if fmt == "json":
        return ok({"subject": rendered.subject, "html": rendered.html, "text": rendered.text})
    if fmt == "text":
        body = f"Subject: {rendered.subject}\n\n{rendered.text}"
        return Response(body, mimetype="text/plain; charset=utf-8", headers={"Cache-Control": "no-store"})
    return Response(rendered.html, mimetype="text/html; charset=utf-8", headers={"Cache-Control": "no-store"})


def _document_kind_for(email_kind: str) -> str | None:
    return {
        "proforma": "proforma",
        "still_interested": "proforma",
        "deposit_reminder": "proforma",
        "invoice": "invoice",
        "payment_confirmation": "invoice",
        "final_invoice": "final_invoice",
    }.get(email_kind)


def _sample_context(kind: str, payments: list[dict]) -> dict:
    """Plausible extra context so every kind previews without data."""
    form_url = request.url_root.rstrip("/") + "/request"
    base: dict = {"payments": payments, "form_url": form_url}
    extras: dict[str, dict] = {
        "payment_confirmation": {"payment": payments[0] if payments else None, "invoice_attached": True},
        "deposit_reminder": {"days_left": 14, "payments": []},
        "still_interested": {"payments": []},
        "final_details": {"days_left": 3, "ticket_attached": False},
        "answers": {
            "questions": [
                {
                    "question": "Can we bring our own food and braai?",
                    "answer": "Yes. Braai facilities are available on a first-come basis and you are welcome to bring your own food and drinks.",
                },
                {"question": "Is there parking for a bus?", "answer": "Yes, there is a dedicated bus area next to the main car park."},
            ]
        },
        "reply": {
            "body_html": "<p>Hi Thandi,</p><p>Thanks for letting us know about the extra minibus. I have updated the booking to four vehicles; the ticket covers all of them.</p>",
        },
    }
    base.update(extras.get(kind, {}))
    return base
