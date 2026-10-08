from datetime import date
from decimal import Decimal

import pytest

from scripts.import_sheet import (
    SheetBooking,
    guess_group_type,
    normalise_phone,
    parse_day_label,
    parse_doc_number,
    parse_int_sum,
    parse_money,
    parse_price,
    parse_sheet,
    parse_us_date,
)


@pytest.mark.parametrize(
    "label, expected",
    [
        ("Thur 17 Sept 2026", date(2026, 9, 17)),
        ("Sat, 26 Sept 2026", date(2026, 9, 26)),
        ("Thu 01 Oct 2026", date(2026, 10, 1)),
        ("Wed 09 Dec 2026", date(2026, 12, 9)),
        ("Sun 28 Feb 2027", date(2027, 2, 28)),
        ("\"Mon, 28 Sept 2026\"".strip('"'), date(2026, 9, 28)),
        ("Tues 10 Nov 2026", date(2026, 11, 10)),
        ("NEW SEASON OPENS Saturday 31st October (unless there is a very big booking before)", None),
        ("", None),
        ("SCHOOLS CLOSE 9TH DECEMBER - 12 JANUARY 2027", None),
    ],
)
def test_parse_day_label(label, expected):
    assert parse_day_label(label) == expected


@pytest.mark.parametrize(
    "text, expected",
    [("9/23/2026", date(2026, 9, 23)), ("1/5/2026", date(2026, 1, 5)), ("25/27/2026", None), ("", None), ("27/8", None)],
)
def test_parse_us_date(text, expected):
    assert parse_us_date(text) == expected


@pytest.mark.parametrize(
    "text, expected", [("900", 900), ("45+15", 60), ("", None), ("  7 ", 7), ("tbc", None), ("40 approx", 40)]
)
def test_parse_int_sum(text, expected):
    assert parse_int_sum(text) == expected


@pytest.mark.parametrize(
    "text, expected",
    [("70", Decimal("70.00")), ("70/90", Decimal("70.00")), ("R95", Decimal("95.00")), ("", None), ("free", None)],
)
def test_parse_price(text, expected):
    assert parse_price(text) == expected


@pytest.mark.parametrize(
    "text, expected",
    [
        ("R17,550.00", Decimal("17550.00")),
        ("R4,600.00", Decimal("4600.00")),
        ("500+1000+3000", Decimal("4500.00")),
        ("1000+9000", Decimal("10000.00")),
        ("Conf request sent 27/8", None),
        ("", None),
        ("0", None),
    ],
)
def test_parse_money(text, expected):
    assert parse_money(text) == expected


@pytest.mark.parametrize(
    "text, expected", [("1473", 1473), ("Will pay at the gate", None), ("", None), ("FY1702", 1702), ("12", None)]
)
def test_parse_doc_number(text, expected):
    assert parse_doc_number(text) == expected


@pytest.mark.parametrize(
    "text, expected, warns",
    [
        ("067 281 6521", "27672816521", False),
        ("835787029", "27835787029", False),
        ("O81 368 2393", "27813682393", False),
        ("789680649/0723943776", "27789680649", True),
        ("081 7155 671", "27817155671", False),
        ("Michelle 079 072 8110", "27790728110", False),
        ("067 877 4146.", "27678774146", False),
        ("813384547//063 184 2944", "27813384547", True),
        ("079 254 4119. Church admin 082 425 9932", "27792544119", True),
        ("83 577 0740", "27835770740", False),
        ("081 515 3711\n", "27815153711", False),
        ("", None, False),
        ("call the office", None, True),
    ],
)
def test_normalise_phone(text, expected, warns):
    number, warning = normalise_phone(text)
    assert number == expected
    assert bool(warning) is warns


@pytest.mark.parametrize(
    "name, expected",
    [
        ("Mondale High", "school"),
        ("Kewtown Primary Gr 7", "school"),
        ("Kiana's Angels Aftercare", "school"),
        ("The Ark Educare Centre", "creche"),
        ("Nantes Educare ECD", "creche"),
        ("Bridgetown Moravian Church", "church"),
        ("New Apostilic", "church"),
        ("Making the Difference Ministeries", "church"),
        ("Rocklands Baptist Church", "church"),
        ("AFM Vredehoek", "church"),
        ("Lighthouse family church", "church"),
        ("Goodwood United soccer", "nonprofit"),
        ("Non-denominational Bowling Club", "nonprofit"),
        ("Oasis Association", "nonprofit"),
        ("Daniels Family", "family"),
        ("Timberlea Farms", "other"),
        ("Highway Stores", "other"),
    ],
)
def test_guess_group_type(name, expected):
    assert guess_group_type(name) == expected


