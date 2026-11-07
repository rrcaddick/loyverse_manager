"""Enquiries: unmatched conversations waiting on us (docs/handoff/migration-and-inbound.md §4).

    GET    /api/v1/enquiries?status=open|all|resolved&q=&page=&page_size=
    GET    /api/v1/enquiries/counts
    GET    /api/v1/enquiries/<id>                 enquiry + conversation stream + form_link
    GET    /api/v1/enquiries/<id>/prefill         what the mail says (extraction)
    POST   /api/v1/enquiries/<id>/reply           {body_html, body_text?, cc?}
    POST   /api/v1/enquiries/<id>/resolve | reopen | not-booking
    POST   /api/v1/enquiries/<id>/convert         re-sends the form, tied by token
    POST   /api/v1/enquiries/<id>/create-request  {booking fields} -> request + attach
    POST   /api/v1/enquiries/<id>/attach          {booking_id}
"""

from __future__ import annotations

from flask import request

from src.services import enquiries
from src.services.enquiries import EnquiryError
from web.api import ApiError, current_user_id, make_blueprint, ok, parse_json

bp = make_blueprint("enquiries", "/enquiries")


@bp.errorhandler(EnquiryError)
def _enquiry_error(exc: EnquiryError):
    raise ApiError(exc.code, str(exc), exc.status)


@bp.get("")
def list_enquiries():
    page = max(1, int(request.args.get("page", 1) or 1))
    size = min(200, max(1, int(request.args.get("page_size", 50) or 50)))
    return ok(enquiries.list_enquiries(request.args.get("status", "open"), request.args.get("q"), page, size))


@bp.get("/counts")
def counts():
    from src.models import enquiry as enquiry_model

    return ok(enquiry_model.counts())


@bp.get("/<int:enquiry_id>")
def detail(enquiry_id: int):
    return ok(enquiries.detail(enquiry_id))


@bp.get("/<int:enquiry_id>/prefill")
def prefill(enquiry_id: int):
    return ok(enquiries.prefill(enquiry_id))


@bp.post("/<int:enquiry_id>/reply")
def reply(enquiry_id: int):
    data = parse_json(("body_html",))
    cc = data.get("cc") or []
    if not isinstance(cc, list):
        raise ApiError("validation_error", "cc must be a list", 422, {"cc": "Must be a list"})
    return ok(enquiries.reply(enquiry_id, body_html=str(data["body_html"]), body_text=data.get("body_text"), cc=cc, actor=current_user_id()))


@bp.post("/<int:enquiry_id>/resolve")
def resolve(enquiry_id: int):
    return ok(enquiries.resolve(enquiry_id, current_user_id()))


@bp.post("/<int:enquiry_id>/reopen")
def reopen(enquiry_id: int):
    return ok(enquiries.reopen(enquiry_id, current_user_id()))


@bp.post("/<int:enquiry_id>/not-booking")
def not_booking(enquiry_id: int):
    return ok(enquiries.not_booking(enquiry_id, current_user_id()))


@bp.post("/<int:enquiry_id>/convert")
def convert(enquiry_id: int):
    return ok(enquiries.convert(enquiry_id, current_user_id()))


@bp.post("/<int:enquiry_id>/create-request")
def create_request(enquiry_id: int):
    data = parse_json()
    try:
        return ok(enquiries.create_request(enquiry_id, data, current_user_id()), 201)
    except Exception as exc:  # noqa: BLE001 - booking validation errors carry fields
        fields = getattr(exc, "fields", None)
        if fields is not None:
            raise ApiError("validation_error", str(exc), 422, fields)
        raise


@bp.post("/<int:enquiry_id>/attach")
def attach(enquiry_id: int):
    data = parse_json(("booking_id",))
    return ok(enquiries.attach(enquiry_id, int(data["booking_id"]), current_user_id()))
