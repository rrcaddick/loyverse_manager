#!/usr/bin/env python3
"""Manage self-managed POS staff from the command line (until the portal pages exist).

    pos-staff roles                                 list roles and their permissions
    pos-staff roles add "Gate lead" --perm ACCESS_LPOS --perm bridge.manual_plate [--description ...]
    pos-staff roles set-perms <role id> --perm ... [--perm ...]
    pos-staff roles rename <role> --to "Payment Marshal" [--description ...]
    pos-staff permissions                           list every permission name

    pos-staff employees [--all]                     list employees (active only by default)
    pos-staff employees add "Thandi" --role Cashier --pin 2580      a live login (the real account's
                                                    terminals); --training = a training login
                                                    (the throwaway account's terminals);
                                                    --random-pin prints a policy-passing PIN once
    pos-staff employees set-scope <employee id> --to live|training
    pos-staff employees set-pin <employee id> --pin 4719
    pos-staff employees clear-pin <employee id>
    pos-staff employees deactivate <employee id> | activate <employee id>
    pos-staff employees set-role <employee id> --role Manager
    pos-staff employees rename <employee id> --to "Ray"   (first names: it prints on receipts)

    pos-staff devices                               list enrolled terminals
    pos-staff devices enrol p5-till-1 [--note "Front gate P5"]
                                                    prints the secret ONCE; put it in that
                                                    terminal's bridge config as staff.deviceSecret
    pos-staff devices revoke p5-till-1 | activate p5-till-1

    pos-staff events [--limit 50] [--employee <id>] [--device <id>] [--event login]
    pos-staff reductions [--days 1]                 saved tickets whose value went down, by whom,
                                                    and whether a (cash) sale on them followed
    pos-staff reentries [--days 1]                  re-entry passes issued: plate, heads vs the
                                                    paid admission, who, how each one ended
    pos-staff items                                 what the Loyverse items mean to the gate and
                                                    whether the live account still matches
    pos-staff groups [--days 1]                     who entered under each group ticket (surname,
                                                    initials, ID number, how it was captured)
    pos-staff disputes [--all] [--days 30]          refund disputes logged at the terminals (open
                                                    ones by default)
    pos-staff disputes show RD-7K3M9P               one dispute with the plate's events that day
    pos-staff disputes resolve RD-7K3M9P --status approved|declined|refunded|investigating
                                        [--note "..."] [--by Ray]
    pos-staff conversions [--days 7] [--all]        group conversions (public sale moved onto a
                                                    group ticket) and how far each got
    pos-staff conversions show <conversion id>      one conversion in full
    pos-staff roles grant Manager bridge.convert_group   add one permission to an existing role
    pos-staff roles set-categories "Ticket Marshal" --category Public --category "Online Tickets"
                                                    which sales-screen categories the role may
                                                    pick (Public always; --all-categories = every one)
    pos-staff disputes reply RD-7K3M9P --text "..." [--by Ray]   e-mails the customer (when an
                                                    address was given) and records the answer
    pos-staff accounts                              the Loyverse accounts the terminals report
                                                    (owner id, name, e-mail, which one is live,
                                                    rows per table, terminals on each)
    pos-staff accounts purge <owner id> --yes       delete every row that account's terminals
                                                    wrote (tickets, events, disputes, conversions);
                                                    "untagged" = rows from builds before the tag
    pos-staff accounts adopt <owner id>             tag those untagged rows as this account's
    pos-staff accounts live [<owner id>|auto]       pin the live account, or go back to matching
                                                    the API token's merchant e-mail
Every listing shows the live account's rows; --account <owner id> (before the command) shows
another account's, --account all every account's.
PINs are entered on the command line only here; they are hashed before they touch the DB.
"""

import argparse
import contextlib
import json
import os
import sys
from src.models.pos_accounts import PosAccount, scope
from src.models.pos_staff import PosDevice, PosEmployee, PosEmployeeEvent, PosRole
from src.services.pos_accounts import PosAccountService
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
            cats = r.get("sales_categories")
            print(f"      categories: {'all' if cats is None else ', '.join(cats)}")
    elif args.action == "set-categories":
        cats = None if args.all_categories else [c.strip() for c in (args.category or []) if c.strip()]
        if cats is not None and not cats:
            sys.exit("give --category <name> (repeatable) or --all-categories")
        r = svc.update_role(_role_id(args.name), sales_categories=cats)
        cats = r.get("sales_categories")
        print(f"role {r['id']} {r['name']}: categories {'all' if cats is None else ', '.join(cats)}")
    elif args.action == "add":
        r = svc.create_role(args.name, args.description or "", args.perm or [])
        print(f"created role {r['id']} {r['name']}")
    elif args.action == "set-perms":
        r = svc.update_role(_role_id(args.name), permissions=args.perm or [])
        print(f"role {r['id']} {r['name']}: {', '.join(r['permissions'])}")
    elif args.action == "rename":
        if not args.to and args.description is None:
            sys.exit("give --to and/or --description")
        r = svc.update_role(_role_id(args.name), name=args.to, description=args.description)
        print(f"role {r['id']} {r['name']}: {r['description']}")
    elif args.action == "grant":
        if getattr(args, "permission", None):
            args.perm = (args.perm or []) + [args.permission]
        if not args.perm:
            sys.exit("give --perm <permission> (or the permission as the second argument)")
        role = PosRole.get(_role_id(args.name))
        wanted = [p for p in args.perm if p not in role["permissions"]]
        r = svc.update_role(role["id"], permissions=role["permissions"] + wanted)
        print(f"role {r['id']} {r['name']}: {', '.join(r['permissions'])}" + ("" if wanted else "  (already held)"))


