"""The shop till's sales (Aronium documents) as the Farmyard card terminal module posts them."""
import json
from datetime import datetime

from src.repositories.mysql import get_db_connection


class ShopSale:
    @staticmethod
    def _cents(value):
        try:
            return int(round(float(value or 0) * 100))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _dt(value):
        if not value:
            return None
        try:
            return datetime.strptime(str(value)[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None

    @classmethod
    def upsert(cls, doc):
        """Stores (or refreshes) one document; returns (row id, created?)."""
        payments = doc.get("payments") or []
        summary = ", ".join(f"{p.get('type') or '?'} R{float(p.get('amount') or 0):.2f}" for p in payments)[:160]
        card = doc.get("card") or {}
        values = {
            "till": str(doc.get("till") or "")[:64],
            "till_id": str(doc.get("till_id") or "")[:32],
            "document_uid": str(doc.get("uid") or doc.get("id") or doc.get("number") or "")[:64],
            "document_number": str(doc.get("number") or "")[:40],
            "type_code": str(doc.get("type_code") or "")[:16],
            "type_name": str(doc.get("type_name") or "")[:64],
            "created_at": cls._dt(doc.get("created_at")) or datetime.now(),
            "received_at": datetime.now(),
            "total_cents": cls._cents(doc.get("total")),
            "user_name": str(doc.get("user") or "")[:100],
            "register_name": str(doc.get("register") or "")[:100],
            "customer_name": str(doc.get("customer") or "")[:255],
            "payment_summary": summary,
            "card_trans_no": (str(card.get("trans_no"))[:64] if card.get("trans_no") else None),
            "card_auth_no": (str(card.get("auth_no"))[:32] if card.get("auth_no") else None),
            "card_masked": (str(card.get("card"))[:32] if card.get("card") else None),
            "items_count": len(doc.get("items") or []),
            "document": json.dumps(doc, ensure_ascii=False),
        }
        cols = ", ".join(values)
        marks = ", ".join(["%s"] * len(values))
        updates = ", ".join(f"{c} = VALUES({c})" for c in values if c not in ("till_id", "document_uid"))
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"INSERT INTO shop_sales ({cols}) VALUES ({marks}) ON DUPLICATE KEY UPDATE {updates}, id = LAST_INSERT_ID(id)",
                    list(values.values()),
                )
                row_id = cursor.lastrowid
                created = cursor.rowcount == 1
            conn.commit()
        return row_id, created

    @classmethod
    def for_day(cls, day):
        start = datetime.combine(day, datetime.min.time())
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT id, till, document_number, type_code, type_name, created_at, received_at, total_cents, user_name, "
                    "register_name, customer_name, payment_summary, card_trans_no, card_auth_no, card_masked, items_count, document "
                    "FROM shop_sales WHERE created_at >= %s AND created_at < %s + INTERVAL 1 DAY ORDER BY created_at DESC, id DESC",
                    (start, start),
                )
                rows = cursor.fetchall()
        for r in rows:
            try:
                r["document"] = json.loads(r["document"]) if isinstance(r["document"], str) else r["document"]
            except (TypeError, ValueError):
                r["document"] = {}
        return rows

    @classmethod
    def latest_id(cls):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT MAX(id) AS id FROM shop_sales")
                row = cursor.fetchone()
        return (row or {}).get("id") or 0
