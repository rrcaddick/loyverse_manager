"""Shared evidence rules for tying mail to bookings.

Used by the one-off season migration (``src/services/migration.py``) and by
the live inbound pipeline's daily sweep (``src/services/inbound.py``). Pure:
no database, no network.

Evidence, strongest first (docs/handoff/migration-and-inbound.md):

    reference   the FY/INV number in a subject, body or attachment name   100
    email       a participant address that belongs to the booking           90
    mobile      the booking's mobile written anywhere in a body             80
    group       every distinctive word of the group name present            60
    group~      at least half of them (never fewer than one)                35
    surname     the contact's surname in the sender name, subject or body   30
    first       the contact's first name (only counts beside other evidence) 10

A thread attaches on its own at ``AUTO_THRESHOLD`` (65): reference, email,
mobile, or a group name corroborated by the contact's name. A fuzzy group
name alone (60) lands in the review band and is reported, never attached.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from typing import Iterable

SCORE_REFERENCE = 100
SCORE_EMAIL = 90
SCORE_MOBILE = 80
SCORE_GROUP = 60
SCORE_GROUP_PARTIAL = 35
SCORE_SURNAME = 30
SCORE_FIRST = 10
AUTO_THRESHOLD = 65
REVIEW_THRESHOLD = 40

CLUSTER_GAP_DAYS = 60
HARD_FLOOR = date(2026, 1, 1)

# Words that say what kind of group it is, not which one. Afrikaans included.
GENERIC_WORDS = frozenset(
    """
    the of and for de van der du le da von den
    primary primêre primere school skool high hoërskool hoerskool laerskool secondary
    college academy academie pre preschool preprimary nursery creche crèche educare daycare
    aftercare after care centre center kids children child junior senior
    church kerk gemeente ministries ministry chapel mission fellowship congregation assembly
    assemblies apostolic baptist methodist catholic reformed christian christ jesus gospel
    youth group groep club association society foundation community
    family familie friends team staff outing trip visit tour
    grade gr grd graad class klas year yr foundation phase intermediate intersen
    new old st saint ngk vgk afm
    """.split()
)
PARTICLES = frozenset({"van", "der", "de", "du", "le", "da", "von", "den", "la", "di"})
STOP_LOCAL_TOKENS = frozenset(
    {"info", "admin", "office", "bookings", "booking", "mail", "contact", "hello", "enquiries", "enquiry", "reception"}
)
NOREPLY_RE = re.compile(r"(no-?reply|donotreply|do-not-reply|mailer-daemon|postmaster|notification|noreply)", re.I)

_WORD_RE = re.compile(r"[a-z0-9]+")
_PHONE_RUN_RE = re.compile(r"(?:\+?\d[\d\s\-().]{7,}\d)")


# --------------------------------------------------------------- text ---


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def words(text: str | None) -> list[str]:
    if not text:
        return []
    return _WORD_RE.findall(strip_accents(text).lower())


def distinctive_tokens(group_name: str | None, limit: int = 4) -> list[str]:
    """The words of a group name that identify it: no generic words, no
    numbers, nothing shorter than three letters. Longest first, at most ``limit``."""
    seen: list[str] = []
    for w in words(group_name):
        if w in GENERIC_WORDS or w.isdigit() or len(w) < 3 or w in seen:
            continue
        seen.append(w)
    seen.sort(key=lambda w: (-len(w), w))
    return seen[:limit]


def name_parts(contact_name: str | None) -> tuple[str | None, str | None]:
    """('charmaine', 'schalkwyk') from 'Charmaine Van Schalkwyk'; particles dropped."""
    ws = [w for w in words(contact_name) if not w.isdigit()]
    if not ws:
        return None, None
    first = ws[0] if len(ws[0]) >= 2 else None
    rest = [w for w in ws[1:] if w not in PARTICLES and len(w) >= 3]
    surname = rest[-1] if rest else None
    if surname == first:
        surname = None
    return first, surname


def fuzzy_word_in(token: str, haystack_words: Iterable[str], ratio: float = 0.86) -> bool:
    """Is ``token`` (or a close misspelling of it) one of the words?"""
    if len(token) < 3:
        return False
    first = token[0]
    lo, hi = len(token) - 2, len(token) + 2
    for w in haystack_words:
        if w == token:
            return True
        if len(token) >= 5 and w[0] == first and lo <= len(w) <= hi:
            if SequenceMatcher(None, token, w).ratio() >= ratio:
                return True
    return False


def group_coverage(group_name: str | None, haystack_words: set[str]) -> tuple[float, list[str]]:
    """Share of the group's distinctive words found (fuzzily) in the text."""
    toks = distinctive_tokens(group_name)
    if not toks:
        return 0.0, []
    hits = [t for t in toks if fuzzy_word_in(t, haystack_words)]
    return len(hits) / len(toks), hits


# ------------------------------------------------------------- phones ---


