"""Bank transactions and their matches (admin only). docs/booking-system.md §6,
docs/redesign-spec.md §8 and docs/handoff/backend-v2-misc.md.

    GET  /api/v1/payments/bank-transactions?view&status&type&from&to&q&page&page_size
    GET  /api/v1/payments/bank-transactions/:id
    POST /api/v1/payments/bank-transactions/:id/match   {booking_id}
    POST /api/v1/payments/bank-transactions/:id/unmatch
    POST /api/v1/payments/bank-transactions/:id/ignore  {reason, note?, create_rule?, pattern?}
    GET  /api/v1/payments/ignore-rules
    POST /api/v1/payments/ignore-rules                  {pattern, reason, note?}
    DELETE /api/v1/payments/ignore-rules/:id
    POST /api/v1/payments/sync
    GET  /api/v1/payments/summary
"""

from __future__ import annotations

from datetime import date

from flask import request

from src.models import bank_transaction as bank_model
from src.services import bank as bank_service
from web.api import (
    ApiError,
    current_user_id,
    make_blueprint,
    ok,
    page_args,
    paginated,
    parse_json,
    require_role,
)

bp = make_blueprint("payments", "/payments")

Q_MAX_LENGTH = 100


def _date_arg(name: str) -> date | None:
    raw = request.args.get(name)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ApiError("validation_error", f"{name} must be YYYY-MM-DD", 400, {name: "Invalid date"})


def _raise(exc: bank_service.BankError):
    raise ApiError(exc.code, str(exc), exc.status)


def _tx_or_404(tx_id: int) -> dict:
    row = bank_model.get(tx_id)
    if row is None:
        raise ApiError("not_found", "Bank transaction not found", 404)
    return row


@bp.get("/bank-transactions")
@require_role("admin")
def list_bank_transactions():
    view = request.args.get("view") or None
    if view and view not in bank_model.VIEWS:
        raise ApiError(
            "validation_error",
            f"view must be one of {', '.join(bank_model.VIEWS)}",
            400,
            {"view": "Unknown view"},
        )
    status = request.args.get("status") or None
    if status and status not in bank_model.STATUSES:
        raise ApiError(
            "validation_error",
            f"status must be one of {', '.join(bank_model.STATUSES)}",
            400,
            {"status": "Unknown status"},
        )
    credit_debit = (request.args.get("type") or "").upper() or None
    if credit_debit and credit_debit not in ("CREDIT", "DEBIT"):
        raise ApiError("validation_error", "type must be credit or debit", 400, {"type": "Invalid"})
    q = (request.args.get("q") or "").strip()[:Q_MAX_LENGTH] or None
    page, page_size = page_args()
    rows, total = bank_model.list_transactions(
        status=status,
        date_from=_date_arg("from"),
        date_to=_date_arg("to"),
        q=q,
        page=page,
        page_size=page_size,
        credit_debit=credit_debit,
        view=view,
    )
    return paginated([bank_model.serialize(r) for r in rows], total, page, page_size)


@bp.get("/bank-transactions/<int:tx_id>")
@require_role("admin")
def get_bank_transaction(tx_id: int):
    row = _tx_or_404(tx_id)
    return ok(bank_model.serialize(row, include_raw=True))


@bp.post("/bank-transactions/<int:tx_id>/match")
@require_role("admin")
def match_bank_transaction(tx_id: int):
    _tx_or_404(tx_id)
    data = parse_json(("booking_id",))
    try:
        booking_id = int(data["booking_id"])
    except (TypeError, ValueError):
        raise ApiError("validation_error", "booking_id must be an integer", 422, {"booking_id": "Invalid"})
    try:
        payment = bank_service.confirm_match(tx_id, booking_id, actor=current_user_id(), method="manual")
    except bank_service.BankError as exc:
        _raise(exc)
    return ok({"transaction": bank_model.serialize(bank_model.get(tx_id)), "payment": payment})


@bp.post("/bank-transactions/<int:tx_id>/unmatch")
@require_role("admin")
def unmatch_bank_transaction(tx_id: int):
    _tx_or_404(tx_id)
    try:
        tx = bank_service.unmatch(tx_id, actor=current_user_id())
    except bank_service.BankError as exc:
        _raise(exc)
    reverted = tx.pop("booking_reverted", None)
    return ok({"transaction": tx, "booking_reverted": reverted})


def _text_arg(data: dict, name: str, max_length: int) -> str | None:
    value = data.get(name)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ApiError("validation_error", f"{name} must be text", 422, {name: "Invalid"})
    value = value.strip()
    if len(value) > max_length:
        raise ApiError(
            "validation_error", f"{name} is too long", 422, {name: f"At most {max_length} characters"}
        )
    return value or None


@bp.post("/bank-transactions/<int:tx_id>/ignore")
@require_role("admin")
def ignore_bank_transaction(tx_id: int):
    """``{reason: own_transfer|card_settlement|interest|other, note?, create_rule?, pattern?}``.

    ``create_rule`` (first three reasons only) turns the description's
    significant prefix — or ``pattern`` — into a rule that keeps later
    entries out of the queue; the response says which rule was made.
    """
    _tx_or_404(tx_id)
    data = parse_json(("reason",))
    reason = data.get("reason")
    if not isinstance(reason, str) or reason.strip() not in bank_model.IGNORE_REASONS:
        raise ApiError(
            "validation_error",
            f"reason must be one of {', '.join(bank_model.IGNORE_REASONS)}",
            422,
            {"reason": "Choose a reason"},
        )
    reason = reason.strip()
    note = _text_arg(data, "note", 200)
    pattern = _text_arg(data, "pattern", bank_service.MAX_RULE_PATTERN)
    create_rule = bool(data.get("create_rule"))
    if create_rule and reason not in bank_service.RULE_REASONS:
        raise ApiError(
            "validation_error",
            "Only own transfers, card settlements and interest can become a rule",
            422,
            {"create_rule": "Not for this reason"},
        )
    try:
        tx = bank_service.ignore(
            tx_id, reason, actor=current_user_id(), note=note, create_rule=create_rule, pattern=pattern
        )
    except bank_service.BankError as exc:
        _raise(exc)
    rule = tx.pop("rule", None)
    return ok({"transaction": tx, "rule": rule})


@bp.get("/ignore-rules")
@require_role("admin")
def list_ignore_rules():
    items = bank_service.list_ignore_rules()
    return ok({"items": items, "total": len(items)})


@bp.post("/ignore-rules")
@require_role("admin")
def create_ignore_rule():
    data = parse_json(("pattern", "reason"))
    reason = str(data.get("reason") or "").strip()
    pattern = _text_arg(data, "pattern", bank_service.MAX_RULE_PATTERN) or ""
    note = _text_arg(data, "note", 255)
    try:
        result = bank_service.create_ignore_rule(pattern, reason, note, current_user_id())
    except bank_service.BankError as exc:
        _raise(exc)
    return ok(result, 201 if result["created"] else 200)


@bp.delete("/ignore-rules/<int:rule_id>")
@require_role("admin")
def delete_ignore_rule(rule_id: int):
    try:
        rule = bank_service.delete_ignore_rule(rule_id)
    except bank_service.BankError as exc:
        _raise(exc)
    return ok({"deleted": rule})


@bp.post("/sync")
@require_role("admin")
def sync_bank():
    try:
        result = bank_service.poll_transactions()
    except bank_service.BankError as exc:
        _raise(exc)
    return ok(result)


@bp.get("/summary")
@require_role("admin")
def payments_summary():
    return ok(bank_service.summary())
