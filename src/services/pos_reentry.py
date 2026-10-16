"""Re-entry passes: the rules the terminals ask the back office to apply.

A re-entry is any ticket that carries the Re-Entry line (``ItemKinds.reentry_sku``).  A pass
is a bearer ticket for N heads, issued at the exit and admitted once on return, dead at the
cut-off time the same day.  The rules, agreed with Ray on 2026-10-13:

* **Anchor.** A pass may only be issued for a plate that already has a closed, unrefunded
  sale today with a head count above zero (public Visitor lines, online tickets, group
  bookings).  A plate with an unpaid open ticket is in the queue, not inside.
* **Scan or stricter.** If the anchor was created from a scanned licence disc, the re-entry
  must be scanned too; a typed plate is refused.  A typed anchor allows a typed re-entry,
  which is flagged.
* **One open pass per plate.** A car that has left cannot get a second pass; on return the
  disc scan opens the pass, so a lost slip does not matter.
* **Heads.** Up to the anchor's paid heads freely; more needs a Manager's PIN on the terminal
  (``requires_manager``), and is flagged.  A zero-count anchor is invalid data: flagged, PIN.
* **Return.** Valid only on the day of issue and before the cut-off; the anchor must still be
  unrefunded.  A partial refund lowers the cap (``heads_cap``); the terminal asks for a
  Manager's PIN above it.  Everything else is a manager void.

Anchors come from the ticket feed (``open_tickets_history`` closed rows carry the receipt with
the plate as its name and the lines with SKU and category, enriched by bridge build 32+), refunds
from the staff audit trail (``refund`` events name the refunded receipt).  Nothing is stored for
a pass beyond what the feed already keeps: the pass is an open ticket until it is admitted.
"""

import json
from datetime import datetime, time, timedelta

from src.models.pos_staff import PosEmployeeEvent
from src.models.pos_reentry import PosReentryData
from src.services.pos_items import ItemKinds


def normalise_plate(plate):
    """Plates compare without spaces, dashes or case; '' when nothing usable is left."""
    return "".join(ch for ch in str(plate or "").upper() if ch.isalnum())


def _json(value):
    if value is None or isinstance(value, dict):
        return value or {}
    try:
        return json.loads(value) or {}
    except (TypeError, ValueError):
        return {}