def cmd_permissions(args, svc):
    for p in PERMISSIONS:
        print(p)


def cmd_employees(args, svc):
    if args.action == "list":
        for e in PosEmployee.all(include_inactive=args.all):
            flags = ("" if e["active"] else " INACTIVE") + ("" if e["has_pin"] else " NO-PIN")
            print(f"{e['id']:>3}  {e['name']:<24} {e['role_name']:<16} {e['scope']:<9}{flags}")
    elif args.action == "add":
        pin = svc.random_pin() if args.random_pin else args.pin
        scope = "training" if args.training else "live"
        e = svc.create_employee(args.name, _role_id(args.role), pin=pin, scope=scope)
        print(f"created employee {e['id']} {e['name']} ({e['role_name']}, {scope}){'' if e['has_pin'] else ', no PIN yet'}")
        if args.random_pin:
            print(f"PIN for {e['name']} (shown once): {pin}")
    elif args.action == "set-scope":
        if args.to not in ("live", "training"):
            sys.exit("--to live|training")
        e = svc.set_scope(int(args.name), args.to)
        print(f"{e['name']} is now a {args.to} login")
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
    elif args.action == "rename":
        if not args.to:
            sys.exit("--to required")
        PosEmployee.update(int(args.name), name=args.to.strip())
        print(f"employee {args.name} is now {args.to.strip()!r}")
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


def cmd_accounts(args, svc):
    if args.action == "list":
        PosAccountService.refresh_live()
        rows = PosAccountService.summary()
        if not rows:
            print("no terminal has reported an account yet")
            return
        print(f"{'owner id':<12} {'live':<5} {'business name':<28} {'e-mail':<32} tickets history events disputes conv  terminals")
        for r in rows:
            c = r.get("counts", {})
            name = r["account_id"] or "(untagged)"
            print(f"{name:<12} {'LIVE' if r.get('live') else '':<5} {(r.get('business_name') or '')[:28]:<28} "
                  f"{(r.get('email') or '')[:32]:<32} {c.get('open_tickets_current', 0):>7} {c.get('open_tickets_history', 0):>7} "
                  f"{c.get('pos_employee_events', 0):>6} {c.get('pos_refund_disputes', 0):>8} {c.get('pos_group_conversions', 0):>4}  "
                  f"{', '.join(c.get('devices', []))}")
    elif args.action == "purge":
        target = "" if (args.name or "").lower() == "untagged" else args.name
        if target is None:
            sys.exit("which account? pos-staff accounts purge <owner id>|untagged --yes")
        if target and target == PosAccount.live_id():
            sys.exit("that is the live account; pin another one live first (pos-staff accounts live <id>) if you mean it")
        if not args.yes:
            sys.exit("this deletes every row that account's terminals wrote; add --yes")
        for table, n in PosAccountService.purge(target).items():
            print(f"{table:<24} {n} deleted")
    elif args.action == "adopt":
        if not args.name:
            sys.exit("which account? pos-staff accounts adopt <owner id>")
        for table, n in PosAccountService.adopt_untagged(args.name).items():
            print(f"{table:<24} {n} tagged")
    elif args.action == "live":
        if not args.name or args.name == "auto":
            if os.getenv("POS_LIVE_ACCOUNT"):
                sys.exit("POS_LIVE_ACCOUNT is set in the environment; unset it to go back to matching the token")
            PosAccount.set_live(None)
            print("live account:", PosAccountService.refresh_live() or "unknown (no account's e-mail matches the API token's merchant)")
        else:
            PosAccount.set_live(args.name)
            print("live account pinned to", args.name, "(until the next 'accounts live auto'; POS_LIVE_ACCOUNT in the environment overrides)")


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


