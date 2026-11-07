"""Questions a customer asked with their enquiry, and the answers given.

The public form allows up to ``settings.form.max_questions``; admins can add
more from the booking page. Answers are sent with the ``send-answers`` action.
"""

from __future__ import annotations

from src.models.base import execute, query, query_one, serialize_row


def add(booking_id: int, question: str, sort_order: int | None = None, conn=None) -> int:
    if sort_order is None:
        row = query_one(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM booking_questions WHERE booking_id = %s",
            (booking_id,),
            conn=conn,
        )
        sort_order = int(row["n"]) if row else 1
    return execute(
        "INSERT INTO booking_questions (booking_id, question, sort_order) VALUES (%s, %s, %s)",
        (booking_id, question.strip(), sort_order),
        conn=conn,
    )


def answer(question_id: int, answer_text: str, actor: int | None, conn=None) -> int:
    return execute(
        """
        UPDATE booking_questions
        SET answer = %s, answered_at = NOW(), answered_by = %s
        WHERE id = %s
        """,
        (answer_text.strip(), actor, question_id),
        conn=conn,
    )


def get(question_id: int) -> dict | None:
    return query_one("SELECT * FROM booking_questions WHERE id = %s", (question_id,))


def delete(question_id: int) -> int:
    return execute("DELETE FROM booking_questions WHERE id = %s", (question_id,))


def list_for_booking(booking_id: int) -> list[dict]:
    rows = query(
        """
        SELECT q.*, u.full_name AS answered_by_name
        FROM booking_questions q
        LEFT JOIN users u ON u.id = q.answered_by
        WHERE q.booking_id = %s
        ORDER BY q.sort_order, q.id
        """,
        (booking_id,),
    )
    return [serialize_row(r) for r in rows]
