#!/usr/bin/env python3
import os
import sys
import traceback

# Adjust this import to your project layout
from src.repositories.mysql import get_db_connection

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "..", "migrations")


def load_sql_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def split_sql_statements(raw_sql: str) -> list[str]:
    """
    Very simple SQL splitter:
    - Removes lines starting with `--` (comments).
    - Splits on `;`.
    - Strips whitespace and drops empty statements.

    This is good enough for typical migration files that do not
    contain semicolons inside string literals.
    """
    # Remove full-line comments
    lines = []
    for line in raw_sql.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("--") or stripped == "":
            continue
        lines.append(line)

    sql_no_comments = "\n".join(lines)

    # Split on semicolons
    parts = sql_no_comments.split(";")
    statements = []
    for part in parts:
        stmt = part.strip()
        if stmt:
            statements.append(stmt)
    return statements


def ensure_schema_migrations_table(cursor) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            filename VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
          DEFAULT CHARSET = utf8mb4
          COLLATE = utf8mb4_unicode_ci;
        """
    )


def get_applied_migrations(cursor) -> set[str]:
    cursor.execute("SELECT filename FROM schema_migrations")
    rows = cursor.fetchall()
    # rows is a list of dicts if you use DictCursor
    return {row["filename"] for row in rows}


def run_migrations() -> None:
    if not os.path.isdir(MIGRATIONS_DIR):
        print(f"Migration directory not found: {MIGRATIONS_DIR}")
        sys.exit(1)

    migration_files = sorted(
        f
        for f in os.listdir(MIGRATIONS_DIR)
        if f.endswith(".sql") and os.path.isfile(os.path.join(MIGRATIONS_DIR, f))
    )

    if not migration_files:
        print("No migration files found, nothing to do.")
        return

    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            # Make sure tracking table exists
            ensure_schema_migrations_table(cursor)
            conn.commit()

            applied = get_applied_migrations(cursor)

            for fname in migration_files:
                if fname in applied:
                    print(f"[SKIP] {fname} (already applied)")
                    continue

                full_path = os.path.join(MIGRATIONS_DIR, fname)
                print(f"[RUN ] {fname}")

                raw_sql = load_sql_file(full_path)
                statements = split_sql_statements(raw_sql)

                if not statements:
                    print(f"[WARN] {fname} is empty after parsing, skipping.")
                    continue

                try:
                    # Start transaction for this migration file
                    conn.begin()

                    for stmt in statements:
                        # Debug: print the statement if needed
                        # print(f"Executing:\n{stmt}\n")
                        cursor.execute(stmt)

                    # Record migration as applied
                    cursor.execute(
                        "INSERT INTO schema_migrations (filename) VALUES (%s)",
                        (fname,),
                    )

                    # Commit everything for this migration
                    conn.commit()
                    print(f"[OK  ] {fname}")

                except Exception as exc:
                    # Roll back everything from this migration file
                    conn.rollback()
                    print(f"[FAIL] {fname}")
                    print(f"Error: {exc}")
                    traceback.print_exc()
                    # Stop running further migrations
                    raise


def main():
    try:
        run_migrations()
    except Exception:
        sys.exit(1)


if __name__ == "__main__":
    main()