HEADER = ["", "Enquiry date", "GROUP NAME", "AREA", "CONTACT NAME", "TEL. NO", "TOT BKD", "PRICE pp", "INV", "DEP PD",
          "INVOICE UPDATED"] + [""] * 12 + ["COMMENT"]


def row(day="", enquiry="", group="", area="", contact="", tel="", total="", price="", inv="", dep="", updated="", comment=""):
    r = [day, enquiry, group, area, contact, tel, total, price, inv, dep, updated] + [""] * 12 + [comment]
    return r


def test_parse_sheet_walks_days_and_continuations():
    rows = [
        HEADER,
        row(day="NEW SEASON OPENS Saturday 31st October"),
        row(day="Thur 24 Sept 2026", enquiry="25/27/2026", group="Daniels Family", contact="Winefred", tel="084 020 0107",
            total="47", price="115", inv="1702", dep="R4,600.00", updated="9/23/2026"),
        row(group="Fiona Brink ", total="11", price="115", inv="Will pay at the gate"),
        row(day="Fri 25 Sept 2026"),
        row(day="Thu 24 Dec 2026", enquiry="CLOSED"),
        row(day="Sat 05 Dec 2026", enquiry="2/21/2026", group="St. Matthew's ", contact="Robinne", tel="067 877 4146.",
            total="150", price="95", inv="1647", comment="Bring own gazebos\n"),
        row(group="New Apostolic Brackenfell        \n"),
        row(group="Buzzling Bumble Bee Educare", enquiry="8/18/2026", contact="Nadia", total="45+15", price="70/90", inv="1699"),
    ]
    bookings, notes = parse_sheet(rows)
    assert [b.group_name for b in bookings] == ["Daniels Family", "Fiona Brink", "St. Matthew's", "Buzzling Bumble Bee Educare"]

    daniels, fiona, matthews, buzzling = bookings
    assert daniels.visit_date == date(2026, 9, 24)
    assert daniels.status == "confirmed"
    assert daniels.deposit == Decimal("4600.00")
    assert daniels.doc_number == 1702
    assert daniels.enquiry_date is None  # 25/27/2026 is impossible
    assert any("Enquiry date" in w for w in daniels.warnings)
    assert daniels.paid_on(date(2026, 10, 8)) == date(2026, 9, 23)
    assert daniels.group_type == "family"
    assert daniels.raw["_row"] == "3"

    assert fiona.visit_date == date(2026, 9, 24)  # continuation row inherits the day
    assert fiona.status == "enquiry"
    assert fiona.contact_name is None and "No contact name" in fiona.warnings[0]
    assert fiona.doc_number is None

    assert matthews.visit_date == date(2026, 12, 5)
    assert matthews.status == "proforma_sent"
    assert matthews.contact_mobile == "27678774146"
    assert matthews.comment == "Bring own gazebos"
    assert matthews.proforma_sent_at(date(2026, 10, 8)).date() == date(2026, 2, 21)

    assert buzzling.people_booked == 60
    assert buzzling.price_per_person == Decimal("70.00")
    assert buzzling.visit_date == date(2026, 12, 5)

    messages = [m for _, m in notes]
    assert any("Could not read day label" in m for m in messages)
    assert any("name only" in m for m in messages)


def test_status_precedence():
    base = dict(row_number=1, visit_date=date(2026, 11, 7), group_name="X", area=None, contact_name="Y",
                contact_mobile=None, people_booked=10, price_per_person=None, enquiry_date=None,
                invoice_updated=None, comment=None, raw={})
    assert SheetBooking(doc_number=None, deposit=None, **base).status == "enquiry"
    assert SheetBooking(doc_number=1700, deposit=None, **base).status == "proforma_sent"
    assert SheetBooking(doc_number=1700, deposit=Decimal("500"), **base).status == "confirmed"
    assert SheetBooking(doc_number=None, deposit=Decimal("500"), **base).status == "confirmed"
