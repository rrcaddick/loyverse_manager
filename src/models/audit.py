import secrets
import string

from src.repositories.mysql import get_db_connection


class CardPaymentAudit:
    """Model for daily card payment audit records comparing Paycloud vs POS systems."""

    def __init__(
        self,
        id=None,
        audit_date=None,
        paycloud_amount=None,
        loyverse_amount=None,
        aronium_amount=None,
        pos_total=None,
        variance=None,
        created_at=None,
    ):
        self.id = id
        self.audit_date = audit_date
        self.paycloud_amount = paycloud_amount
        self.loyverse_amount = loyverse_amount
        self.aronium_amount = aronium_amount
        self.pos_total = pos_total
        self.variance = variance
        self.created_at = created_at

    def to_dict(self):
        """Convert to dict for serialization."""
        return {
            "id": self.id,
            "audit_date": self.audit_date,
            "paycloud_amount": float(self.paycloud_amount)
            if self.paycloud_amount
            else 0.0,
            "loyverse_amount": float(self.loyverse_amount)
            if self.loyverse_amount
            else 0.0,
            "aronium_amount": float(self.aronium_amount)
            if self.aronium_amount
            else 0.0,
            "pos_total": float(self.pos_total) if self.pos_total else 0.0,
            "variance": float(self.variance) if self.variance else 0.0,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data):
        """Create instance from DB row dict."""
        return cls(
            id=data.get("id"),
            audit_date=data.get("audit_date"),
            paycloud_amount=data.get("paycloud_amount"),
            loyverse_amount=data.get("loyverse_amount"),
            aronium_amount=data.get("aronium_amount"),
            pos_total=data.get("pos_total"),
            variance=data.get("variance"),
            created_at=data.get("created_at"),
        )

    @classmethod
    def create_batch(cls, audit_records):
        """
        Create multiple card payment audit records at once.

        Args:
            audit_records: List of dicts with keys: audit_date, paycloud_amount,
                          loyverse_amount, aronium_amount, pos_total, variance

        Returns:
            Number of records created
        """
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = """
                    INSERT INTO card_payment_audits 
                    (audit_date, paycloud_amount, loyverse_amount, aronium_amount, pos_total, variance)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """
                values = [
                    (
                        record["audit_date"],
                        record["paycloud_amount"],
                        record["loyverse_amount"],
                        record["aronium_amount"],
                        record["pos_total"],
                        record["variance"],
                    )
                    for record in audit_records
                ]
                cursor.executemany(sql, values)
                conn.commit()
                return cursor.rowcount

    @classmethod
    def get_by_date_range(cls, start_date, end_date):
        """Get all card payment audits within a date range."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = """
                    SELECT * FROM card_payment_audits 
                    WHERE audit_date BETWEEN %s AND %s
                    ORDER BY audit_date DESC
                """
                cursor.execute(sql, (start_date, end_date))
                rows = cursor.fetchall()
                return [cls.from_dict(row) for row in rows]

    @classmethod
    def get_by_date(cls, audit_date):
        """Get card payment audit for a specific date."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = "SELECT * FROM card_payment_audits WHERE audit_date = %s"
                cursor.execute(sql, (audit_date,))
                row = cursor.fetchone()
                return cls.from_dict(row) if row else None


