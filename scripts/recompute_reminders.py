"""Recompute booking reminders from the current booking state.

Scheduled daily (06:30 SAST) by the scheduler container; also runnable on
demand from the Ops page (``POST /ops/run {"name": "recompute_reminders"}``).
"""

from __future__ import annotations

import sys

from src.services.reminders import recompute_reminders
from src.utils.logging import setup_logger


def main() -> None:
    logger = setup_logger("recompute_reminders")
    try:
        count = recompute_reminders()
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Reminder recompute failed: {type(exc).__name__}: {exc}")
        sys.exit(1)
    print(f"{count} reminders apply")


if __name__ == "__main__":
    main()
