"""Groups and history (2 Nov 2026).

A group is the thing that comes back; a booking is one visit. Every booking
links to a ``booking_groups`` row; the group keeps every spelling it has been
booked under (aliases) and knows its contacts through its bookings.

Three layers, agreed with the owner:

1. **Suggest, don't guess, when a request arrives.** ``assign_on_create`` runs
   on every new booking: a confident signal (a known address or number, the
   customer naming last year's reference, or their own "we visited before as
   X" together with the area) links the booking and says so on the record; a
   weaker one (the name, the area, a school's email domain) is left as a
   suggestion for Needs attention ("Same group as FY1473 Mondale High?" with
   Yes and New group); nothing at all makes a new group quietly. A Yes teaches
   the group a new spelling or contact.
2. **History.** ``history_for`` is the record's History tab: the group's other
   bookings with what each one tells us (how long the proforma and the deposit
   took, whether the deposit was on time, booked against arrived, how it
   ended, the money) and a summary so Linda sees what to expect this time.
3. **Rebook.** A past booking's Rebook opens Add booking pre-filled and
   carries the group (``group_id`` on POST /bookings), so a returning group is
   linked before anything else happens.

Scores: an address 100, a number 90, a quoted reference 95, the customer's own
previous name 65 (+25 for the area), the name 60 exact or 35 in part, the area
+25, a non-generic email domain +45. Confident at 90, suggested at 40.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from statistics import median
from typing import Any, Iterable, Mapping

from src.models import booking as booking_model
from src.models import booking_group as group_model
from src.models.base import loads, query, serialize_row
from src.models.booking_event import add as add_event
from src.services import matching as mt
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("groups")

CONFIDENT = 90
SUGGEST = 40
SCORE_EMAIL = 100
SCORE_MOBILE = 90
SCORE_REFERENCE = 95
SCORE_PREVIOUS_NAME = 65  # the customer's own word; with the area it is confident
SCORE_NAME = 60
SCORE_NAME_PARTIAL = 35
SCORE_AREA = 25
SCORE_DOMAIN = 45
MAX_SUGGESTIONS = 3

# Mail providers: a shared domain there says nothing about the group.
GENERIC_DOMAINS = frozenset(
    {
        "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "hotmail.com", "hotmail.co.uk",
        "hotmail.co.za", "outlook.com", "live.com", "live.co.za", "live.co.uk", "msn.com", "icloud.com", "me.com",
        "mac.com", "aol.com", "mail.com", "protonmail.com", "proton.me", "webmail.co.za", "telkomsa.net",
        "mweb.co.za", "vodamail.co.za", "lantic.net", "absamail.co.za", "wol.co.za", "polka.co.za", "iafrica.com",
        "xsinet.co.za", "mailbox.co.za", "netactive.co.za", "telkom.net", "axxess.co.za", "worldonline.co.za",
        "mtnloaded.co.za", "cybersmart.co.za", "afrihost.co.za",
    }
)
EXIT_STATUSES = ("cancelled", "lapsed", "no_show", "declined")
CAME_STATUSES = ("completed", "confirmed")


# ------------------------------------------------------------- keys ------

def _plain(text: str | None) -> str:
    # Apostrophes join, they do not split: Mitchell's Plain is Mitchells Plain.
    return (text or "").replace("'", "").replace("\u2019", "")


def name_tokens(name: str | None) -> set[str]:
    """The words of a group name that tell it apart: no generic words, no numbers
    (a grade changes every year, the school does not)."""
    return {w for w in mt.words(_plain(name)) if w not in mt.GENERIC_WORDS and len(w) > 1 and not w.isdigit()}


def name_key(name: str | None) -> str:
    return " ".join(sorted(name_tokens(name)))


def area_key(area: str | None) -> str:
    return " ".join(sorted(w for w in mt.words(_plain(area)) if w not in mt.GENERIC_WORDS and len(w) > 1))


def domain_of(email: str | None) -> str | None:
    e = (email or "").strip().lower()
    if "@" not in e:
        return None
    d = e.rsplit("@", 1)[1]
    return None if d in GENERIC_DOMAINS else d


def _coverage(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


# ------------------------------------------------------------- facts -----

@dataclass
class Facts:
    booking_id: int | None
    emails: set[str] = field(default_factory=set)
    mobiles: set[str] = field(default_factory=set)
    domains: set[str] = field(default_factory=set)
    name_key: str = ""
    name_tokens: set[str] = field(default_factory=set)
    previous_key: str = ""
    previous_tokens: set[str] = field(default_factory=set)
    area_key: str = ""
    group_type: str | None = None
    references: set[int] = field(default_factory=set)


def facts_for(booking: Mapping[str, Any], contacts: Iterable[Mapping[str, Any]] | None = None) -> Facts:
    """What a booking tells us about its group. ``contacts`` defaults to the
    booking's contact rows when it has an id."""
    bid = int(booking["id"]) if booking.get("id") else None
    emails = {str(booking.get("contact_email") or "").strip().lower()} - {""}
    mobiles = {mt.normalise_za_mobile(booking.get("contact_mobile"))} - {None}
    if contacts is None and bid:
        contacts = query("SELECT email, mobile FROM booking_contacts WHERE booking_id = %s", (bid,))
    for c in contacts or []:
        if c.get("email"):
            emails.add(str(c["email"]).strip().lower())
        if c.get("mobile"):
            m = mt.normalise_za_mobile(c["mobile"])
            if m:
                mobiles.add(m)
    domains = {d for d in (domain_of(e) for e in emails) if d}
    return Facts(
        booking_id=bid,
        emails=emails,
        mobiles=mobiles,
        domains=domains,
        name_key=name_key(booking.get("group_name")),
        name_tokens=name_tokens(booking.get("group_name")),
        previous_key=name_key(booking.get("previous_visit_name")),
        previous_tokens=name_tokens(booking.get("previous_visit_name")),
        area_key=area_key(booking.get("area")),
        group_type=booking.get("group_type"),
        references=mt.references_in(booking.get("customer_notes"), booking.get("internal_notes"), booking.get("previous_visit_name")),
    )


