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
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT semantic_hash FROM open_tickets_current
                    WHERE ticket_id = %s
                    """,
                    (ticket_id,),
                )
                row = cursor.fetchone()

                if row is None:
                    # Create
                    cursor.execute(
                        """
                        INSERT INTO open_tickets_current
                        (ticket_id, semantic_hash, status, receipt_json, opened_at, last_modified_at)
                        VALUES (%s, %s, 'open', %s, %s, %s)
                        """,
                        (
                            ticket_id,
                            semantic_hash,
                            receipt_json,
                            observed_at,
                            observed_at,
                        ),
                    )
                    event_type = "created"
                elif row["semantic_hash"] != semantic_hash:
                    # Modify
                    cursor.execute(
                        """
                        UPDATE open_tickets_current
                        SET semantic_hash = %s,
                            receipt_json = %s,
                            last_modified_at = %s
                        WHERE ticket_id = %s
                        """,
                        (
                            semantic_hash,
                            receipt_json,
                            observed_at,
                            ticket_id,
                        ),
                    )
                    event_type = "modified"
                else:
                    return  # No-op

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
                        receipt_json,
                        observed_at,
                    ),
                )
                conn.commit()

    @classmethod
    def close_missing(cls, heartbeat_ids, observed_at):
        open_ids = cls.get_open_ticket_ids()
        to_close = open_ids - heartbeat_ids

        if not to_close:
            return

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
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
