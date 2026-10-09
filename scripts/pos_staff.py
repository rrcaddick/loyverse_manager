#!/usr/bin/env python3
"""Manage self-managed POS staff from the command line (until the portal pages exist).

    pos-staff roles                                 list roles and their permissions
    pos-staff roles add "Gate lead" --perm ACCESS_LPOS --perm bridge.manual_plate [--description ...]
    pos-staff roles set-perms <role id> --perm ... [--perm ...]
    pos-staff permissions                           list every permission name

    pos-staff employees [--all]                     list employees (active only by default)
    pos-staff employees add "Thandi" --role Cashier --pin 2580
    pos-staff employees set-pin <employee id> --pin 4719
    pos-staff employees clear-pin <employee id>
    pos-staff employees deactivate <employee id> | activate <employee id>
    pos-staff employees set-role <employee id> --role Manager

    pos-staff devices                               list enrolled terminals
    pos-staff devices enrol p5-till-1 [--note "Front gate P5"]
                                                    prints the secret ONCE; put it in that
                                                    terminal's bridge config as staff.deviceSecret
    pos-staff devices revoke p5-till-1 | activate p5-till-1

    pos-staff events [--limit 50] [--employee <id>] [--device <id>] [--event login]
    pos-staff reductions [--days 1]                 saved tickets whose value went down, by whom,
                                                    and whether a (cash) sale on them followed

PINs are entered on the command line only here; they are hashed before they touch the DB.
"""

import argparse
import json
import sys

from src.models.pos_staff import PosDevice, PosEmployee, PosEmployeeEvent, PosRole
from src.services.pos_staff import (
    PERMISSIONS,
    DeviceAuthError,
    PinInUseError,
    PinPolicyError,
    PosStaffService,
)


def _role_id(ref):
    if ref is None:
        return None
    if str(ref).isdigit():
        role = PosRole.get(int(ref))
    else:
        role = PosRole.get_by_name(ref)
    if role is None:
        sys.exit(f"unknown role: {ref}")
    return role["id"]


def cmd_roles(args, svc):
    if args.action == "list":
        svc.ensure_default_roles()
        for r in PosRole.all():
            print(f"{r['id']:>3}  {r['name']:<16} {r['description']}")
            print(f"      {', '.join(r['permissions'])}")
    elif args.action == "add":
        r = svc.create_role(args.name, args.description or "", args.perm or [])
        print(f"created role {r['id']} {r['name']}")
    elif args.action == "set-perms":
        r = svc.update_role(_role_id(args.name), permissions=args.perm or [])
        print(f"role {r['id']} {r['name']}: {', '.join(r['permissions'])}")


def cmd_permissions(args, svc):
    for p in PERMISSIONS:
        print(p)


def cmd_employees(args, svc):
    if args.action == "list":
        for e in PosEmployee.all(include_inactive=args.all):
            flags = ("" if e["active"] else " INACTIVE") + ("" if e["has_pin"] else " NO-PIN")
            print(f"{e['id']:>3}  {e['name']:<24} {e['role_name']:<12}{flags}")
    elif args.action == "add":
        e = svc.create_employee(args.name, _role_id(args.role), pin=args.pin)
        print(f"created employee {e['id']} {e['name']} ({e['role_name']}){'' if e['has_pin'] else ', no PIN yet'}")
    elif args.action == "set-pin":
        if not args.pin:
            sys.exit("--pin required")
        svc.set_pin(int(args.name), args.pin)
        print("PIN set")
    elif args.action == "clear-pin":
        svc.clear_pin(int(args.name))
        print("PIN cleared; the employee can no longer log in")
    elif args.action in ("deactivate", "activate"):
        svc.set_active(int(args.name), args.action == "activate")
        print(args.action + "d")
    elif args.action == "set-role":
        e = PosEmployee.update(int(args.name), role_id=_role_id(args.role))
        print(f"{e['name']} is now {e['role_name']}")