def normalise_za_mobile(value: str | None) -> str | None:
    """Any written form -> '27XXXXXXXXX' for a South African mobile, else None."""
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("0"):
        digits = "27" + digits[1:]
    elif len(digits) == 9 and digits[0] in "678":
        digits = "27" + digits
    elif len(digits) == 12 and digits.startswith("270"):
        digits = "27" + digits[3:]
    if len(digits) == 11 and digits.startswith("27") and digits[2] in "678":
        return digits
    return None


def phone_variants(mobile: str | None) -> list[str]:
    """Every way a South African mobile is commonly written, for a Gmail search.

    Gmail matches whole tokens and treats punctuation as spaces, so the
    variants differ in where the digit groups break, not in the punctuation.
    """
    e164 = normalise_za_mobile(mobile)
    if not e164:
        return []
    n = e164[2:]  # 9 digits
    local = "0" + n
    a, b, c = n[:2], n[2:5], n[5:]
    forms = [
        f"0{a} {b} {c}",
        local,
        f"27 {a} {b} {c}",
        e164,
        f"0{a} {b}{c}",
        f"0{a}{b} {c}",
        f"27 {a} {b}{c}",
        f"{a} {b} {c}",
        f"0{a} {b} {c[:2]} {c[2:]}",
    ]
    out: list[str] = []
    for f in forms:
        if f not in out:
            out.append(f)
    return out


def mobiles_in_text(text: str | None) -> set[str]:
    """Every South African mobile written in the text, however it is spaced."""
    if not text:
        return set()
    out: set[str] = set()
    for m in _PHONE_RUN_RE.finditer(text):
        norm = normalise_za_mobile(m.group(0))
        if norm:
            out.add(norm)
    # Also catch digit runs glued to words (e.g. "cell:0827069415").
    for m in re.finditer(r"(?<!\d)(?:27|0)?[678]\d{8}(?!\d)", re.sub(r"[\s\-().]", "", text)):
        norm = normalise_za_mobile(m.group(0))
        if norm:
            out.add(norm)
    return out


# --------------------------------------------------------- references ---

REFERENCE_RE = re.compile(r"\b(FY|INV)[\s\-_:#]*0*(\d{3,5})\b", re.IGNORECASE)


def references_in(*texts: str | None) -> set[int]:
    out: set[int] = set()
    for t in texts:
        if t:
            for m in REFERENCE_RE.finditer(t):
                out.add(int(m.group(2)))
    return out


# ------------------------------------------------------------ queries ---


def _q(phrase: str) -> str:
    return f'"{phrase}"' if " " in phrase else phrase


def reference_query(doc_number: int | None, prefixes: tuple[str, ...] = ("FY", "INV")) -> str | None:
    if not doc_number:
        return None
    n = int(doc_number)
    parts: list[str] = []
    for p in prefixes:
        parts += [f"{p}{n}", f'"{p} {n}"', f"{p}-{n}", f"filename:{p}{n}", f"filename:{p}-{n}", f'filename:"{p} {n}"']
    return " OR ".join(parts)


def address_query(address: str) -> str:
    a = address.strip().lower()
    return f"from:{a} OR to:{a} OR cc:{a}"


def phone_query(mobile: str | None) -> str | None:
    variants = phone_variants(mobile)
    return " OR ".join(_q(v) for v in variants) if variants else None


def group_query(group_name: str | None, max_tokens: int = 3) -> str | None:
    toks = distinctive_tokens(group_name, limit=max_tokens)
    return " ".join(_q(t) for t in toks) if toks else None


def surname_query(contact_name: str | None) -> str | None:
    _first, surname = name_parts(contact_name)
    return _q(surname) if surname and len(surname) >= 4 else None


def with_date(query: str, after: date | None = None, before: date | None = None) -> str:
    bits = [f"({query})"]
    if after:
        bits.append(f"after:{after:%Y/%m/%d}")
    if before:
        bits.append(f"before:{before:%Y/%m/%d}")
    return " ".join(bits)


# ------------------------------------------------------------- scoring ---


@dataclass
class BookingFacts:
    """What we know about a booking, pre-digested for scoring."""

    id: int | None
    reference: str | None
    doc_number: int | None
    group_name: str
    contact_name: str
    emails: set[str] = field(default_factory=set)
    mobile: str | None = None
    visit_date: date | None = None
    enquiry_date: date | None = None

    @classmethod
    def from_row(cls, row: dict, extra_emails: Iterable[str] = ()) -> "BookingFacts":
        emails = {str(e).lower() for e in extra_emails if e}
        if row.get("contact_email"):
            emails.add(str(row["contact_email"]).lower())
        return cls(
            id=row.get("id"),
            reference=row.get("reference"),
            doc_number=row.get("doc_number"),
            group_name=row.get("group_name") or "",
            contact_name=row.get("contact_name") or "",
            emails=emails,
            mobile=normalise_za_mobile(row.get("contact_mobile")),
            visit_date=row.get("visit_date"),
            enquiry_date=row.get("enquiry_date"),
        )


