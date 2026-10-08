"""Persistence for the ``bookings`` table (docs/booking-system.md §4).

SQL only: validation and the price/deposit/status rules live in
``src/services/booking.py``. Rows come back as plain dicts with native DB
types (Decimal, date); use ``serialize`` for JSON.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from src.models.base import execute, loads, query, query_one, serialize_row

STATUSES = (
    "enquiry",
    "proforma_sent",
    "confirmed",
    "completed",
    "cancelled",
    "lapsed",
    "no_show",
)
ACTIVE_STATUSES = ("enquiry", "proforma_sent", "confirmed", "completed")
TENTATIVE_STATUSES = ("enquiry", "proforma_sent")
FIRM_STATUSES = ("confirmed", "completed")

# Columns the service layer may write. Everything else is set by the DB.
WRITABLE_COLUMNS = frozenset(
    {
        "reference",
        "doc_number",
        "status",
        "group_name",
        "group_type",
        "area",
        "contact_name",
        "contact_email",
        "contact_mobile",
        "visit_date",
        "alternative_date",
        "arrival_time",
        "adults",
        "children",
        "people_booked",
        "vehicles",
        "gazebos",
        "price_tier_code",
        "price_per_person",
        "price_overridden",
        "price_override_reason",
        "deposit_due",
        "deposit_overridden",
        "deposit_waived",
        "deposit_override_reason",
        "arrived_count",
        "arrived_source",
        "arrived_at",
        "barcode",
        "source",
        "enquiry_date",
        "hold_expires_on",
        "customer_notes",
        "internal_notes",
        "email_thread_id",
        "proforma_sent_at",
        "invoice_sent_at",
        "final_invoice_sent_at",
        "ticket_sent_at",
        "ticket_emailed_at",
        "confirmed_at",
        "completed_at",
        "cancelled_at",
        "lapsed_at",
        "legacy_sheet_row",
        "created_by",
    }
)

BOOL_COLUMNS = ("price_overridden", "deposit_overridden", "deposit_waived")

SORTABLE = {
    "visit_date": "b.visit_date",
    "created_at": "b.created_at",
    "updated_at": "b.updated_at",
    "enquiry_date": "b.enquiry_date",
    "reference": "b.doc_number",
    "group_name": "b.group_name",
    "status": "b.status",
    "people_booked": "b.people_booked",
    "hold_expires_on": "b.hold_expires_on",
}
DEFAULT_SORT = "-visit_date"

SEARCH_COLUMNS = (
    "b.reference",
    "b.group_name",
    "b.contact_name",
    "b.contact_email",
    "b.contact_mobile",
    "b.area",
)

# paid_total is cheap enough to compute inline and saves the list UI a round trip.
_PAID_SUBQUERY = "(SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.booking_id = b.id)"


def _filter_columns(fields: dict) -> dict:
    unknown = set(fields) - WRITABLE_COLUMNS
    if unknown:
        raise ValueError(f"Unknown booking columns: {', '.join(sorted(unknown))}")
    return dict(fields)


def insert(fields: dict, conn=None) -> int:
    cols = _filter_columns(fields)
    names = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    return execute(
        f"INSERT INTO bookings ({names}) VALUES ({placeholders})",
        tuple(cols.values()),
        conn=conn,
    )


def update_fields(booking_id: int, fields: dict, conn=None) -> int:
    cols = _filter_columns(fields)
    if not cols:
        return 0
    assignments = ", ".join(f"{k} = %s" for k in cols)
    return execute(
        f"UPDATE bookings SET {assignments} WHERE id = %s",
        (*cols.values(), booking_id),
        conn=conn,
    )


def get(booking_id: int, conn=None) -> dict | None:
    return query_one("SELECT * FROM bookings WHERE id = %s", (booking_id,), conn=conn)


def get_for_update(booking_id: int, conn) -> dict | None:
    return query_one("SELECT * FROM bookings WHERE id = %s FOR UPDATE", (booking_id,), conn=conn)


def get_by_reference(reference: str) -> dict | None:
    return query_one("SELECT * FROM bookings WHERE reference = %s", (reference,))


def get_by_barcode(barcode: str) -> dict | None:
    return query_one("SELECT * FROM bookings WHERE barcode = %s", (barcode,))


def barcode_exists(barcode: str) -> bool:
    return query_one("SELECT 1 AS x FROM bookings WHERE barcode = %s", (barcode,)) is not None


def doc_number_exists(doc_number: int) -> bool:
    return query_one("SELECT 1 AS x FROM bookings WHERE doc_number = %s", (doc_number,)) is not None


def _order_clause(sort: str | None) -> str:
    sort = (sort or DEFAULT_SORT).strip()
    direction = "ASC"
    if sort.startswith("-"):
        direction, sort = "DESC", sort[1:]
    column = SORTABLE.get(sort, SORTABLE["visit_date"])
    return f"ORDER BY {column} {direction}, b.id {direction}"


def _where(
    statuses: list[str] | None,
    from_date: date | None,
    to_date: date | None,
    q: str | None,
) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []
    if statuses:
        clauses.append("b.status IN (" + ",".join(["%s"] * len(statuses)) + ")")
        params.extend(statuses)
    if from_date:
        clauses.append("b.visit_date >= %s")
        params.append(from_date)
    if to_date:
        clauses.append("b.visit_date <= %s")
        params.append(to_date)
    if q:
        like = f"%{q.strip()}%"
        clauses.append("(" + " OR ".join(f"{c} LIKE %s" for c in SEARCH_COLUMNS) + ")")
        params.extend([like] * len(SEARCH_COLUMNS))
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


def list_bookings(
    statuses: list[str] | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
    sort: str | None = None,
) -> tuple[list[dict], int]:
    """Filtered, paginated page of bookings plus the total matching count."""
    where, params = _where(statuses, from_date, to_date, q)
    total_row = query_one(f"SELECT COUNT(*) AS n FROM bookings b {where}", tuple(params))
    total = int(total_row["n"]) if total_row else 0
    offset = (max(page, 1) - 1) * page_size
    rows = query(
        f"SELECT b.*, {_PAID_SUBQUERY} AS paid_total FROM bookings b {where} "
        f"{_order_clause(sort)} LIMIT %s OFFSET %s",
        (*params, page_size, offset),
    )
    return rows, total


def list_by_date_range(
    from_date: date,
    to_date: date,
    statuses: tuple[str, ...] | list[str] | None = None,
) -> list[dict]:
    where, params = _where(list(statuses) if statuses else None, from_date, to_date, None)
    return query(
        f"SELECT b.*, {_PAID_SUBQUERY} AS paid_total FROM bookings b {where} "
        "ORDER BY b.visit_date, b.arrival_time, b.id",
        tuple(params),
    )


def list_for_date(visit_date: date, statuses: tuple[str, ...] | list[str] | None = None) -> list[dict]:
    return list_by_date_range(visit_date, visit_date, statuses)


def counts_by_status() -> dict[str, int]:
    rows = query("SELECT status, COUNT(*) AS n FROM bookings GROUP BY status")
    counts = {status: 0 for status in STATUSES}
    for r in rows:
        counts[r["status"]] = int(r["n"])
    return counts


def delete(booking_id: int) -> int:
    """Hard delete (cascades to questions, events, payments, documents). Test clean-up only."""
    return execute("DELETE FROM bookings WHERE id = %s", (booking_id,))


def serialize(row: dict | None) -> dict | None:
    """JSON-safe booking: Decimal → float, dates → ISO, flags → bool, JSON decoded."""
    if row is None:
        return None
    out = serialize_row(row)
    for col in BOOL_COLUMNS:
        if col in out:
            out[col] = bool(out[col])
    if "legacy_sheet_row" in out:
        out["legacy_sheet_row"] = loads(row.get("legacy_sheet_row"))
    if "paid_total" in out and isinstance(row.get("paid_total"), Decimal):
        out["paid_total"] = float(row["paid_total"])
    return out
