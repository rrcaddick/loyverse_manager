"""The daily sending pass (6 Nov 2026).

    python -m scripts.sending_pass            # expire, then send what the rules say (prod only)
    python -m scripts.sending_pass --plan     # only report what would happen
    python -m scripts.sending_pass --force    # send outside prod too (the dev redirect still applies)

Expiry is automatic whatever the rules: pending bookings past their expiry
date without the deposit become Expired. Sends happen only for rules set to
Automatic on Settings › Sending rules, only while the master switch is on,
and only on prod unless forced. The worker runs it after the reminder
recompute (SENDING_CRON, default 15 7 * * *).
"""

from __future__ import annotations

import argparse
import json
import sys

from config.settings import ENV
from src.utils.logging import setup_logger


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", action="store_true", help="report only, change nothing")
    ap.add_argument("--force", action="store_true", help="send outside prod as well")
    args = ap.parse_args(argv)
    logger = setup_logger("sending_pass")

    from web.api.bookings import run_automatic_sends
    from web.app import create_app

    app = create_app()
    send = not args.plan and (ENV == "prod" or args.force)
    with app.test_request_context():
        if args.plan:
            from src.services import sending

            print(json.dumps(sending.preview(), indent=2, default=str))
            return 0
        result = run_automatic_sends(send=send)
    if not send:
        logger.info(f"Sending pass on {ENV}: expired {len(result['expired'])}, would send {len(result['sent'])} (not prod; use --force to send)")
    else:
        logger.info(f"Sending pass: expired {len(result['expired'])}, sent {len(result['sent'])}, failed {len(result['failed'])}, skipped {len(result['skipped'])}")
    for f in result["failed"]:
        logger.error(f"  failed {f['rule']} {f['reference']}: {f['error']}")
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
