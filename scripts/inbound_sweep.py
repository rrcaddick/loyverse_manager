#!/usr/bin/env python3
"""Run the inbound sweep once (pending forms -> enquiries, the hand-applied
label, Gmail labels). Safe to run any time; the worker runs it on a timer."""

from __future__ import annotations

import json
import sys


def main() -> int:
    from src.services.inbound import sweep

    print(json.dumps(sweep(), default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