class ReentryService:
    """``check_issue`` / ``check_return`` are what the terminals call; ``report`` is for the owner."""

    def __init__(self, kinds=None, data=None, refunds=None, now=None):
        self.kinds = kinds or ItemKinds.for_request()
        self.data = data or PosReentryData
        self._refunded_receipt_ids = refunds or self._refunds_from_audit
        self._now = now or datetime.now

    # ---- building blocks ----------------------------------------------------------------------

    def cutoff_for(self, day):
        hh, mm = (int(x) for x in self.kinds.cutoff.split(":"))
        return datetime.combine(day, time(hh, mm))

    def anchors(self, plate, day):
        """Today's closed sales for the plate: [{ticket_id, receipt_id, closed_at, heads, source, refunded, device}]."""
        plate = normalise_plate(plate)
        if not plate:
            return []
        start = datetime.combine(day, time.min)
        end = start + timedelta(days=1)
        refunded = self._refunded_receipt_ids(start, end)
        out = []
        for row in self.data.closed_receipts(start, end):
            receipt = _json(row.get("receipt_json"))
            if normalise_plate(receipt.get("name")) != plate:
                continue
            bridge = receipt.get("_bridge") or {}
            vehicle = receipt.get("vehicle") or {}
            source = vehicle.get("source") or row.get("vehicle_source")
            out.append(
                {
                    "ticket_id": row.get("ticket_id"),
                    "receipt_id": receipt.get("receipt_id"),
                    "closed_at": row.get("observed_at"),
                    "heads": self.kinds.headcount(receipt.get("items") or []),
                    "reentry_heads": self.kinds.reentry_heads(receipt.get("items") or []),
                    "source": source if source in ("disc", "manual") else None,
                    "refunded": receipt.get("receipt_id") in refunded,
                    "device": bridge.get("device"),
                    "staff": bridge.get("staff"),
                }
            )
        out.sort(key=lambda a: (a["closed_at"] or datetime.min))
        return out

    def open_passes(self, plate):
        """Open tickets for the plate that carry the Re-Entry line."""
        plate = normalise_plate(plate)
        out = []
        for row in self.data.open_tickets():
            receipt = _json(row.get("receipt_json"))
            if normalise_plate(receipt.get("name")) != plate:
                continue
            heads = self.kinds.reentry_heads(receipt.get("items") or [])
            if heads <= 0:
                continue
            out.append(
                {
                    "ticket_id": row.get("ticket_id"),
                    "sync_id": receipt.get("sync_id"),
                    "opened_at": row.get("opened_at"),
                    "heads": heads,
                    "extras": self.kinds.headcount(receipt.get("items") or []),
                    "source": row.get("vehicle_source"),
                }
            )
        return out

    @staticmethod
    def _refunds_from_audit(start, end):
        ids = set()
        for evt in PosEmployeeEvent.since(start, ["refund"]):
            if evt["occurred_at"] >= end:
                continue
            detail = evt.get("detail") or {}
            if detail.get("conversion"):
                continue  # the people stay inside, now under a group ticket (pos_conversions.py)
            receipt_id = detail.get("receipt_id")
            if receipt_id:
                ids.add(str(receipt_id))
        return ids

    @staticmethod
    def _live(anchors):
        return [a for a in anchors if not a["refunded"] and a["heads"] > 0]

    # ---- the two questions the terminals ask -------------------------------------------------

    def check_issue(self, plate, typed, heads, now=None):
        """May a pass for ``heads`` be issued for ``plate`` now?  ``typed`` = the plate was keyed in."""
        now = now or self._now()
        plate_n = normalise_plate(plate)
        flags = []
        if not plate_n:
            return self._refuse("No registration on the ticket.", flags)
        if now >= self.cutoff_for(now.date()):
            return self._refuse(f"No re-entry after {self.kinds.cutoff}.", flags)
        try:
            heads = int(heads)
        except (TypeError, ValueError):
            heads = 0
        if heads <= 0:
            return self._refuse("The Re-Entry line has no quantity.", flags)
        anchors = self.anchors(plate_n, now.date())
        live = self._live(anchors)
        if not anchors:
            return self._refuse(f"No paid admission today for {plate_n}.", flags)
        if not live:
            if all(a["refunded"] for a in anchors):
                return self._refuse(f"The admission for {plate_n} was refunded.", flags)
            # Sales exist but none with countable heads: invalid data, a manager's call.
            flags.append("zero_count_anchor")
        if self.open_passes(plate_n):
            return self._refuse(f"{plate_n} already has an open re-entry.", flags)
        anchor_scanned = any(a["source"] == "disc" for a in anchors)
        if typed and anchor_scanned:
            return self._refuse(f"{plate_n} was scanned on entry; scan the licence disc for a re-entry.", flags)
        if typed:
            flags.append("typed_plate")
        anchor_heads = sum(a["heads"] for a in live)
        requires_manager = heads > anchor_heads
        if requires_manager:
            flags.append("over_anchor")
        return {
            "allowed": True,
            "reason": None,
            "requires_manager": requires_manager,
            "anchor_heads": anchor_heads,
            "anchors": len(live),
            "anchor_scanned": anchor_scanned,
            "flags": flags,
        }

    def check_return(self, plate, sync_id=None, now=None):
        """Is the open pass for ``plate`` (or ``sync_id``) still good to admit now?"""
        now = now or self._now()
        plate_n = normalise_plate(plate)
        passes = self.open_passes(plate_n) if plate_n else []
        if sync_id not in (None, "", 0):
            passes = [p for p in passes if str(p.get("sync_id")) == str(sync_id)] or passes
        if not passes:
            return {"valid": False, "reason": f"No open re-entry for {plate_n or 'this ticket'}.", "heads_cap": 0}
        pass_ = passes[0]
        issued = pass_.get("opened_at")
        if issued and issued.date() != now.date():
            return {"valid": False, "reason": f"This re-entry was issued on {issued:%a %d %b}; it is no longer valid.", "heads_cap": 0}
        if now >= self.cutoff_for(now.date()):
            return {"valid": False, "reason": f"Re-entries are not valid after {self.kinds.cutoff}.", "heads_cap": 0}
        anchors = self.anchors(plate_n, now.date())
        live = self._live(anchors)
        if anchors and not live and all(a["refunded"] for a in anchors):
            return {"valid": False, "reason": f"The admission for {plate_n} was refunded; this re-entry is void.", "heads_cap": 0}
        cap = sum(a["heads"] for a in live)
        flags = [] if anchors else ["no_anchor_data"]
        return {
            "valid": True,
            "reason": None,
            "heads": pass_["heads"],
            "heads_cap": cap if anchors else pass_["heads"],
            "over_cap": bool(anchors) and pass_["heads"] > cap,
            "flags": flags,
        }

    @staticmethod
    def _refuse(reason, flags):
        return {"allowed": False, "reason": reason, "requires_manager": False, "anchor_heads": 0, "anchors": 0,
                "anchor_scanned": False, "flags": flags}

    # ---- the owner's report --------------------------------------------------------------------

    def report(self, since, until=None):
        """Every pass issued in the window: who, plate, heads, what it was anchored to, how it ended."""
        until = until or self._now()
        by_ticket = {}
        for row in self.data.history(since, until):
            receipt = _json(row.get("receipt_json"))
            items = receipt.get("items") or []
            heads = self.kinds.reentry_heads(items)
            if heads <= 0 and row["event_type"] != "voided":
                continue
            entry = by_ticket.setdefault(row["ticket_id"], {"ticket_id": row["ticket_id"], "events": []})
            entry["events"].append((row["event_type"], row["observed_at"], receipt))
        approvals = [
            e for e in PosEmployeeEvent.since(since, ["approval", "reentry_issued", "reentry_refused", "reentry_admitted"])
            if e["occurred_at"] <= until
        ]
        rows = []
        for entry in by_ticket.values():
            events = sorted(entry["events"], key=lambda e: e[1])
            created = next((e for e in events if e[0] == "created"), events[0])
            if self.kinds.reentry_heads((created[2].get("items") or [])) <= 0:
                continue
            receipt = created[2]
            bridge = receipt.get("_bridge") or {}
            vehicle = receipt.get("vehicle") or {}
            plate = normalise_plate(receipt.get("name"))
            closed = next((e for e in events if e[0] == "closed"), None)
            voided = next((e for e in events if e[0] == "voided"), None)
            issued_at = created[1]
            status = "used" if closed else "voided" if voided else ("expired" if issued_at < self.cutoff_for(issued_at.date()) <= until else "open")
            anchors = self._live(self.anchors(plate, issued_at.date())) if plate else []
            marks = [
                a for a in approvals
                if abs((a["occurred_at"] - issued_at).total_seconds()) <= 180
                and str((a.get("detail") or {}).get("plate") or "") in ("", plate)
            ]
            rows.append(
                {
                    "issued_at": issued_at,
                    "plate": plate,
                    "heads": self.kinds.reentry_heads(receipt.get("items") or []),
                    "anchor_heads": sum(a["heads"] for a in anchors),
                    "typed": vehicle.get("source") == "manual",
                    "issued_by": (bridge.get("staff") or {}).get("name"),
                    "device": bridge.get("device"),
                    "status": status,
                    "used_at": closed[1] if closed else None,
                    "used_by": ((closed[2].get("_bridge") or {}).get("staff") or {}).get("name") if closed else None,
                    "extras_paid": self.kinds.headcount(closed[2].get("items") or []) if closed else 0,
                    "approved_by": next(
                        ((m.get("detail") or {}).get("approved_by_name") or m.get("employee_name")
                         for m in marks if m["event"] in ("approval", "reentry_issued") and (m.get("detail") or {}).get("approved_by_name")),
                        None,
                    ),
                    "flags": sorted({f for m in marks for f in ((m.get("detail") or {}).get("flags") or [])}),
                }
            )
        rows.sort(key=lambda r: r["issued_at"])
        return rows