def cmd_reentries(args, svc):
    from datetime import datetime, timedelta

    from src.services.pos_reentry import ReentryService

    since = datetime.now() - timedelta(days=args.days)
    rows = ReentryService().report(since)
    if not rows:
        print(f"no re-entry passes issued since {since:%Y-%m-%d %H:%M}")
        return
    for r in rows:
        over = " OVER PAID COUNT" if r["heads"] > r["anchor_heads"] else ""
        typed = " typed" if r["typed"] else ""
        ended = {"used": f"admitted {r['used_at']:%H:%M} by {r['used_by'] or '?'}" + (f" +{r['extras_paid']} paid" if r["extras_paid"] else ""),
                 "voided": "voided", "expired": "expired unused", "open": "open"}[r["status"]]
        approved = f"  approved by {r['approved_by']}" if r["approved_by"] else ""
        print(
            f"{r['issued_at']:%Y-%m-%d %H:%M}  {r['device'] or '-':<14} {r['plate']:<10} {r['heads']:>2} heads "
            f"(paid {r['anchor_heads']}){over}{typed}  by {r['issued_by'] or '-':<18} {ended}{approved}"
        )


def cmd_groups(args, svc):
    from datetime import datetime, timedelta

    since = datetime.now() - timedelta(days=args.days)
    rows = PosEmployeeEvent.since(since, ["group_entry"])
    if not rows:
        print(f"no group entries since {since:%Y-%m-%d %H:%M}")
        return
    for r in rows:
        d = r["detail"] or {}
        person = d.get("person") or "?"
        source = d.get("source") or "?"
        flag = " MANUAL" if d.get("manual") else ""
        print(
            f"{r['occurred_at']:%Y-%m-%d %H:%M}  {r['device_id']:<14} {str(d.get('group') or '?'):<24} "
            f"{str(d.get('plate') or '-'):<10} {str(d.get('heads') or '?'):>3} heads  {person:<22} "
            f"{str(d.get('id_number') or ''):<14} {source}{flag}  by {r['employee_name'] or '-'}"
        )


def cmd_conversions(args, svc):
    from datetime import datetime, timedelta

    from src.services.pos_conversions import PosConversionService

    if args.action == "show":
        row = PosConversionService.get(args.number or "")
        if not row:
            sys.exit(f"no conversion {args.number}")
        for k, v in row.items():
            if k == "detail":
                continue
            print(f"{k:<22} {v}")
        print(json.dumps(row.get("detail") or {}, indent=2, default=str))
        return
    since = datetime.now() - timedelta(days=args.days)
    rows = PosConversionService.list(since=since)
    if not rows:
        print(f"no group conversions since {since:%Y-%m-%d}")
        return
    for r in rows:
        print(
            f"{r['recorded_at']:%Y-%m-%d %H:%M}  {r['device_id']:<14} {str(r['printed_no'] or '?'):<9} {str(r['plate'] or '-'):<10} "
            f"-> {r['group_name']:<24} {r['heads']:>3} heads  R{(r['amount_cents'] or 0) / 100:.2f}  {r['stage']:<14} "
            f"{str(r['person'] or '')}{' MANUAL' if r['id_manual'] else ''}  by {r['employee_name'] or '-'}"
            + (f"  [{r['error']}]" if r.get('error') else "")
        )


def cmd_disputes(args, svc):
    from datetime import datetime, timedelta

    from src.services.pos_disputes import PosDisputeService

    if args.action == "list":
        since = datetime.now() - timedelta(days=args.days)
        rows = PosDisputeService.list(open_only=not args.all, since=since)
        if not rows:
            print("no " + ("" if args.all else "open ") + f"refund disputes since {since:%Y-%m-%d}")
            return
        for r in rows:
            amount = f"R{r['amount_cents'] / 100:.2f}" if r["amount_cents"] is not None else "R?"
            print(
                f"{r['dispute_number']:<10} {r['status']:<13} {r['logged_at']:%Y-%m-%d %H:%M}  {r['device_id']:<14} "
                f"{r['printed_no'] or '?':<8} {r['plate'] or '-':<10} {amount:>9} {r['payment_summary'] or '':<16} "
                f"{r['customer_name']:<20} {r['customer_mobile'] or r['customer_email'] or '-'}"
            )
        return
    if not args.number:
        sys.exit("dispute number required")
    if args.action == "show":
        d = PosDisputeService.get(args.number)
        if not d:
            sys.exit(f"no dispute {args.number}")
        for key in ("dispute_number", "status", "logged_at", "device_id", "employee_name", "trigger_kind", "refusal",
                    "printed_no", "order_number", "plate", "sale_at", "register", "sold_by", "amount_cents",
                    "payment_summary", "transaction_code", "customer_name", "customer_email", "customer_mobile",
                    "reason", "resolution", "resolved_by", "resolved_at", "reply", "replied_at"):
            print(f"{key:<17} {d.get(key) if d.get(key) is not None else ''}")
        print("history (that plate, that day):")
        for e in d["history"]:
            who = e["employee_name"] or "-"
            print(f"  {e['occurred_at']:%H:%M:%S}  {e['device_id']:<14} {e['event']:<16} {who:<18} {json.dumps(e['detail'])[:160]}")
        return
    if args.action == "resolve":
        d = PosDisputeService.resolve(args.number, args.status, args.note, args.by)
        print(f"{d['dispute_number']} is now {d['status']}")
        return
    if args.action == "reply":
        if not args.text:
            sys.exit("--text required")
        channels = PosDisputeService.reply(args.number, args.text, args.by)
        print(f"reply recorded" + (f", sent by {', '.join(channels)}" if channels else " (no e-mail address; nothing sent)"))