# ----------------------------------------------------------- profiles ----

@dataclass
class Profile:
    id: int
    name: str
    group_type: str | None
    area: str | None
    name_keys: set[str] = field(default_factory=set)
    token_sets: list[set[str]] = field(default_factory=list)
    area_keys: set[str] = field(default_factory=set)
    emails: set[str] = field(default_factory=set)
    mobiles: set[str] = field(default_factory=set)
    domains: set[str] = field(default_factory=set)
    doc_numbers: set[int] = field(default_factory=set)
    bookings: list[dict] = field(default_factory=list)

    def add_name(self, name: str | None) -> None:
        toks = name_tokens(name)
        if toks:
            self.name_keys.add(" ".join(sorted(toks)))
            if toks not in self.token_sets:
                self.token_sets.append(toks)


def load_profiles(exclude_booking_id: int | None = None) -> list[Profile]:
    """Every group with the signals its bookings and contacts give it. The
    booking being scored is left out of its own group's profile."""
    profiles: dict[int, Profile] = {}
    for g in group_model.all_groups():
        p = Profile(id=int(g["id"]), name=g["name"], group_type=g.get("group_type"), area=g.get("area"))
        p.add_name(g["name"])
        if g.get("area"):
            p.area_keys.add(area_key(g["area"]))
        profiles[p.id] = p
    for a in group_model.all_aliases():
        p = profiles.get(int(a["group_id"]))
        if p:
            p.add_name(a["name"])
    for b in group_model.linked_bookings():
        if exclude_booking_id and int(b["id"]) == int(exclude_booking_id):
            continue
        p = profiles.get(int(b["group_id"]))
        if not p:
            continue
        p.add_name(b.get("group_name"))
        if b.get("area"):
            p.area_keys.add(area_key(b["area"]))
        e = str(b.get("contact_email") or "").strip().lower()
        if e:
            p.emails.add(e)
            d = domain_of(e)
            if d:
                p.domains.add(d)
        m = mt.normalise_za_mobile(b.get("contact_mobile"))
        if m:
            p.mobiles.add(m)
        if b.get("doc_number"):
            p.doc_numbers.add(int(b["doc_number"]))
        p.bookings.append(b)
    for c in group_model.linked_contacts():
        p = profiles.get(int(c["group_id"]))
        if not p:
            continue
        if c.get("email"):
            e = str(c["email"]).strip().lower()
            p.emails.add(e)
            d = domain_of(e)
            if d:
                p.domains.add(d)
        if c.get("mobile"):
            m = mt.normalise_za_mobile(c["mobile"])
            if m:
                p.mobiles.add(m)
    # A group whose only booking is the one being scored has nothing to say.
    return [p for p in profiles.values() if p.bookings or exclude_booking_id is None]


