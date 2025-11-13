import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logger(name):
    # Create logs directory if it doesn't exist
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    # Create logger
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    # Create rotating file handler (10 MB max size, keep 5 backup files)
    log_file = log_dir / "inventory_updates.log"
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
    )
    console_handler = logging.StreamHandler()

    # Create formatters and add it to handlers
    # CSV format for file logging
    file_format = logging.Formatter("%(asctime)s,%(name)s,%(levelname)s,%(message)s")
    # More readable format for console
    console_format = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    file_handler.setFormatter(file_format)
    console_handler.setFormatter(console_format)

    # Add handlers to the logger
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    return logger
