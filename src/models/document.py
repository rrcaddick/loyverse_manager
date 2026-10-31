"""Persistence for issued PDF documents (proforma, invoice, final invoice).

One row per issued file. Re-issuing the same number produces a new version;
the file lives under ``DATA_DIR/documents/<booking_id>/<number>-v<version>.pdf``
and ``file_path`` is stored relative to ``DATA_DIR``.

    doc_id = insert(booking_id, "proforma", "FY1703", 1, "documents/12/FY1703-v1.pdf", ...)
    latest(booking_id, "proforma")          # newest proforma row or None
    list_for_booking(booking_id)            # newest first
"""

from __future__ import annotations

from decimal import Decimal

from src.models.base import dumps, execute, query, query_one

KINDS = ("proforma", "invoice", "final_invoice")


def insert(
    booking_id: int,
    kind: str,
    number: str,
    version: int,
    file_path: str,
    total: Decimal,
    paid: Decimal,
    due: Decimal,
    snapshot: dict | None,
    issued_by: int | None,
    conn=None,
) -> int:
    if kind not in KINDS:
        raise ValueError(f"Unknown document kind: {kind}")
    return execute(
        """
        INSERT INTO documents
            (booking_id, kind, number, version, file_path, total, paid, due, snapshot, issued_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            booking_id,
            kind,
            number,
            int(version),
            file_path,
            total,
            paid,
            due,
            dumps(snapshot) if snapshot is not None else None,
            issued_by,
        ),
        conn=conn,
    )


def get(document_id: int, conn=None) -> dict | None:
    return query_one("SELECT * FROM documents WHERE id = %s", (document_id,), conn=conn)


def list_for_booking(booking_id: int, conn=None) -> list[dict]:
    """Every document for a booking, newest first (snapshot omitted)."""
    return query(
        """
        SELECT id, booking_id, kind, number, version, file_path, total, paid, due,
               issued_at, issued_by, email_message_id
        FROM documents
        WHERE booking_id = %s
        ORDER BY issued_at DESC, id DESC
        """,
        (booking_id,),
        conn=conn,
    )


def latest(booking_id: int, kind: str, conn=None) -> dict | None:
    """The most recent version of ``kind`` for the booking, or None."""
    return query_one(
        """
        SELECT * FROM documents
        WHERE booking_id = %s AND kind = %s
        ORDER BY version DESC, id DESC
        LIMIT 1
        """,
        (booking_id, kind),
        conn=conn,
    )


def latest_version_for_number(booking_id: int, number: str, conn=None) -> int:
    """Highest version issued under ``number`` for this booking (0 when none).

    The invoice and the final invoice share one number (INV1703), so versions
    are counted per number rather than per kind: that keeps the file names
    unique and makes the final invoice read as a re-issue of the invoice.
    """
    row = query_one(
        "SELECT COALESCE(MAX(version), 0) AS v FROM documents WHERE booking_id = %s AND number = %s",
        (booking_id, number),
        conn=conn,
    )
    return int(row["v"]) if row else 0


def set_email_message(document_id: int, email_message_id: int | None, conn=None) -> None:
    """Link the document to the outbound email it was attached to."""
    execute(
        "UPDATE documents SET email_message_id = %s WHERE id = %s",
        (email_message_id, document_id),
        conn=conn,
    )