SCORE_CONTACT_DIFFERENT_NAME = 65  # a known person booking under an unrelated name: suggest, never link


def names_contradict(facts: Facts, profile: Profile) -> bool:
    """The booking names a group and none of its distinctive words appear in
    any name the profile's group has used (nor in the customer's own previous
    name). One person can book for a school and for her church: a shared
    address alone must not merge the two."""
    if not facts.name_tokens or not profile.token_sets:
        return False
    if any(facts.name_tokens & ts for ts in profile.token_sets):
        return False
    if facts.previous_tokens and any(facts.previous_tokens & ts for ts in profile.token_sets):
        return False
    return True


def score(facts: Facts, profile: Profile) -> tuple[int, list[str]]:
    """Points and the signals behind them, strongest first."""
    points = 0
    why: list[str] = []
    contradiction = names_contradict(facts, profile)
    if facts.emails & profile.emails:
        points = max(points, SCORE_EMAIL)
        why.append("email")
    if facts.mobiles & profile.mobiles:
        points = max(points, SCORE_MOBILE)
        why.append("mobile")
    if facts.references & profile.doc_numbers:
        points = max(points, SCORE_REFERENCE)
        why.append("reference")
    if points and contradiction:
        points = min(points, SCORE_CONTACT_DIFFERENT_NAME)
        why.append("different name")

    base = 0
    if facts.previous_key and facts.previous_key in profile.name_keys:
        base = SCORE_PREVIOUS_NAME
        why.append("previous name")
    elif facts.previous_tokens and any(_coverage(facts.previous_tokens, ts) >= 0.5 for ts in profile.token_sets):
        base = SCORE_NAME_PARTIAL
        why.append("previous name (part)")
    if facts.name_key and facts.name_key in profile.name_keys:
        base = max(base, SCORE_NAME)
        why.append("name")
    elif facts.name_tokens and any(_coverage(facts.name_tokens, ts) >= 0.5 for ts in profile.token_sets):
        base = max(base, SCORE_NAME_PARTIAL)
        why.append("name (part)")
    domain_hit = bool(facts.domains & profile.domains)
    if base:
        if facts.area_key and facts.area_key in profile.area_keys:
            base += SCORE_AREA
            why.append("area")
        if domain_hit:
            base += SCORE_DOMAIN
            why.append("email domain")
    elif domain_hit:
        base = SCORE_DOMAIN
        why.append("email domain")
        if facts.area_key and facts.area_key in profile.area_keys:
            base += SCORE_AREA
            why.append("area")
    return max(points, base), why


def _last_booking(profile: Profile) -> dict | None:
    rows = sorted(profile.bookings, key=lambda b: (b.get("visit_date") or date.min, int(b["id"])), reverse=True)
    return rows[0] if rows else None


def _suggestion(profile: Profile, points: int, why: list[str]) -> dict:
    last = _last_booking(profile)
    return {
        "group_id": profile.id,
        "name": profile.name,
        "area": profile.area,
        "group_type": profile.group_type,
        "score": points,
        "why": why,
        "confident": points >= CONFIDENT,
        "bookings": len(profile.bookings),
        "last": serialize_row({k: last.get(k) for k in ("id", "reference", "visit_date", "status", "people_booked", "group_name")}) if last else None,
    }


