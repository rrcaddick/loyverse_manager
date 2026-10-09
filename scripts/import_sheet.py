"""Import the old booking sheet (2026/27 season) into ``bookings``.

    python -m scripts.import_sheet --dry-run                 # show the plan
    python -m scripts.import_sheet                           # write it
    python -m scripts.import_sheet --file path/to/export.csv

Sheet layout (one CSV export of the season tab):

    col A  day label such as "Thur 17 Sept 2026" / "Sat, 26 Sept 2026"; a day
           row may itself carry a booking, and rows with an empty column A
           belong to the most recent day above them
    col B  enquiry date M/D/YYYY (sometimes impossible, e.g. 25/27/2026);
           "CLOSED" marks a closure
    col C  group name            col D  area            col E  contact name
    col F  tel (two numbers with / or //, missing 0, O for 0, trailing dots)
    col G  total booked ("45+15" = 60)   col H  price pp ("70/90" = 70)
    col I  INV doc number or free text   col J  deposit paid ("R4,600.00",
           "500+1000+3000", or a note = no deposit)
    col K  invoice updated M/D/YYYY ... col X  comment

Rules: only rows with a group name and a visit date on or after today are
imported. Deposit > 0 -> confirmed (with an EFT payment); otherwise a numeric
INV -> proforma_sent; otherwise enquiry. Historical INV numbers are kept as the
doc_number; the document counter is bumped past the highest number in the
sheet before anything is written so new numbers cannot collide. Idempotent:
a row whose doc_number already exists is skipped, and a row without a number
is skipped when a booking with the same group name and visit date exists.

The parsing helpers at the top are pure and unit-tested in
``tests/ops/test_import_sheet.py``.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

import phonenumbers
from dateutil import parser as dateparser

from config.settings import BASE_DIR
from src.models.base import dumps, execute, query_one, transaction
from src.services.settings import bump_document_number_past
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("import_sheet")

DEFAULT_FILE = BASE_DIR / "data" / "import" / "fy-bookings-2026-27.csv"
IMPORT_REFERENCE = "Imported from booking sheet"

# Zero-based column positions in the export.
COL_DAY = 0
COL_ENQUIRY = 1
COL_GROUP = 2
COL_AREA = 3
COL_CONTACT = 4
COL_TEL = 5
COL_TOTAL = 6
COL_PRICE = 7
COL_INV = 8
COL_DEPOSIT = 9
COL_INVOICE_UPDATED = 10
COL_COMMENT = 23

EXPECTED_HEADERS = {COL_GROUP: "GROUP NAME", COL_INV: "INV", COL_DEPOSIT: "DEP PD", COL_COMMENT: "COMMENT"}

_WEEKDAY_PREFIX = re.compile(
    r"^\s*(mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)[a-z]*\.?,?\s+",
    re.IGNORECASE,
)
_US_DATE = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$")
_PHONE_RUN = re.compile(r"[0Oo]?\d[\d ]*")

# Group-type guesses from the name. Checked in order; word-boundary regexes.
_TYPE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("creche", (r"educare", r"\becd\b", r"cr[eè]che", r"pre-?school", r"play ?school", r"day ?care")),
    ("school", (r"school", r"primary", r"\bhigh\b", r"aftercare", r"after care", r"\bkids?\b", r"\bgr(ade)?\s*\d", r"learners?", r"college")),
    (
        "church",
        (
            r"church", r"apost", r"minist", r"chapel", r"baptist", r"mission", r"gospel", r"congregation",
            r"\bafm\b", r"methodist", r"catholic", r"\bkerk\b", r"\bvgk\b", r"\bngk\b", r"assembl",
            r"\bchrist\b", r"\bjesus\b", r"\bgemeente\b", r"\bphc\b",
        ),
    ),
    ("nonprofit", (r"soccer", r"\bclub\b", r"association", r"society", r"\bngo\b", r"foundation", r"community")),
    ("family", (r"\bfamily\b", r"\bfamilie\b")),
)


# ----------------------------------------------------------------- parsing ---


def clean_cell(value: str | None) -> str:
    """Collapse embedded newlines and runs of whitespace; strip."""
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def parse_day_label(text: str | None) -> date | None:
    """'Thur 17 Sept 2026' / 'Sat, 26 Sept 2026' / 'Thu 01 Oct 2026' -> date."""
    s = clean_cell(text).replace(",", " ")
    if not s or not re.search(r"\d", s):
        return None
    s = _WEEKDAY_PREFIX.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Must look like "<day> <month> <year>" or "<day> <month>" - nothing chatty.
    if not re.fullmatch(r"\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?(\s+\d{4})?", s):
        return None
    try:
        return dateparser.parse(s, dayfirst=True).date()
    except (ValueError, OverflowError):
        return None


def parse_us_date(text: str | None) -> date | None:
    """M/D/YYYY -> date; impossible values such as 25/27/2026 -> None."""
    m = _US_DATE.match(clean_cell(text))
    if not m:
        return None
    month, day, year = (int(x) for x in m.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_int_sum(text: str | None) -> int | None:
    """'900' -> 900, '45+15' -> 60, '' -> None, 'tbc' -> None."""
    s = clean_cell(text).replace(" ", "")
    if not s:
        return None
    if re.fullmatch(r"\d+(\+\d+)+", s):
        return sum(int(p) for p in s.split("+"))
    if re.fullmatch(r"\d+", s):
        return int(s)
    m = re.match(r"(\d+)", s)
    return int(m.group(1)) if m else None


def parse_price(text: str | None) -> Decimal | None:
    """'70' -> 70, '70/90' -> 70, 'R95' -> 95, '' -> None."""
    s = clean_cell(text).replace(" ", "").replace("R", "").replace(",", "")
    if not s:
        return None
    first = s.split("/")[0]
    try:
        value = Decimal(first)
    except InvalidOperation:
        return None
    return value.quantize(Decimal("0.01")) if value > 0 else None


def parse_money(text: str | None) -> Decimal | None:
    """'R4,600.00' -> 4600, '500+1000+3000' -> 4500, 'Conf request sent 27/8' -> None."""
    s = clean_cell(text)
    if not s:
        return None
    compact = s.replace(" ", "").replace(",", "").replace("R", "").replace("r", "")
    if re.fullmatch(r"\d+(\.\d{1,2})?(\+\d+(\.\d{1,2})?)*", compact):
        total = sum((Decimal(p) for p in compact.split("+")), Decimal(0))
        return total.quantize(Decimal("0.01")) if total > 0 else None
    return None


def parse_doc_number(text: str | None) -> int | None:
    """'1473' -> 1473; 'Will pay at the gate' -> None."""
    s = clean_cell(text).replace(" ", "")
    s = re.sub(r"^(FY|INV)", "", s, flags=re.IGNORECASE)
    return int(s) if re.fullmatch(r"\d{3,6}", s) else None


def phone_candidates(text: str | None) -> list[str]:
    """Digit runs in a messy tel cell, in order, with O->0 and spaces removed."""
    out = []
    for m in _PHONE_RUN.finditer(clean_cell(text)):
        digits = m.group(0).replace(" ", "").replace("O", "0").replace("o", "0")
        if len(digits) >= 9:
            out.append(digits)
    return out


def normalise_phone(text: str | None) -> tuple[str | None, str | None]:
    """First usable number as E.164 digits (no plus), plus a warning or None.

    Handles two numbers split by '/' or '//', a missing leading 0 (9 digits),
    the letter O for 0, names mixed in ('Michelle 079 ...') and trailing dots.
    """
    raw = clean_cell(text)
    if not raw:
        return None, None
    candidates = phone_candidates(raw)
    warning = None
    for digits in candidates:
        if len(digits) == 9:
            digits = "0" + digits
        try:
            number = phonenumbers.parse(digits, "ZA")
        except phonenumbers.NumberParseException:
            continue
        if phonenumbers.is_valid_number(number) or phonenumbers.is_possible_number(number):
            if not phonenumbers.is_valid_number(number):
                warning = f"Phone {digits} is unusual for South Africa; kept as given"
            if len(candidates) > 1:
                warning = f"Several numbers in '{raw}'; kept the first"
            return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164).lstrip("+"), warning
    return None, f"Could not read a phone number from '{raw}'"


def guess_group_type(name: str | None) -> str:
    lowered = clean_cell(name).lower()
    for code, patterns in _TYPE_RULES:
        for pattern in patterns:
            if re.search(pattern, lowered):
                return code
    return "other"


# ------------------------------------------------------------------- rows ---


@dataclass
class SheetBooking:
    row_number: int
    visit_date: date | None
    group_name: str
    area: str | None
    contact_name: str | None
    contact_mobile: str | None
    people_booked: int
    price_per_person: Decimal | None
    doc_number: int | None
    deposit: Decimal | None
    enquiry_date: date | None
    invoice_updated: date | None
    comment: str | None
    raw: dict[str, str]
    warnings: list[str] = field(default_factory=list)

    @property
    def status(self) -> str:
        if self.deposit and self.deposit > 0:
            return "confirmed"
        if self.doc_number is not None:
            return "proforma_sent"
        return "enquiry"

    @property
    def group_type(self) -> str:
        return guess_group_type(self.group_name)

    def paid_on(self, today: date) -> date:
        return self.invoice_updated or self.enquiry_date or today

    def proforma_sent_at(self, today: date) -> datetime:
        return datetime.combine(self.invoice_updated or self.enquiry_date or today, time(9, 0))


def _cell(row: list[str], index: int) -> str:
    return row[index] if index < len(row) else ""


def _is_name_only(row: list[str]) -> bool:
    """A group name with nothing else is a scribble, not a booking."""
    others = [COL_ENQUIRY, COL_AREA, COL_CONTACT, COL_TEL, COL_TOTAL, COL_PRICE, COL_INV, COL_DEPOSIT]
    return not any(clean_cell(_cell(row, i)) for i in others)


def parse_sheet(rows: Iterable[list[str]]) -> tuple[list[SheetBooking], list[tuple[int, str]]]:
    """Walk the CSV rows. Returns (bookings, notes) where notes are
    (row_number, message) for rows that were skipped or looked odd."""
    bookings: list[SheetBooking] = []
    notes: list[tuple[int, str]] = []
    headers: list[str] = []
    current_day: date | None = None
    for number, row in enumerate(rows, start=1):
        if number == 1:
            headers = [clean_cell(h) for h in row]
            for idx, expected in EXPECTED_HEADERS.items():
                if clean_cell(_cell(row, idx)).upper() != expected:
                    notes.append((number, f"Header {idx + 1} is '{_cell(row, idx)}', expected '{expected}'"))
            continue
        day_label = clean_cell(_cell(row, COL_DAY))
        if day_label:
            parsed = parse_day_label(day_label)
            if parsed is None:
                notes.append((number, f"Could not read day label '{day_label}'"))
            current_day = parsed
        if clean_cell(_cell(row, COL_ENQUIRY)).upper() == "CLOSED":
            continue
        group_name = clean_cell(_cell(row, COL_GROUP))
        if not group_name:
            continue
        if _is_name_only(row):
            notes.append((number, f"'{group_name}' has a name only; skipped"))
            continue

        warnings: list[str] = []
        contact = clean_cell(_cell(row, COL_CONTACT)) or None
        if contact is None:
            warnings.append("No contact name; group name used")
        mobile, phone_warning = normalise_phone(_cell(row, COL_TEL))
        if phone_warning:
            warnings.append(phone_warning)
        enquiry_raw = clean_cell(_cell(row, COL_ENQUIRY))
        enquiry = parse_us_date(enquiry_raw)
        if enquiry_raw and enquiry is None:
            warnings.append(f"Enquiry date '{enquiry_raw}' is not a valid date")
        invoice_raw = clean_cell(_cell(row, COL_INVOICE_UPDATED))
        invoice_updated = parse_us_date(invoice_raw)
        if invoice_raw and invoice_updated is None:
            warnings.append(f"Invoice-updated date '{invoice_raw}' is not a valid date")
        people = parse_int_sum(_cell(row, COL_TOTAL))
        if people is None:
            warnings.append("No total booked; recorded as 0")
        price = parse_price(_cell(row, COL_PRICE))
        inv_raw = clean_cell(_cell(row, COL_INV))
        doc_number = parse_doc_number(inv_raw)
        if inv_raw and doc_number is None:
            warnings.append(f"INV '{inv_raw}' is not a number; treated as enquiry")
        deposit_raw = clean_cell(_cell(row, COL_DEPOSIT))
        deposit = parse_money(deposit_raw)
        if deposit_raw and deposit is None:
            warnings.append(f"Deposit cell '{deposit_raw}' is a note, not an amount")
        if current_day is None:
            warnings.append("No readable visit date above this row")

        raw = {headers[i] if i < len(headers) and headers[i] else f"col{i + 1}": _cell(row, i) for i in range(len(row))}
        raw = {k: v for k, v in raw.items() if v.strip()}
        raw["_row"] = str(number)

        bookings.append(
            SheetBooking(
                row_number=number,
                visit_date=current_day,
                group_name=group_name,
                area=clean_cell(_cell(row, COL_AREA)) or None,
                contact_name=contact,
                contact_mobile=mobile,
                people_booked=people or 0,
                price_per_person=price,
                doc_number=doc_number,
                deposit=deposit,
                enquiry_date=enquiry,
                invoice_updated=invoice_updated,
                comment=clean_cell(_cell(row, COL_COMMENT)) or None,
                raw=raw,
                warnings=warnings,
            )
        )
    return bookings, notes


def read_csv(path: Path) -> list[list[str]]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return list(csv.reader(fh))


# ------------------------------------------------------------------- plan ---


@dataclass
class PlanItem:
    booking: SheetBooking
    action: str  # create | skip
    reason: str = ""


def _existing_by_doc(doc_number: int) -> dict | None:
    return query_one("SELECT id, reference FROM bookings WHERE doc_number = %s", (doc_number,))


def _existing_by_name_date(group_name: str, visit: date) -> dict | None:
    return query_one(
        "SELECT id, reference FROM bookings WHERE LOWER(TRIM(group_name)) = %s AND visit_date = %s",
        (group_name.strip().lower(), visit),
    )


def build_plan(bookings: list[SheetBooking], today: date, from_date: date | None = None) -> list[PlanItem]:
    cutoff = from_date or today
    plan: list[PlanItem] = []
    seen_docs: set[int] = set()
    seen_keys: set[tuple[str, date]] = set()
    for b in bookings:
        if b.visit_date is None:
            plan.append(PlanItem(b, "skip", "no visit date"))
            continue
        if b.visit_date < cutoff:
            plan.append(PlanItem(b, "skip", "past"))
            continue
        key = (b.group_name.lower(), b.visit_date)
        if b.doc_number is not None:
            if b.doc_number in seen_docs:
                plan.append(PlanItem(b, "skip", f"doc {b.doc_number} appears twice in the sheet"))
                continue
            existing = _existing_by_doc(b.doc_number)
            if existing:
                plan.append(PlanItem(b, "skip", f"doc {b.doc_number} exists as {existing['reference']}"))
                continue
            seen_docs.add(b.doc_number)
        else:
            if key in seen_keys:
                plan.append(PlanItem(b, "skip", "same group and date appears twice in the sheet"))
                continue
            existing = _existing_by_name_date(b.group_name, b.visit_date)
            if existing:
                plan.append(PlanItem(b, "skip", f"same group and date exists as {existing['reference']}"))
                continue
        seen_keys.add(key)
        plan.append(PlanItem(b, "create"))
    return plan


# ----------------------------------------------------------------- import ---


def booking_data(b: SheetBooking, today: date) -> dict[str, Any]:
    """The dict handed to ``create_booking``."""
    data: dict[str, Any] = {
        "group_name": b.group_name,
        "group_type": b.group_type,
        "area": b.area,
        "contact_name": b.contact_name or b.group_name,
        "contact_email": None,
        "contact_mobile": b.contact_mobile,
        "visit_date": b.visit_date.isoformat() if b.visit_date else None,
        "alternative_date": None,
        "adults": 0,
        "children": 0,
        "people_booked": b.people_booked,
        "vehicles": 0,
        "gazebos": 0,
        "enquiry_date": (b.enquiry_date or today).isoformat(),
        "customer_notes": b.comment,
        "internal_notes": f"Imported from the 2026/27 booking sheet on {today.isoformat()} (row {b.row_number})",
        "legacy_sheet_row": b.raw,
    }
    if b.price_per_person is not None:
        data["price_per_person"] = str(b.price_per_person)
        data["price_overridden"] = True
        data["price_override_reason"] = IMPORT_REFERENCE
    status = b.status
    data["status"] = status
    if status in ("proforma_sent", "confirmed"):
        data["proforma_sent_at"] = b.proforma_sent_at(today).isoformat(sep=" ")
    if status == "confirmed":
        data["confirmed_at"] = datetime.combine(b.paid_on(today), time(9, 0)).isoformat(sep=" ")
    return data


def _apply_import_state(booking_id: int, b: SheetBooking, today: date) -> None:
    """Pin the import-specific fields whichever create path ran: status, the
    sheet's dates for the stamps, source, notes and the raw row."""
    status = b.status
    # A visit that has already happened is history: completed, whatever the
    # sheet said about its deposit. Arrivals are unknown, so none are recorded.
    is_past = b.visit_date is not None and b.visit_date < today
    final_status = "completed" if is_past else status
    completed_at = datetime.combine(b.visit_date, time(17, 0)) if is_past else None
    with transaction() as conn:
        execute(
            """
            UPDATE bookings
            SET status = %s,
                source = 'import',
                proforma_sent_at = CASE WHEN %s IN ('proforma_sent', 'confirmed') THEN %s ELSE NULL END,
                confirmed_at = CASE WHEN %s = 'confirmed' THEN %s ELSE NULL END,
                completed_at = %s,
                enquiry_date = %s,
                internal_notes = %s,
                legacy_sheet_row = %s,
                customer_notes = COALESCE(customer_notes, %s)
            WHERE id = %s
            """,
            (
                final_status,
                status,
                b.proforma_sent_at(today),
                status,
                datetime.combine(b.paid_on(today), time(9, 0)),
                completed_at,
                b.enquiry_date or today,
                f"Imported from the 2026/27 booking sheet on {today.isoformat()} (row {b.row_number})",
                dumps(b.raw),
                b.comment,
                booking_id,
            ),
            conn=conn,
        )
        if final_status != "enquiry":
            execute(
                """
                INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id)
                VALUES (%s, 'status_changed', %s, %s, NULL)
                """,
                (
                    booking_id,
                    f"Imported as {final_status} from the booking sheet"
                    + (f" (visit on {b.visit_date.isoformat()} is in the past)" if is_past else ""),
                    dumps({"from": "enquiry", "to": final_status, "sheet_status": status, "sheet_row": b.row_number}),
                ),
                conn=conn,
            )