def cmd_devices(args, svc):
    if args.action == "list":
        for d in PosDevice.all():
            state = "active" if d["active"] else "REVOKED"
            print(f"{d['device_id']:<20} {state:<8} seen {d['last_seen_at'] or 'never'}  {d['note']}")
    elif args.action == "enrol":
        device, secret = svc.enrol_device(args.name, args.note or "")
        print(f"enrolled {device['device_id']}")
        print("staff.deviceSecret (shown once):")
        print(secret)
    elif args.action in ("revoke", "activate"):
        if not PosDevice.set_active(args.name, args.action == "activate"):
            sys.exit("unknown device")
        print(args.action + "d")


def cmd_events(args, svc):
    rows = PosEmployeeEvent.recent(limit=args.limit, employee_id=args.employee, device_id=args.device, event=args.event)
    for r in reversed(rows):
        who = f"{r['employee_name']} (#{r['employee_id']})" if r["employee_id"] else "-"
        detail = json.dumps(r["detail"]) if r["detail"] else ""
        print(f"{r['occurred_at']}  {r['device_id']:<14} {r['event']:<18} {who:<24} {detail}")


def cmd_reductions(args, svc):
    from datetime import datetime, timedelta

    since = datetime.now() - timedelta(days=args.days)
    rows = svc.reductions_report(since)
    if not rows:
        print(f"no reductions of saved tickets since {since:%Y-%m-%d %H:%M}")
        return
    for r in rows:
        who = r["staff"] or {}
        removed = ", ".join(f"{x['quantity'] / 1000:g} x {x['name']}" for x in r["removed"]) or "-"
        flag = " CASH SALE FOLLOWED" if r["cash_sale_after"] else (" sale followed" if r["sales_after"] else "")
        approved = ", ".join(a["approved_by"] or "?" for a in r["approvals"] if a.get("approved_by"))
        print(
            f"{r['at']}  {r['device'] or '-':<14} ticket {r['ticket'] or r['sync_id']:<12} "
            f"by {who.get('name', '-')!s:<18} removed {removed}"
            f"{'  approved by ' + approved if approved else ''}{flag}"
        )
        for s in r["sales_after"]:
            print(f"{'':>21}  -> {s['at']} sale by {s['employee_name']} {s['payments']} amount {s['amount_paid']}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="group", required=True)

    roles = sub.add_parser("roles")
    roles.add_argument("action", nargs="?", default="list", choices=["list", "add", "set-perms"])
    roles.add_argument("name", nargs="?")
    roles.add_argument("--description")
    roles.add_argument("--perm", action="append")

    sub.add_parser("permissions")

    employees = sub.add_parser("employees")
    employees.add_argument(
        "action", nargs="?", default="list",
        choices=["list", "add", "set-pin", "clear-pin", "deactivate", "activate", "set-role"],
    )
    employees.add_argument("name", nargs="?", help="employee name (add) or id (other actions)")
    employees.add_argument("--role")
    employees.add_argument("--pin")
    employees.add_argument("--all", action="store_true")

    devices = sub.add_parser("devices")
    devices.add_argument("action", nargs="?", default="list", choices=["list", "enrol", "revoke", "activate"])
    devices.add_argument("name", nargs="?", help="device id = feed.deviceName in the terminal's bridge config")
    devices.add_argument("--note")

    events = sub.add_parser("events")
    events.add_argument("--limit", type=int, default=50)
    events.add_argument("--employee", type=int)
    events.add_argument("--device")
    events.add_argument("--event")

    reductions = sub.add_parser("reductions")
    reductions.add_argument("--days", type=int, default=1)

    args = parser.parse_args(argv)
    svc = PosStaffService()
    try:
        {
            "roles": cmd_roles,
            "permissions": cmd_permissions,
            "employees": cmd_employees,
            "devices": cmd_devices,
            "events": cmd_events,
            "reductions": cmd_reductions,
        }[args.group](args, svc)
    except (PinPolicyError, PinInUseError, DeviceAuthError, ValueError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
