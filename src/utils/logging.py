import csv
import io
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


class CsvFormatter(logging.Formatter):
    """
    Produce a single CSV row per record, properly quoted/escaped.
    Does NOT append a trailing newline (handler.terminator supplies that).
    """

    def format(self, record):
        # Use base class to format time if needed
        timestamp = self.formatTime(record)
        row = [timestamp, record.name, record.levelname, record.getMessage()]
        sio = io.StringIO()
        writer = csv.writer(sio)
        writer.writerow(row)
        # writer.writerow appends newline; remove it so handler adds terminator consistently
        return sio.getvalue().rstrip("\r\n")


def setup_logger(name: str) -> logging.Logger:
    # Create logs directory if it doesn't exist
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    # Create logger
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    # Avoid adding handlers multiple times (useful in REPL/tests)
    if logger.handlers:
        return logger

    # File + rotating handler
    log_file = log_dir / "inventory_updates.log"

    # Write header if file is new/empty
    header = ["timestamp", "name", "level", "message"]
    if not log_file.exists() or log_file.stat().st_size == 0:
        with log_file.open("a", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(header)

    file_handler = RotatingFileHandler(
        filename=str(log_file),
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )

    # Ensure a newline is appended after each formatted record
    file_handler.terminator = "\n"

    # Console handler (human friendly)
    console_handler = logging.StreamHandler()

    # Set formatters
    file_handler.setFormatter(CsvFormatter())
    console_handler.setFormatter(
        logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    )

    # Add handlers
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    # Prevent double logging if root logger also handles records
    logger.propagate = False

    return logger