class CashBagAssignment:
    """Model for cash bag assignments tracking expected cash amounts by source."""

    def __init__(
        self,
        id=None,
        bag_id=None,
        assignment_date=None,
        source_system=None,
        source_identifier=None,
        expected_amount=None,
        employee_id=None,
        pos_device_id=None,
        shift_id=None,
        created_at=None,
    ):
        self.id = id
        self.bag_id = bag_id
        self.assignment_date = assignment_date
        self.source_system = source_system  # 'loyverse' or 'aronium'
        self.source_identifier = source_identifier  # e.g., 'shift-123', 'daily-total'
        self.expected_amount = expected_amount
        self.employee_id = employee_id  # Loyverse only
        self.pos_device_id = pos_device_id  # Loyverse only
        self.shift_id = shift_id  # Loyverse shift ID if available
        self.created_at = created_at

    @staticmethod
    def generate_bag_id():
        """Generate a random 8-character bag identifier (e.g., BAG-K7M3P9XQ)."""
        chars = string.ascii_uppercase + string.digits
        random_str = "".join(secrets.choice(chars) for _ in range(8))
        return f"BAG-{random_str}"

    def to_dict(self):
        """Convert to dict for serialization."""
        return {
            "id": self.id,
            "bag_id": self.bag_id,
            "assignment_date": self.assignment_date,
            "source_system": self.source_system,
            "source_identifier": self.source_identifier,
            "expected_amount": float(self.expected_amount)
            if self.expected_amount
            else 0.0,
            "employee_id": self.employee_id,
            "pos_device_id": self.pos_device_id,
            "shift_id": self.shift_id,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data):
        """Create instance from DB row dict."""
        return cls(
            id=data.get("id"),
            bag_id=data.get("bag_id"),
            assignment_date=data.get("assignment_date"),
            source_system=data.get("source_system"),
            source_identifier=data.get("source_identifier"),
            expected_amount=data.get("expected_amount"),
            employee_id=data.get("employee_id"),
            pos_device_id=data.get("pos_device_id"),
            shift_id=data.get("shift_id"),
            created_at=data.get("created_at"),
        )

    @classmethod
    def create(
        cls,
        assignment_date,
        source_system,
        source_identifier,
        expected_amount,
        employee_id=None,
        pos_device_id=None,
        shift_id=None,
    ):
        """Create a new cash bag assignment."""
        bag_id = cls.generate_bag_id()

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = """
                    INSERT INTO cash_bag_assignments 
                    (bag_id, assignment_date, source_system, source_identifier, 
                     expected_amount, employee_id, pos_device_id, shift_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """
                cursor.execute(
                    sql,
                    (
                        bag_id,
                        assignment_date,
                        source_system,
                        source_identifier,
                        expected_amount,
                        employee_id,
                        pos_device_id,
                        shift_id,
                    ),
                )
                conn.commit()
                assignment_id = cursor.lastrowid

        return cls.get_by_id(assignment_id)

    @classmethod
    def create_batch(cls, assignments):
        """
        Create multiple cash bag assignments at once.

        Args:
            assignments: List of dicts with keys: assignment_date, source_system,
                        source_identifier, expected_amount, employee_id (optional),
                        pos_device_id (optional), shift_id (optional)

        Returns:
            List of created CashBagAssignment instances
        """
        created_ids = []
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = """
                    INSERT INTO cash_bag_assignments 
                    (bag_id, assignment_date, source_system, source_identifier, 
                     expected_amount, employee_id, pos_device_id, shift_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """
                values = [
                    (
                        cls.generate_bag_id(),
                        a["assignment_date"],
                        a["source_system"],
                        a["source_identifier"],
                        a["expected_amount"],
                        a.get("employee_id"),
                        a.get("pos_device_id"),
                        a.get("shift_id"),
                    )
                    for a in assignments
                ]
                cursor.executemany(sql, values)
                conn.commit()

                # Get the created records (assumes auto-increment IDs)
                cursor.execute(
                    "SELECT * FROM cash_bag_assignments ORDER BY id DESC LIMIT %s",
                    (len(assignments),),
                )
                rows = cursor.fetchall()

        return [cls.from_dict(row) for row in reversed(rows)]

    @classmethod
    def get_by_id(cls, assignment_id):
        """Get cash bag assignment by ID."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = "SELECT * FROM cash_bag_assignments WHERE id = %s"
                cursor.execute(sql, (assignment_id,))
                row = cursor.fetchone()
                return cls.from_dict(row) if row else None

    @classmethod
    def get_by_bag_id(cls, bag_id):
        """Get cash bag assignment by bag_id."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = "SELECT * FROM cash_bag_assignments WHERE bag_id = %s"
                cursor.execute(sql, (bag_id,))
                row = cursor.fetchone()
                return cls.from_dict(row) if row else None

    @classmethod
    def get_by_date(cls, assignment_date):
        """Get all cash bag assignments for a specific date."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = """
                    SELECT * FROM cash_bag_assignments 
                    WHERE assignment_date = %s
                    ORDER BY source_system, source_identifier
                """
                cursor.execute(sql, (assignment_date,))
                rows = cursor.fetchall()
                return [cls.from_dict(row) for row in rows]

    @classmethod
    def get_unverified(cls):
        """Get all cash bags that haven't been verified yet."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = """
                    SELECT cba.* 
                    FROM cash_bag_assignments cba
                    LEFT JOIN cash_bag_verifications cbv ON cba.bag_id = cbv.bag_id
                    WHERE cbv.id IS NULL
                    ORDER BY cba.assignment_date DESC
                """
                cursor.execute(sql)
                rows = cursor.fetchall()
                return [cls.from_dict(row) for row in rows]


class CashBagVerification:
    """Model for cash bag verification records when bags are counted."""

    def __init__(
        self,
        id=None,
        bag_id=None,
        counted_amount=None,
        counted_by=None,
        variance=None,
        notes=None,
        verified_at=None,
    ):
        self.id = id
        self.bag_id = bag_id
        self.counted_amount = counted_amount
        self.counted_by = counted_by  # Employee/user who counted
        self.variance = variance  # counted_amount - expected_amount
        self.notes = notes
        self.verified_at = verified_at

    def to_dict(self):
        """Convert to dict for serialization."""
        return {
            "id": self.id,
            "bag_id": self.bag_id,
            "counted_amount": float(self.counted_amount)
            if self.counted_amount
            else 0.0,
            "counted_by": self.counted_by,
            "variance": float(self.variance) if self.variance else 0.0,
            "notes": self.notes,
            "verified_at": self.verified_at,
        }

    @classmethod
    def from_dict(cls, data):
        """Create instance from DB row dict."""
        return cls(
            id=data.get("id"),
            bag_id=data.get("bag_id"),
            counted_amount=data.get("counted_amount"),
            counted_by=data.get("counted_by"),
            variance=data.get("variance"),
            notes=data.get("notes"),
            verified_at=data.get("verified_at"),
        )

    @classmethod
    def create(cls, bag_id, counted_amount, counted_by, notes=None):
        """
        Create a new cash bag verification record.

        Args:
            bag_id: The bag identifier being verified
            counted_amount: The actual counted cash amount
            counted_by: Name/ID of person who counted
            notes: Optional notes about the count

        Returns:
            CashBagVerification instance with calculated variance
        """
        # Get the expected amount from the assignment
        assignment = CashBagAssignment.get_by_bag_id(bag_id)
        if not assignment:
            raise ValueError(f"No cash bag assignment found for bag_id: {bag_id}")

        variance = counted_amount - assignment.expected_amount

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = """
                    INSERT INTO cash_bag_verifications 
                    (bag_id, counted_amount, counted_by, variance, notes)
                    VALUES (%s, %s, %s, %s, %s)
                """
                cursor.execute(
                    sql, (bag_id, counted_amount, counted_by, variance, notes)
                )
                conn.commit()
                verification_id = cursor.lastrowid

        return cls.get_by_id(verification_id)

    @classmethod
    def get_by_id(cls, verification_id):
        """Get verification by ID."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = "SELECT * FROM cash_bag_verifications WHERE id = %s"
                cursor.execute(sql, (verification_id,))
                row = cursor.fetchone()
                return cls.from_dict(row) if row else None

    @classmethod
    def get_by_bag_id(cls, bag_id):
        """Get verification for a specific bag."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = "SELECT * FROM cash_bag_verifications WHERE bag_id = %s"
                cursor.execute(sql, (bag_id,))
                row = cursor.fetchone()
                return cls.from_dict(row) if row else None

    @classmethod
    def get_with_assignment(cls, bag_id):
        """
        Get verification along with assignment data for complete view.

        Returns:
            Dict with both verification and assignment data
        """
        verification = cls.get_by_bag_id(bag_id)
        assignment = CashBagAssignment.get_by_bag_id(bag_id)

        if not verification or not assignment:
            return None

        return {
            "bag_id": bag_id,
            "assignment": assignment.to_dict(),
            "verification": verification.to_dict(),
        }

    @classmethod
    def get_all_with_assignments(cls):
        """Get all verifications with their assignment data."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                sql = """
                    SELECT 
                        cba.*,
                        cbv.id as verification_id,
                        cbv.counted_amount,
                        cbv.counted_by,
                        cbv.variance,
                        cbv.notes,
                        cbv.verified_at
                    FROM cash_bag_assignments cba
                    INNER JOIN cash_bag_verifications cbv ON cba.bag_id = cbv.bag_id
                    ORDER BY cbv.verified_at DESC
                """
                cursor.execute(sql)
                rows = cursor.fetchall()

                results = []
                for row in rows:
                    assignment = CashBagAssignment.from_dict(row)
                    verification = cls(
                        id=row["verification_id"],
                        bag_id=row["bag_id"],
                        counted_amount=row["counted_amount"],
                        counted_by=row["counted_by"],
                        variance=row["variance"],
                        notes=row["notes"],
                        verified_at=row["verified_at"],
                    )
                    results.append(
                        {
                            "assignment": assignment.to_dict(),
                            "verification": verification.to_dict(),
                        }
                    )

                return results
