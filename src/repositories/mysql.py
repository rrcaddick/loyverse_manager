from contextlib import contextmanager

import pymysql

from config.settings import MYSQL_DB, MYSQL_HOST, MYSQL_PASSWORD, MYSQL_USER


@contextmanager
def get_db_connection():
    """Reusable context manager for MySQL database connections.

    Import and use this in any model or service that needs DB access.
    """
    connection = pymysql.connect(
        host=MYSQL_HOST,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DB,
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        yield connection
    finally:
        connection.close()