def cmd_items(args, svc):
    from src.services.pos_items import ItemKinds

    kinds = ItemKinds.current()
    print("re-entry SKU:   ", kinds.reentry_sku)
    print("head SKUs:      ", ", ".join(kinds.head_skus))
    print("head categories:", ", ".join(kinds.head_categories))
    print("cut-off:        ", kinds.cutoff)
    problems = kinds.verify()
    print("live account:   ", "matches" if not problems else "PROBLEMS")
    for p in problems:
        print("  -", p)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--account", help="owner id whose rows to show (default: the live account's; 'all' = every account's)")
    sub = parser.add_subparsers(dest="group", required=True)

    accounts = sub.add_parser("accounts")
    accounts.add_argument("action", nargs="?", default="list", choices=["list", "purge", "adopt", "live"])
    accounts.add_argument("name", nargs="?", help="owner id ('untagged' for rows from builds before the tag; 'auto' for live)")
    accounts.add_argument("--yes", action="store_true")
    roles = sub.add_parser("roles")
    roles.add_argument("action", nargs="?", default="list", choices=["list", "add", "set-perms", "rename", "grant", "set-categories"])
    roles.add_argument("name", nargs="?")
    roles.add_argument("permission", nargs="?", help="for 'grant': the permission to add")
    roles.add_argument("--description")
    roles.add_argument("--to", help="new name for 'rename'")
    roles.add_argument("--perm", action="append")
    roles.add_argument("--category", action="append", help="for 'set-categories': a sales-screen category name (repeatable)")
    roles.add_argument("--all-categories", action="store_true", help="for 'set-categories': every category")
    sub.add_parser("permissions")

    employees = sub.add_parser("employees")
    employees.add_argument(
        "action", nargs="?", default="list",
        choices=["list", "add", "set-pin", "clear-pin", "deactivate", "activate", "set-role", "rename", "set-scope"],
    )
    employees.add_argument("name", nargs="?", help="employee name (add) or id (other actions)")
    employees.add_argument("--role")
    employees.add_argument("--pin")
    employees.add_argument("--random-pin", action="store_true", help="make a PIN and print it once")
    employees.add_argument("--training", action="store_true", help="a training login (default: live)")
    employees.add_argument("--all", action="store_true")
    employees.add_argument("--to", help="new name for 'rename'; live|training for 'set-scope'")

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
    reentries = sub.add_parser("reentries")
    reentries.add_argument("--days", type=int, default=1)
    sub.add_parser("items")
    groups = sub.add_parser("groups")
    groups.add_argument("--days", type=int, default=1)
    conversions = sub.add_parser("conversions")
    conversions.add_argument("action", nargs="?", default="list", choices=["list", "show"])
    conversions.add_argument("number", nargs="?", help="conversion id (uuid)")
    conversions.add_argument("--days", type=int, default=7)
    conversions.add_argument("--all", action="store_true")
    disputes = sub.add_parser("disputes")
    disputes.add_argument("action", nargs="?", default="list", choices=["list", "show", "resolve", "reply"])
    disputes.add_argument("number", nargs="?", help="dispute number, e.g. RD-7K3M9P")
    disputes.add_argument("--all", action="store_true", help="list closed disputes too")
    disputes.add_argument("--days", type=int, default=30)
    disputes.add_argument("--status")
    disputes.add_argument("--note")
    disputes.add_argument("--text")
    disputes.add_argument("--by")

    args = parser.parse_args(argv)
    svc = PosStaffService()
    chosen = None if args.account == "all" else args.account
    with scope(chosen) if args.account else contextlib.nullcontext():
        _run(args, svc)


def _run(args, svc):
    try:
        {
            "accounts": cmd_accounts,
            "roles": cmd_roles,
            "permissions": cmd_permissions,
            "employees": cmd_employees,
            "devices": cmd_devices,
            "events": cmd_events,
            "reductions": cmd_reductions,
            "reentries": cmd_reentries,
            "disputes": cmd_disputes,
            "conversions": cmd_conversions,
            "groups": cmd_groups,
            "items": cmd_items,
        }[args.group](args, svc)
    except (PinPolicyError, PinInUseError, DeviceAuthError, ValueError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
