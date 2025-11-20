from contextlib import contextmanager

import pymysql
from flask import current_app


@contextmanager
def get_db_connection():
    """Context manager for database connections"""
    connection = pymysql.connect(
        host=current_app.config["MYSQL_HOST"],
        user=current_app.config["MYSQL_USER"],
        password=current_app.config["MYSQL_PASSWORD"],
        database=current_app.config["MYSQL_DB"],
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        yield connection
    finally:
        connection.close()


def create_group_booking(
    group_name, contact_person, mobile_number, visit_date, barcode
):
    """Create a new group booking with contact information"""
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            sql = """
                INSERT INTO group_bookings 
                (group_name, contact_person, mobile_number, visit_date, barcode)
                VALUES (%s, %s, %s, %s, %s)
            """
            cursor.execute(
                sql, (group_name, contact_person, mobile_number, visit_date, barcode)
            )
            conn.commit()
            return cursor.lastrowid


def get_all_group_bookings():
    """Get all group bookings"""
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            sql = "SELECT * FROM group_bookings ORDER BY visit_date DESC"
            cursor.execute(sql)
            return cursor.fetchall()


def get_booking_by_barcode(barcode):
    """Get a specific booking by barcode"""
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            sql = "SELECT * FROM group_bookings WHERE barcode = %s"
            cursor.execute(sql, (barcode,))
            return cursor.fetchone()


def get_booking_by_id(booking_id):
    """Get a specific booking by ID"""
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            sql = "SELECT * FROM group_bookings WHERE id = %s"
            cursor.execute(sql, (booking_id,))
            return cursor.fetchone()


def update_group_booking(
    booking_id, group_name, contact_person, mobile_number, visit_date
):
    """Update an existing group booking"""
    with get_db_connection() as conn:
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
                sql, (group_name, contact_person, mobile_number, visit_date, booking_id)
            )
            conn.commit()
            return cursor.rowcount > 0


def delete_group_booking(booking_id):
    """Delete a group booking"""
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            sql = "DELETE FROM group_bookings WHERE id = %s"
            cursor.execute(sql, (booking_id,))
            conn.commit()
            return cursor.rowcount > 0
