"""Clean season import: bookings from the sheet, then their mail, then what is open.

    python -m scripts.import_season --sheet data/import/fy-bookings-2026-27.csv \
        --from-visit 2026-09-01 --open-from 2026-06-01

WIPES the local bookings, mail and reminders first. See src/services/season_import.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from src.services.season_import import run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sheet", type=Path, required=True)
    parser.add_argument("--from-visit", type=date.fromisoformat, required=True, help="Import visits on/after this date")
    parser.add_argument("--open-from", type=date.fromisoformat, required=True, help="Threads active on/after this date may be open")
    parser.add_argument("--max-expand-months", type=int, default=24)
    args = parser.parse_args(argv)
    if not args.sheet.exists():
        print(f"error: {args.sheet} not found", file=sys.stderr)
        return 1
    report = run(args.sheet, args.from_visit, args.open_from, args.max_expand_months)
    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