def import_one(b: SheetBooking, today: date) -> dict:
    from src.services.public_form import create_booking_compat, record_payment_compat

    booking = create_booking_compat(booking_data(b, today), source="import", actor=None, doc_number=b.doc_number)
    booking_id = int(booking["id"])
    if b.deposit and b.deposit > 0:
        record_payment_compat(
            booking_id,
            "eft",
            b.deposit,
            b.paid_on(today),
            IMPORT_REFERENCE,
            f"Deposit as recorded on the sheet (row {b.row_number})",
            None,
        )
    _apply_import_state(booking_id, b, today)
    return booking


def run_import(plan: list[PlanItem], today: date, max_doc: int | None) -> dict:
    run_id = execute(
        "INSERT INTO import_runs (kind, started_at, status) VALUES ('booking_sheet', %s, 'running')",
        (datetime.now(),),
    )
    created: list[dict] = []
    failed: list[dict] = []
    try:
        if max_doc is not None:
            # Before any insert, so freshly assigned numbers cannot collide
            # with historical ones later in the sheet.
            bump_document_number_past(max_doc)
        for item in plan:
            if item.action != "create":
                continue
            try:
                booking = import_one(item.booking, today)
                created.append(
                    {"row": item.booking.row_number, "reference": booking.get("reference"), "group_name": item.booking.group_name}
                )
            except Exception as exc:  # noqa: BLE001 - keep going, report at the end
                logger.error(f"Row {item.booking.row_number} failed: {type(exc).__name__}: {exc}")
                failed.append({"row": item.booking.row_number, "group_name": item.booking.group_name, "error": str(exc)})
        summary = _summary(plan, created, failed)
        execute(
            "UPDATE import_runs SET finished_at = %s, status = %s, summary = %s WHERE id = %s",
            (datetime.now(), "failed" if failed and not created else "done", dumps(summary), run_id),
        )
        return summary
    except Exception as exc:
        execute(
            "UPDATE import_runs SET finished_at = %s, status = 'failed', summary = %s WHERE id = %s",
            (datetime.now(), dumps({"error": str(exc), "created": created, "failed": failed}), run_id),
        )
        raise


