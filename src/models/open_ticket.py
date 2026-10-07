import json

from src.repositories.mysql import get_db_connection


class OpenTicket:
    def __init__(
        self,
        ticket_id,
        semantic_hash,
        status,
        receipt_json,
        opened_at,
        last_modified_at,
        closed_at=None,
    ):
        self.ticket_id = ticket_id
        self.semantic_hash = semantic_hash
        self.status = status
        self.receipt_json = receipt_json
        self.opened_at = opened_at
        self.last_modified_at = last_modified_at
        self.closed_at = closed_at

    @classmethod
    def get_open_ticket_ids(cls):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT ticket_id FROM open_tickets_current WHERE status = 'open'"
                )
                return {row["ticket_id"] for row in cursor.fetchall()}

    @classmethod
    def upsert_open(cls, ticket_id, semantic_hash, receipt_json, observed_at):
        receipt_json_str = json.dumps(receipt_json)

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT semantic_hash, status, closed_at FROM open_tickets_current
                    WHERE ticket_id = %s
                    """,
                    (ticket_id,),
                )
                row = cursor.fetchone()

                if row is not None and row["status"] != "open":
                    # A terminal whose sync is behind may still report a ticket that
                    # another terminal ended; only genuinely newer sightings reopen it.
                    if row["closed_at"] is not None and observed_at <= row["closed_at"]:
                        return
                    cursor.execute(
                        """
                        UPDATE open_tickets_current
                        SET status = 'open', closed_at = NULL, semantic_hash = %s,
                            receipt_json = %s, last_modified_at = %s, last_seen_at = %s
                        WHERE ticket_id = %s
                        """,
                        (semantic_hash, receipt_json_str, observed_at, observed_at, ticket_id),
                    )
                    event_type = "reopened"
                elif row is None:
                    cursor.execute(
                        """
                        INSERT INTO open_tickets_current
                        (ticket_id, semantic_hash, status, receipt_json, opened_at, last_modified_at, last_seen_at)
                        VALUES (%s, %s, 'open', %s, %s, %s, %s)
                        """,
                        (
                            ticket_id,
                            semantic_hash,
                            receipt_json_str,
                            observed_at,
                            observed_at,
                            observed_at,
                        ),
                    )
                    event_type = "created"

                elif row["semantic_hash"] != semantic_hash:
                    cursor.execute(
                        """
                        UPDATE open_tickets_current
                        SET semantic_hash = %s,
                            receipt_json = %s,
                            last_modified_at = %s,
                            last_seen_at = %s
                        WHERE ticket_id = %s
                        """,
                        (
                            semantic_hash,
                            receipt_json_str,
                            observed_at,
                            observed_at,
                            ticket_id,
                        ),
                    )
                    event_type = "modified"
                else:
                    cursor.execute(
                        "UPDATE open_tickets_current SET last_seen_at = %s WHERE ticket_id = %s",
                        (observed_at, ticket_id),
                    )
                    conn.commit()
                    return

                cursor.execute(
                    """
                    INSERT INTO open_tickets_history
                    (ticket_id, semantic_hash, event_type, receipt_json, observed_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        ticket_id,
                        semantic_hash,
                        event_type,
                        receipt_json_str,
                        observed_at,
                    ),
                )

                conn.commit()

    # A ticket is only closed by heartbeat when NO terminal has reported it for this long.
    HEARTBEAT_GRACE_SECONDS = 600

    @classmethod
    def close_missing(cls, heartbeat_ids, observed_at, grace_seconds=None):
        """Heartbeat from one terminal: refresh sightings, close what nobody has seen lately.

        Several terminals send heartbeats of the tickets *they* hold; a terminal whose
        sync is behind must not close tickets the others still have, so absence from a
        single heartbeat only matters once the ticket has gone unseen everywhere for
        ``HEARTBEAT_GRACE_SECONDS``. Explicit voided/closed events end tickets at once.
        """
        grace = cls.HEARTBEAT_GRACE_SECONDS if grace_seconds is None else grace_seconds
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                if heartbeat_ids:
                    placeholders = ", ".join(["%s"] * len(heartbeat_ids))
                    cursor.execute(
                        f"UPDATE open_tickets_current SET last_seen_at = %s "
                        f"WHERE status = 'open' AND ticket_id IN ({placeholders})",
                        (observed_at, *heartbeat_ids),
                    )
                cursor.execute(
                    """
                    SELECT ticket_id FROM open_tickets_current
                    WHERE status = 'open'
                      AND COALESCE(last_seen_at, last_modified_at) < %s - INTERVAL %s SECOND
                      AND last_modified_at < %s - INTERVAL %s SECOND
                    """,
                    (observed_at, grace, observed_at, grace),
                )
                to_close = [row["ticket_id"] for row in cursor.fetchall()]
                for ticket_id in to_close:
                    cursor.execute(
                        """
                        UPDATE open_tickets_current
                        SET status = 'closed',
                            closed_at = %s
                        WHERE ticket_id = %s
                        """,
                        (observed_at, ticket_id),
                    )
                    cursor.execute(
                        """
                        INSERT INTO open_tickets_history
                        (ticket_id, semantic_hash, event_type, observed_at)
                        SELECT ticket_id, semantic_hash, 'closed', %s
                        FROM open_tickets_current
                        WHERE ticket_id = %s
                        """,
                        (observed_at, ticket_id),
                    )
                conn.commit()

    @classmethod
    def close_one(cls, ticket_id, observed_at, status="closed", receipt_json=None):
        """End a ticket's life on an explicit bridge event (voided / closed)."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT semantic_hash, status FROM open_tickets_current WHERE ticket_id = %s",
                    (ticket_id,),
                )
                row = cursor.fetchone()
                if row is not None and row["status"] != "open":
                    return
                if row is not None:
                    cursor.execute(
                        """
                        UPDATE open_tickets_current
                        SET status = %s, closed_at = %s, last_modified_at = %s
                        WHERE ticket_id = %s
                        """,
                        (status, observed_at, observed_at, ticket_id),
                    )
                # A receipt charged straight from the sales screen was never an open
                # ticket; it still gets a history row so every close is auditable.
                cursor.execute(
                    """
                    INSERT INTO open_tickets_history
                    (ticket_id, semantic_hash, event_type, receipt_json, observed_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        ticket_id,
                        row["semantic_hash"] if row is not None else "",
                        status,
                        json.dumps(receipt_json) if receipt_json is not None else None,
                        observed_at,
                    ),
                )
                conn.commit()

    @classmethod
    def held_quantity(cls, product_id, variant_id=None, exclude_sync_id=0):
        """Quantity (thousandths) of a product held in open tickets, except one ticket.

        Reads the bridge's receipt JSON: ``sync_id`` identifies the ticket and
        ``items[]`` carry ``product_id``, ``quantity`` and ``voided``.
        """
        held = 0
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT receipt_json FROM open_tickets_current WHERE status = 'open'"
                )
                for row in cursor.fetchall():
                    try:
                        receipt = json.loads(row["receipt_json"]) if row["receipt_json"] else {}
                    except (TypeError, ValueError):
                        continue
                    if int(receipt.get("sync_id") or 0) == int(exclude_sync_id or 0) and exclude_sync_id:
                        continue
                    for item in receipt.get("items") or []:
                        if item.get("voided"):
                            continue
                        if int(item.get("product_id") or 0) != int(product_id):
                            continue
                        if variant_id is not None and item.get("variant_id") not in (None, variant_id):
                            continue
                        held += int(item.get("quantity") or 0)
        return held