def suggestions_for(booking: Mapping[str, Any], profiles: list[Profile] | None = None, limit: int = MAX_SUGGESTIONS) -> list[dict]:
    """Groups this booking may belong to, best first (score >= SUGGEST)."""
    facts = facts_for(booking)
    profiles = load_profiles(exclude_booking_id=facts.booking_id) if profiles is None else profiles
    scored = []
    for p in profiles:
        if booking.get("group_id") and int(booking["group_id"]) == p.id:
            continue
        points, why = score(facts, p)
        if points >= SUGGEST:
            scored.append(_suggestion(p, points, why))
    scored.sort(key=lambda s: (-s["score"], s["name"]))
    return scored[:limit]


# ------------------------------------------------------------ linking ----

def link_booking(booking_id: int, group_id: int, actor: int | None, method: str = "manual") -> dict:
    """Put the booking in the group; the group learns the booking's spelling,
    area and kind. An old group left empty is removed."""
    b = booking_model.get(booking_id)
    if b is None:
        raise LookupError(f"Booking {booking_id} not found")
    g = group_model.get(group_id)
    if g is None:
        raise LookupError(f"Group {group_id} not found")
    old = int(b["group_id"]) if b.get("group_id") else None
    if old == int(group_id):
        return g
    group_model.set_booking_group(booking_id, int(group_id))
    _learn(g, b)
    add_event(
        booking_id,
        "group_linked",
        f"Linked to group {g['name']}" if method != "new" else f"New group {g['name']}",
        {"group_id": int(group_id), "method": method, "from_group_id": old},
        actor,
    )
    if old and old != int(group_id):
        group_model.delete_if_empty(old)
    return group_model.get(group_id) or g


def _learn(group: Mapping[str, Any], booking: Mapping[str, Any]) -> None:
    gid = int(group["id"])
    name = (booking.get("group_name") or "").strip()
    if name and name_key(name) and name.lower() != str(group["name"]).lower():
        if name.lower() not in {a.lower() for a in group_model.aliases(gid)}:
            group_model.add_alias(gid, name)
    fields: dict[str, Any] = {}
    if not group.get("area") and booking.get("area"):
        fields["area"] = booking["area"]
    if not group.get("group_type") and booking.get("group_type"):
        fields["group_type"] = booking["group_type"]
    if fields:
        group_model.update(gid, **fields)


def new_group_for(booking_id: int, actor: int | None, method: str = "new") -> dict:
    """A group of its own for the booking (the first visit, or 'not that group')."""
    b = booking_model.get(booking_id)
    if b is None:
        raise LookupError(f"Booking {booking_id} not found")
    gid = group_model.insert(b["group_name"], b.get("group_type"), b.get("area"))
    return link_booking(booking_id, gid, actor, method=method)


def assign_on_create(booking_id: int, actor: int | None = None) -> dict:
    """Called for every new booking (and when a saved request is completed):
    link on a confident signal, leave suggestions for a person, or make a new
    group when nothing resembles it."""
    b = booking_model.get(booking_id)
    if b is None:
        raise LookupError(f"Booking {booking_id} not found")
    if b.get("group_id"):
        return {"outcome": "kept", "group_id": int(b["group_id"])}
    suggestions = suggestions_for(b)
    if suggestions and suggestions[0]["confident"] and (len(suggestions) == 1 or suggestions[0]["score"] > suggestions[1]["score"]):
        top = suggestions[0]
        link_booking(booking_id, top["group_id"], actor, method=", ".join(top["why"]))
        return {"outcome": "linked", "group_id": top["group_id"], "why": top["why"]}
    if not suggestions:
        g = new_group_for(booking_id, actor)
        return {"outcome": "new", "group_id": int(g["id"])}
    return {"outcome": "suggested", "suggestions": suggestions}


def note_name_change(booking_id: int, new_name: str | None) -> None:
    """A renamed booking teaches its group the new spelling."""
    b = booking_model.get(booking_id)
    if b and b.get("group_id") and new_name:
        g = group_model.get(int(b["group_id"]))
        if g:
            _learn(g, {**b, "group_name": new_name})


# ------------------------------------------------------------ history ----