def _summary(plan: list[PlanItem], created: list[dict], failed: list[dict]) -> dict:
    skipped = [
        {"row": i.booking.row_number, "group_name": i.booking.group_name, "reason": i.reason}
        for i in plan
        if i.action == "skip"
    ]
    warnings = [
        {"row": i.booking.row_number, "group_name": i.booking.group_name, "warnings": i.booking.warnings}
        for i in plan
        if i.action == "create" and i.booking.warnings
    ]
    return {
        "created": created,
        "created_count": len(created),
        "failed": failed,
        "skipped": skipped,
        "skipped_count": len(skipped),
        "skipped_past": sum(1 for s in skipped if s["reason"] == "past"),
        "warnings": warnings,
    }


# ------------------------------------------------------------------ output ---


def _table(rows: list[list[str]], headers: list[str]) -> str:
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    lines = [fmt.format(*headers), fmt.format(*["-" * w for w in widths])]
    lines.extend(fmt.format(*row) for row in rows)
    return "\n".join(lines)


def print_plan(plan: list[PlanItem], today: date, show_past: bool = False) -> None:
    rows = []
    for item in plan:
        b = item.booking
        if item.reason == "past" and not show_past:
            continue
        rows.append(
            [
                str(b.row_number),
                b.visit_date.isoformat() if b.visit_date else "?",
                b.group_name[:34],
                b.group_type,
                str(b.people_booked),
                f"{b.price_per_person:.0f}" if b.price_per_person is not None else "-",
                str(b.doc_number) if b.doc_number is not None else "new",
                f"{b.deposit:,.2f}" if b.deposit else "-",
                b.status,
                b.contact_mobile or "-",
                item.action if item.action == "create" else f"skip: {item.reason}",
            ]
        )
    print(_table(rows, ["row", "visit", "group", "type", "ppl", "pp", "doc", "deposit", "status", "mobile", "action"]))
    creates = [i for i in plan if i.action == "create"]
    past = sum(1 for i in plan if i.reason == "past")
    other_skips = sum(1 for i in plan if i.action == "skip" and i.reason != "past")
    print()
    print(f"Today {today.isoformat()}: {len(creates)} to create, {past} past rows ignored, {other_skips} skipped.")
    by_status: dict[str, int] = {}
    for i in creates:
        by_status[i.booking.status] = by_status.get(i.booking.status, 0) + 1
    if by_status:
        print("By status: " + ", ".join(f"{k} {v}" for k, v in sorted(by_status.items())))
    warned = [i for i in creates if i.booking.warnings]
    if warned:
        print(f"\nWarnings ({len(warned)} rows):")
        for i in warned:
            for w in i.booking.warnings:
                print(f"  row {i.booking.row_number:>3} {i.booking.group_name[:30]:<30} {w}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import the old booking sheet into bookings")
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--dry-run", action="store_true", help="Show the plan, write nothing")
    parser.add_argument("--show-past", action="store_true", help="Also list rows before today in the plan")
    parser.add_argument(
        "--from-date", type=date.fromisoformat, default=None,
        help="Import visits on or after this date (default today); earlier visits in range become completed",
    )
    args = parser.parse_args(argv)

    if not args.file.exists():
        print(f"error: {args.file} not found", file=sys.stderr)
        return 1
    today = get_today()
    bookings, notes = parse_sheet(read_csv(args.file))
    for number, note in notes:
        logger.info(f"Row {number}: {note}")
    plan = build_plan(bookings, today, from_date=args.from_date)
    max_doc = max((b.doc_number for b in bookings if b.doc_number is not None), default=None)

    print_plan(plan, today, show_past=args.show_past)
    if notes:
        print(f"\nSheet notes ({len(notes)}):")
        for number, note in notes:
            print(f"  row {number:>3} {note}")
    if args.dry_run:
        print(f"\nDry run: nothing written. Document counter would be bumped past {max_doc}.")
        return 0

    summary = run_import(plan, today, max_doc)
    print()
    print(f"Created {summary['created_count']} booking(s):")
    for c in summary["created"]:
        print(f"  row {c['row']:>3} {c['reference']:<8} {c['group_name']}")
    if summary["failed"]:
        print(f"\nFailed {len(summary['failed'])}:")
        for f in summary["failed"]:
            print(f"  row {f['row']:>3} {f['group_name']}: {f['error']}")
    print(f"\nSkipped {summary['skipped_count']} ({summary['skipped_past']} before today).")
    for s in summary["skipped"]:
        if s["reason"] != "past":
            print(f"  row {s['row']:>3} {s['group_name']}: {s['reason']}")
    logger.info(
        f"Sheet import finished: {summary['created_count']} created, {len(summary['failed'])} failed, "
        f"{summary['skipped_count']} skipped"
    )
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
