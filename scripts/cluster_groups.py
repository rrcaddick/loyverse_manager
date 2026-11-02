"""Put the bookings that have no group yet into groups (2 Nov 2026).

    python -m scripts.cluster_groups            # show the clusters, change nothing
    python -m scripts.cluster_groups --apply    # create the groups and link the bookings

Two bookings belong together when they share an address or a number (the
booking's own or a contact's), or carry the same distinctive name in the same
area, or the same distinctive name of two or more words. A shared address does
not join two bookings that name unrelated groups (one person, two groups).
Everything else is a group of its own. Multi-booking clusters are written to the review file so the
merges can be checked; a wrong merge is undone with "New group" on the record.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

from src.models import booking_group as group_model
from src.models.base import query
from src.services import groups
from src.utils.date import get_today

REVIEW_DIR = Path("data/migration")


def _find(parent: dict[int, int], x: int) -> int:
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _union(parent: dict[int, int], a: int, b: int) -> None:
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[max(ra, rb)] = min(ra, rb)


def clusters() -> list[list[dict]]:
    rows = query("SELECT * FROM bookings WHERE group_id IS NULL ORDER BY visit_date, id")
    contacts = defaultdict(list)
    for c in query("SELECT booking_id, email, mobile FROM booking_contacts"):
        contacts[int(c["booking_id"])].append(c)
    facts = {int(r["id"]): groups.facts_for(r, contacts.get(int(r["id"]), [])) for r in rows}
    parent = {int(r["id"]): int(r["id"]) for r in rows}
    by_email: dict[str, list[int]] = defaultdict(list)
    by_mobile: dict[str, list[int]] = defaultdict(list)
    by_name_area: dict[tuple[str, str], list[int]] = defaultdict(list)
    by_long_name: dict[str, list[int]] = defaultdict(list)
    for bid, f in facts.items():
        for e in f.emails:
            by_email[e].append(bid)
        for m in f.mobiles:
            by_mobile[m].append(bid)
        if f.name_key and f.area_key:
            by_name_area[(f.name_key, f.area_key)].append(bid)
        if len(f.name_tokens) >= 2:
            by_long_name[f.name_key].append(bid)
    def compatible(a: int, b: int) -> bool:
        # A shared address or number joins two bookings unless they name
        # unrelated groups (one person, two groups: a school and a church).
        fa, fb = facts[a], facts[b]
        return not (fa.name_tokens and fb.name_tokens and not (fa.name_tokens & fb.name_tokens))

    for index in (by_email, by_mobile):
        for ids in index.values():
            for i, first in enumerate(ids):
                for other in ids[i + 1:]:
                    if compatible(first, other):
                        _union(parent, first, other)
    for index in (by_name_area, by_long_name):
        for ids in index.values():
            for other in ids[1:]:
                _union(parent, ids[0], other)
    members: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        members[_find(parent, int(r["id"]))].append(r)
    return sorted(members.values(), key=lambda c: (-len(c), c[0]["visit_date"] or get_today()))


def _why(a: dict, b: dict) -> str:
    fa, fb = groups.facts_for(a), groups.facts_for(b)
    out = []
    if fa.emails & fb.emails:
        out.append("email")
    if fa.mobiles & fb.mobiles:
        out.append("mobile")
    if fa.name_key and fa.name_key == fb.name_key:
        out.append("name" + (" + area" if fa.area_key and fa.area_key == fb.area_key else ""))
    return ", ".join(out) or "chain"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="create the groups and link the bookings")
    ap.add_argument("--out", default=None, help="review file (default data/migration/groups-<today>.txt)")
    args = ap.parse_args(argv)

    found = clusters()
    multi = [c for c in found if len(c) > 1]
    lines = [f"Groups pass {get_today().isoformat()}: {sum(len(c) for c in found)} bookings -> {len(found)} groups, {len(multi)} with more than one booking", ""]
    for c in multi:
        head = c[-1]
        lines.append(f"== {head['group_name']} ({head.get('area') or 'no area'})")
        for b in c:
            lines.append(f"   {b['reference']}  {b['visit_date']}  {b['status']:<14} {b['group_name']}  · {b.get('contact_name') or ''} <{b.get('contact_email') or ''}>")
        if len(c) > 1:
            lines.append(f"   why: {_why(c[0], c[1])}")
        lines.append("")
    text = "\n".join(lines)
    print(text)
    out = Path(args.out) if args.out else REVIEW_DIR / f"groups-{get_today().isoformat()}.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text + "\n")
    print(f"review written to {out.resolve()}")

    if not args.apply:
        print("dry run: nothing changed (add --apply)")
        return 0
    made = linked = 0
    for c in found:
        head = c[-1]  # the most recent booking names the group
        gid = group_model.insert(head["group_name"], head.get("group_type"), head.get("area"))
        made += 1
        for b in c:
            groups.link_booking(int(b["id"]), gid, None, method="cluster" if len(c) > 1 else "new")
            linked += 1
    print(f"applied: {made} groups, {linked} bookings linked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
