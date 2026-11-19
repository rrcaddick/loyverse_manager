"""Recompute booking reminders from the current booking state.

Scheduled daily (06:30 SAST) by the scheduler container; also runnable on
demand from the Ops page (``POST /ops/run {"name": "recompute_reminders"}``).
Besides upserting the due rows it applies the stale rule (``reminders.flag_stale``)
so the Work counts only promise what a person can still act on.
"""

from __future__ import annotations

import sys

from src.services.reminders import due_reminder_count, recompute_reminders, stale_reminder_ids
from src.utils.logging import setup_logger


def main() -> None:
    logger = setup_logger("recompute_reminders")
    try:
        count = recompute_reminders()
        live = due_reminder_count()
        stale = len(stale_reminder_ids())
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Reminder recompute failed: {type(exc).__name__}: {exc}")
        sys.exit(1)
    print(f"{count} reminders apply: {live} due now, {stale} stale")


if __name__ == "__main__":
    main()