def _d(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _days(a: date | None, b: date | None) -> int | None:
    return (b - a).days if a and b else None


def visit_metrics(row: Mapping[str, Any], current: Mapping[str, Any] | None = None, today: date | None = None) -> dict:
    """What one earlier (or other) booking of the group tells us."""
    from src.models import booking_question as question_model
    from src.models import payment as payment_model
    from src.models.booking_event import list_for_booking as list_events
    from src.services.booking import STATUS_LABELS, booking_finance

    today = today or get_today()
    bid = int(row["id"])
    visit = _d(row.get("visit_date"))
    status = row["status"]
    requested_on = _d(row.get("enquiry_date")) or _d(row.get("created_at"))
    proforma_on = _d(row.get("proforma_sent_at"))
    hold = _d(row.get("hold_expires_on"))

    payments = payment_model.list_for_booking(bid)
    money_in = sorted((p for p in payments if Decimal(str(p["amount"])) > 0), key=lambda p: (_d(p["paid_on"]) or date.min, int(p["id"])))
    paid_total = sum((Decimal(str(p["amount"])) for p in money_in), Decimal(0))
    refunded = -sum((Decimal(str(p["amount"])) for p in payments if Decimal(str(p["amount"])) < 0), Decimal(0))
    deposit_on = _d(money_in[0]["paid_on"]) if money_in else None
    last_paid_on = _d(money_in[-1]["paid_on"]) if money_in else None
    try:
        finance = booking_finance(row, paid_total=paid_total)
        total = Decimal(str(finance.get("final_amount") if row.get("arrived_count") is not None else finance.get("total_amount") or 0))
    except Exception:  # noqa: BLE001 - history must never break the record
        total = Decimal(0)
    settled: str | None = None
    if visit and money_in and total > 0 and paid_total >= total:
        settled = "before" if last_paid_on < visit else "on the day" if last_paid_on == visit else "after"
    elif money_in and total > 0:
        settled = "short"

    events = list_events(bid)
    changes_after = 0
    if proforma_on:
        for e in events:
            if e.get("kind") != "updated" or _d(e.get("created_at")) is None or _d(e["created_at"]) < proforma_on:
                continue
            data = loads(e.get("data")) if e.get("data") else {}
            changed = set((data or {}).get("changes") or {})
            if changed & {"visit_date", "people_booked", "adults", "children"}:
                changes_after += 1
    reminders = query(
        "SELECT COUNT(*) AS n FROM email_messages WHERE booking_id = %s AND direction = 'outbound' AND kind IN ('reminder', 'expiry')",
        (bid,),
    )[0]["n"]
    questions = [q["question"] for q in question_model.list_for_booking(bid) if q.get("question")][:5]

    booked = int(row.get("people_booked") or 0) or None
    arrived = row.get("arrived_count")
    arrived = int(arrived) if arrived is not None else None
    turnout = round(arrived / booked * 100) if booked and arrived is not None else None

    exit_info = None
    if status in EXIT_STATUSES:
        on = _d(row.get(f"{status}_at")) if status != "no_show" else visit
        exit_info = {"status": status, "on": on.isoformat() if on else None, "days_before_visit": _days(on, visit)}

    same_contact = False
    if current is not None:
        cur = facts_for(current)
        prev = facts_for(row)
        same_contact = bool((cur.emails & prev.emails) or (cur.mobiles & prev.mobiles))

    past = (visit is not None and visit < today) or status in EXIT_STATUSES or status == "completed"
    return {
        "id": bid,
        "reference": row.get("reference"),
        "visit_date": visit.isoformat() if visit else None,
        "status": status,
        "status_label": STATUS_LABELS.get(status, status),
        "relation": "past" if past else "upcoming",
        "group_name": row.get("group_name"),
        "group_type": row.get("group_type"),
        "contact_name": row.get("contact_name"),
        "same_contact": same_contact,
        "source": row.get("source"),
        "booked": booked,
        "arrived": arrived,
        "turnout_pct": turnout,
        "requested_on": requested_on.isoformat() if requested_on else None,
        "lead_days": _days(requested_on, visit),
        "proforma_days": _days(requested_on, proforma_on),
        "deposit_paid_on": deposit_on.isoformat() if deposit_on else None,
        "deposit_days": _days(proforma_on, deposit_on),
        "deposit_on_time": (deposit_on <= hold) if deposit_on and hold else None,
        "reminders_sent": int(reminders or 0),
        "changes_after_proforma": changes_after,
        "price_per_person": float(row.get("price_per_person") or 0),
        "discount_per_person": float(row.get("discount_per_person") or 0),
        "total": float(total),
        "paid_total": float(paid_total),
        "refunded": float(refunded),
        "settled": settled,
        "exit": exit_info,
        "questions": questions,
    }


MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")


def summarise(visits: list[dict]) -> dict | None:
    """The one-line reading of the past: how many times, how reliable, how prompt, how many turn up."""
    past = [v for v in visits if v["relation"] == "past" and v["status"] not in ("requested", "declined")]
    if not past:
        return None
    came = [v for v in past if v["status"] in CAME_STATUSES]
    exits = [v for v in past if v["status"] in EXIT_STATUSES]
    years = sorted({int(v["visit_date"][:4]) for v in past if v.get("visit_date")})
    turnouts = [v["turnout_pct"] for v in came if v.get("turnout_pct") is not None]
    deposit_days = [v["deposit_days"] for v in past if v.get("deposit_days") is not None]
    on_time = [v["deposit_on_time"] for v in past if v.get("deposit_on_time") is not None]
    leads = [v["lead_days"] for v in past if v.get("lead_days") is not None]
    months = [int(v["visit_date"][5:7]) for v in came if v.get("visit_date")]
    typical_month = max(set(months), key=months.count) if months else None
    sizes = [{"year": int(v["visit_date"][:4]), "booked": v["booked"], "arrived": v["arrived"]} for v in sorted(came, key=lambda v: v["visit_date"] or "") if v.get("visit_date")]
    last = max(came, key=lambda v: v["visit_date"] or "") if came else None
    return {
        "visits": len(came),
        "cancellations": len(exits),
        "exits": {s: sum(1 for v in exits if v["status"] == s) for s in EXIT_STATUSES if any(v["status"] == s for v in exits)},
        "first_year": years[0] if years else None,
        "last": {k: last[k] for k in ("id", "reference", "visit_date", "booked", "arrived", "turnout_pct", "deposit_days", "deposit_on_time", "settled")} if last else None,
        "turnout_avg_pct": round(sum(turnouts) / len(turnouts)) if turnouts else None,
        "deposit_days_avg": round(sum(deposit_days) / len(deposit_days)) if deposit_days else None,
        "deposit_on_time": {"on_time": sum(1 for x in on_time if x), "of": len(on_time)} if on_time else None,
        "lead_days_median": int(median(leads)) if leads else None,
        "typical_month": MONTHS[typical_month - 1] if typical_month else None,
        "sizes": sizes,
        "same_person": any(v["same_contact"] for v in past),
        "reminders_total": sum(v["reminders_sent"] for v in past),
        "paid_total": round(sum(v["paid_total"] - v["refunded"] for v in came), 2),
    }


def history_for(booking: Mapping[str, Any], today: date | None = None) -> dict:
    """The History tab: the group, its other bookings with their metrics, and the summary."""
    gid = booking.get("group_id")
    if not gid:
        return {"group": None, "visits": [], "summary": None}
    g = group_model.get(int(gid))
    if g is None:
        return {"group": None, "visits": [], "summary": None}
    rows = [r for r in group_model.bookings(int(gid)) if int(r["id"]) != int(booking["id"])]
    visits = [visit_metrics(r, booking, today) for r in rows]
    return {
        "group": {
            "id": int(g["id"]),
            "name": g["name"],
            "area": g.get("area"),
            "group_type": g.get("group_type"),
            "aliases": group_model.aliases(int(g["id"])),
            "bookings": len(rows) + 1,
        },
        "visits": visits,
        "summary": summarise(visits),
    }


def serialize_group_row(row: Mapping[str, Any]) -> dict:
    out = serialize_row(dict(row)) or {}
    out["bookings"] = int(out.get("bookings") or 0)
    return out