@dataclass
class ThreadFacts:
    """What a conversation says about itself: participants, text, dates."""

    thrid: int
    participants: set[str] = field(default_factory=set)  # lower-case addresses, own excluded
    from_names: set[str] = field(default_factory=set)
    subjects: set[str] = field(default_factory=set)
    text: str = ""
    filenames: set[str] = field(default_factory=set)
    first_at: datetime | None = None
    last_at: datetime | None = None
    message_count: int = 0
    inbound_count: int = 0
    outbound_count: int = 0
    last_direction: str | None = None
    _words: set[str] | None = None
    _mobiles: set[str] | None = None
    _refs: set[int] | None = None

    def word_set(self) -> set[str]:
        if self._words is None:
            self._words = set(words(" ".join(self.subjects))) | set(words(self.text)) | set(words(" ".join(self.from_names)))
            for p in self.participants:
                self._words.update(words(p.split("@", 1)[0]))
        return self._words

    def mobiles(self) -> set[str]:
        if self._mobiles is None:
            self._mobiles = mobiles_in_text(self.text) | mobiles_in_text(" ".join(self.subjects))
        return self._mobiles

    def references(self) -> set[int]:
        if self._refs is None:
            self._refs = references_in(*self.subjects, self.text, *self.filenames)
        return self._refs


def score(thread: ThreadFacts, booking: BookingFacts) -> tuple[int, list[str]]:
    """(score, reasons) for one thread against one booking."""
    pts = 0
    why: list[str] = []
    if booking.doc_number and booking.doc_number in thread.references():
        pts += SCORE_REFERENCE
        why.append("reference")
    if booking.emails and (thread.participants & booking.emails):
        pts += SCORE_EMAIL
        why.append("email")
    if booking.mobile and booking.mobile in thread.mobiles():
        pts += SCORE_MOBILE
        why.append("mobile")
    hay = thread.word_set()
    cover, hits = group_coverage(booking.group_name, hay)
    if cover >= 0.999:
        pts += SCORE_GROUP
        why.append("group")
    elif cover >= 0.5 and hits:
        pts += SCORE_GROUP_PARTIAL
        why.append("group~" + "+".join(hits))
    first, surname = name_parts(booking.contact_name)
    surname_hit = bool(surname and fuzzy_word_in(surname, hay))
    if surname_hit:
        pts += SCORE_SURNAME
        why.append("surname")
    if first and why and fuzzy_word_in(first, hay, ratio=0.9):
        pts += SCORE_FIRST
        why.append("first")
    return pts, why


def verdict(points: int) -> str:
    if points >= AUTO_THRESHOLD:
        return "attach"
    if points >= REVIEW_THRESHOLD:
        return "review"
    return "no"


# ------------------------------------------------------------ clusters ---


def cluster_threads(
    threads: Iterable[ThreadFacts], gap_days: int = CLUSTER_GAP_DAYS
) -> list[list[ThreadFacts]]:
    """Group conversations into seasons: sorted by last activity, a silence
    longer than ``gap_days`` starts a new cluster. Newest cluster last."""
    ordered = sorted((t for t in threads if t.last_at), key=lambda t: t.last_at)  # type: ignore[arg-type]
    clusters: list[list[ThreadFacts]] = []
    for t in ordered:
        if clusters and (t.last_at - clusters[-1][-1].last_at) <= timedelta(days=gap_days):  # type: ignore[operator]
            clusters[-1].append(t)
        else:
            clusters.append([t])
    return clusters


def choose_cluster(
    threads: Iterable[ThreadFacts], floor: date = HARD_FLOOR, gap_days: int = CLUSTER_GAP_DAYS
) -> tuple[list[ThreadFacts], list[ThreadFacts], str]:
    """(chosen, rejected, note). The newest cluster wins. A cluster that ends
    before ``floor`` is a previous season and is rejected whole; one that
    straddles the floor is continuous, so it is kept whole."""
    clusters = cluster_threads(threads, gap_days)
    if not clusters:
        return [], [], "no conversations"
    latest = clusters[-1]
    older = [t for c in clusters[:-1] for t in c]
    end = latest[-1].last_at
    if end and end.date() < floor:
        return [], latest + older, f"only mail before {floor:%-d %b %Y}"
    note = "one cluster" if len(clusters) == 1 else f"newest of {len(clusters)} clusters"
    return latest, older, note


# ------------------------------------------------------------- helpers ---


def is_noreply(address: str | None) -> bool:
    return bool(address and NOREPLY_RE.search(address.split("@", 1)[0]))


def expandable_addresses(thread: ThreadFacts, own: set[str]) -> set[str]:
    """Addresses on a matched thread worth searching for (one hop): people,
    not robots, not us, not generic shared mailboxes."""
    out: set[str] = set()
    for a in thread.participants:
        if a in own or is_noreply(a):
            continue
        local = a.split("@", 1)[0]
        if local in STOP_LOCAL_TOKENS:
            continue
        out.add(a)
    return out
