import phonenumbers
from phonenumbers import NumberParseException

from src.repositories.mysql import get_db_connection
from src.services.barcode import generate_barcode


class GroupBooking:
    def __init__(
        self,
        id=None,
        group_name=None,
        contact_person=None,
        mobile_number=None,
        visit_date=None,
        barcode=None,
    ):
        self.id = id
        self.group_name = group_name
        self.contact_person = contact_person
        self.mobile_number = mobile_number
        self.visit_date = visit_date
        self.barcode = barcode
        if mobile_number:
            self.validate_mobile_number()  # Run validation on init if provided

    def validate(self):
        """Validate all fields (call before save/update)."""
        if not all(
            [self.group_name, self.contact_person, self.mobile_number, self.visit_date]
        ):
            raise ValueError(
                "All fields (group_name, contact_person, mobile_number, visit_date) are required."
            )
        self.validate_mobile_number()

    def validate_mobile_number(self):
        """Validate and normalize mobile number."""
        try:
            parsed = phonenumbers.parse(self.mobile_number, "ZA")
            if not phonenumbers.is_valid_number(parsed):
                raise ValueError("Invalid mobile number.")
            self.mobile_number = phonenumbers.format_number(
                parsed, phonenumbers.PhoneNumberFormat.E164
            ).replace("+", "")
        except NumberParseException:
            raise ValueError("Invalid mobile number format.")

    def requires_new_ticket(self, new_group_name, new_visit_date, new_mobile_number):
        """
        Check if ticket-related fields have changed (group_name, visit_date, mobile_number),
        that require sending an updated ticket
        """
        existing_group_name = (self.group_name or "").strip()
        new_group_name = (new_group_name or "").strip()

        existing_visit_raw = self.visit_date
        if hasattr(existing_visit_raw, "isoformat"):
            existing_visit_date = existing_visit_raw.isoformat()
        else:
            existing_visit_date = str(existing_visit_raw or "").strip()
        new_visit_date = str(new_visit_date or "").strip()

        existing_mobile = (self.mobile_number or "").strip()
        new_mobile = (
            new_mobile_number or ""
        ).strip()  # Compare before normalization, as in original

        return (
            existing_group_name != new_group_name
            or existing_visit_date != new_visit_date
            or existing_mobile != new_mobile
        )

    @property
    def mobile_number_display(self):
        """Formatter for display (national format)."""
        if not self.mobile_number:
            return ""
        parsed = phonenumbers.parse(self.mobile_number, "ZA")
        return phonenumbers.format_number(
            parsed, phonenumbers.PhoneNumberFormat.NATIONAL
        )

    def to_dict(self):
        """Convert to dict for serialization or DB ops."""
        return {
            "id": self.id,
            "group_name": self.group_name,
            "contact_person": self.contact_person,
            "mobile_number": self.mobile_number,
            "visit_date": self.visit_date,
            "barcode": self.barcode,
            "mobile_number_display": self.mobile_number_display,
        }

    @classmethod
    def from_dict(cls, data):
        """Create instance from DB row dict."""
        return cls(
            id=data.get("id"),
            group_name=data.get("group_name"),
            contact_person=data.get("contact_person"),
            mobile_number=data.get("mobile_number"),
            visit_date=data.get("visit_date"),
            barcode=data.get("barcode"),
        )

    @classmethod
    def create(cls, group_name, contact_person, mobile_number, visit_date):
        """Create a new group booking."""
        barcode = generate_barcode()

        booking = cls(
            group_name=group_name,
            contact_person=contact_person,
            mobile_number=mobile_number,
            visit_date=visit_date,
            barcode=barcode,
        )
        booking.validate()
        with get_db_connection() as conn:  # Use shared connection
            with conn.cursor() as cursor:
                sql = """
                    INSERT INTO group_bookings 
                    (group_name, contact_person, mobile_number, visit_date, barcode)
                    VALUES (%s, %s, %s, %s, %s)
                """
                cursor.execute(
                    sql,
                    (
                        booking.group_name,
                        booking.contact_person,
                        booking.mobile_number,
                        booking.visit_date,
                        booking.barcode,
                    ),
                )
                conn.commit()
                booking.id = cursor.lastrowid
        return booking

    def save(self):
        """Update an existing group booking (instance method for updates)."""
        self.validate()
        with get_db_connection() as conn:  # Use shared connection
            with conn.cursor() as cursor:
                sql = """
                    UPDATE group_bookings 
                    SET group_name = %s,
                        contact_person = %s,
                        mobile_number = %s,
                        visit_date = %s
                    WHERE id = %s
                """
                cursor.execute(
                    sql,
                    (
                        self.group_name,
                        self.contact_person,
                        self.mobile_number,
                        self.visit_date,
                        self.id,
                    ),
                )
                conn.commit()
                return cursor.rowcount > 0

    def update(
        self, group_name=None, contact_person=None, mobile_number=None, visit_date=None
    ):
        """
        Update the instance with new values, validate, save, and return
        the fresh updated instance (or None on failure).
        """
        if group_name is not None:
            self.group_name = group_name
        if contact_person is not None:
            self.contact_person = contact_person
        if mobile_number is not None:
            self.mobile_number = mobile_number
        if visit_date is not None:
            self.visit_date = visit_date

        self.validate()

        success = self.save()
        if success:
            # Reload fresh from DB and return it
            return self.__class__.get_by_id(self.id)
        return None

    @classmethod
    def get_all(cls):
        """Get all group bookings as list of GroupBooking instances."""
        with get_db_connection() as conn:  # Use shared connection
            with conn.cursor() as cursor:
                sql = "SELECT * FROM group_bookings ORDER BY visit_date DESC"
                cursor.execute(sql)
                rows = cursor.fetchall()
                return [cls.from_dict(row) for row in rows]

    @classmethod
    def get_formatted(cls):
        """Get all bookings with formatting (uses model properties)."""
        return [booking.to_dict() for booking in cls.get_all()]

    @classmethod
    def get_by_barcode(cls, barcode):
        """Get a specific booking by barcode as GroupBooking instance."""
        with get_db_connection() as conn:  # Use shared connection
            with conn.cursor() as cursor:
                sql = "SELECT * FROM group_bookings WHERE barcode = %s"
                cursor.execute(sql, (barcode,))
                row = cursor.fetchone()
                return cls.from_dict(row) if row else None

    @classmethod
    def get_by_id(cls, booking_id):
        """Get a specific booking by ID as GroupBooking instance."""
        with get_db_connection() as conn:  # Use shared connection
            with conn.cursor() as cursor:
                sql = "SELECT * FROM group_bookings WHERE id = %s"
                cursor.execute(sql, (booking_id,))
                row = cursor.fetchone()
                return cls.from_dict(row) if row else None

    @classmethod
    def get_by_date(cls, visit_date):
        """Get all group bookings for a specific date as list of GroupBooking instances."""
        with get_db_connection() as conn:  # Use shared connection
            with conn.cursor() as cursor:
                sql = "SELECT * FROM group_bookings WHERE visit_date = %s"
                cursor.execute(sql, (visit_date,))
                rows = cursor.fetchall()
                return [cls.from_dict(row) for row in rows]

    @classmethod
    def delete(cls, booking_id):
        """Delete a group booking by ID."""
        with get_db_connection() as conn:  # Use shared connection
            with conn.cursor() as cursor:
                sql = "DELETE FROM group_bookings WHERE id = %s"
                cursor.execute(sql, (booking_id,))
                conn.commit()
                return cursor.rowcount > 0
