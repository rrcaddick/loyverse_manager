"""Create a portal user from the command line.

    python -m scripts.create_user --email linda@example.com --name "Linda Caddick" --role admin
    docker compose run --rm web python -m scripts.create_user --email ... --name ... --role manager

Without ``--password`` a temporary password is generated, printed once, and
the user must change it at first login.
"""

from __future__ import annotations

import argparse
import sys

from src.models.user import ROLES
from src.services.users import UserError, create_user


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a portal user")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True, help="Full name shown in the app")
    parser.add_argument("--role", required=True, choices=ROLES)
    parser.add_argument(
        "--password",
        help="Set this password instead of a generated temporary one (no forced change)",
    )
    args = parser.parse_args(argv)
    try:
        user, password = create_user(args.email, args.name, args.role, args.password)
    except UserError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"Created {user['email']} ({user['role']}), id {user['id']}.")
    if args.password:
        print("Password set as given.")
    else:
        print(f"Temporary password (shown once): {password}")
        print("They must choose a new password at first login.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
