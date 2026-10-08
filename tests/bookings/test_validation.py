"""Input normalisation and payload validation in the booking service (no DB)."""

import copy
from datetime import date
from decimal import Decimal

import pytest

from src.services import booking as bs
from src.services import pricing
from src.services.settings import DEFAULTS, Settings

TIERS = {"school_weekday": 70, "public_weekend": 115}


@pytest.fixture
def s():
    return Settings(copy.deepcopy(DEFAULTS))


@pytest.fixture(autouse=True)
def patched_tiers(monkeypatch):
    monkeypatch.setattr(
        pricing, "get_price_tier", lambda code: {"code": code, "price": TIERS[code]} if code in TIERS else None
    )
    monkeypatch.setattr(pricing, "load_season_days", lambda a, b: {})


# ---------------------------------------------------------- normalisers ---

@pytest.mark.parametrize(
    "raw, expected",
    [
        ("082 123 4567", "27821234567"),
        ("+27 82 123 4567", "27821234567"),
        ("27821234567", "27821234567"),
        ("0821234567", "27821234567"),
        ("", None),
        (None, None),
    ],
)
def test_normalise_mobile(raw, expected):
    assert bs.normalise_mobile(raw) == expected


@pytest.mark.parametrize("raw", ["12", "abc", "0821", "+1 555"])
def test_normalise_mobile_rejects_junk(raw):
    with pytest.raises(bs.BookingError) as exc:
        bs.normalise_mobile(raw)
    assert "contact_mobile" in exc.value.fields


def test_normalise_email():
    assert bs.normalise_email("  Jane.Doe@Example.COM ") == "jane.doe@example.com"
    assert bs.normalise_email("") is None
    with pytest.raises(bs.BookingError):
        bs.normalise_email("not-an-email")


def test_parse_money():
    assert bs.parse_money("1,234.5", "amount") == Decimal("1234.50")
    assert bs.parse_money(70, "amount") == Decimal("70.00")
    assert bs.parse_money("", "amount") is None
    with pytest.raises(bs.BookingError):
        bs.parse_money("-1", "amount")
    with pytest.raises(bs.BookingError):
        bs.parse_money("ten", "amount")


def test_parse_int_and_date():
    assert bs.parse_int("12", "adults") == 12
    with pytest.raises(bs.BookingError):
        bs.parse_int("-1", "adults")
    assert bs.parse_date("2026-11-12", "visit_date") == date(2026, 11, 12)
    assert bs.parse_date("2026-11-12T10:00:00", "visit_date") == date(2026, 11, 12)
    with pytest.raises(bs.BookingError):
        bs.parse_date("12/11/2026", "visit_date")


# --------------------------------------------------------- full payload ---

def test_create_payload_requires_core_fields(s):
    with pytest.raises(bs.BookingError) as exc:
        bs.validate_booking_data({}, partial=False, settings=s)
    assert set(exc.value.fields) == {"group_name", "contact_name", "visit_date"}


def test_create_payload_collects_every_field_error(s):
    with pytest.raises(bs.BookingError) as exc:
        bs.validate_booking_data(
            {
                "group_name": "TEST",
                "contact_name": "x",
                "visit_date": "soon",
                "contact_mobile": "12",
                "contact_email": "nope",
                "group_type": "zoo",
                "price_tier_code": "gold",
                "adults": -3,
            },
            partial=False,
            settings=s,
        )
    assert set(exc.value.fields) == {
        "visit_date",
        "contact_mobile",
        "contact_email",
        "group_type",
        "price_tier_code",
        "adults",
    }


def test_partial_payload_only_checks_present_keys(s):
    clean = bs.validate_booking_data({"people_booked": "60"}, partial=True, settings=s)
    assert clean == {"people_booked": 60}


def test_payload_is_coerced(s):
    clean = bs.validate_booking_data(
        {
            "group_name": "  TEST School ",
            "contact_name": "Jane",
            "visit_date": "2026-11-12",
            "contact_email": "JANE@X.ORG",
            "contact_mobile": "082 123 4567",
            "price_per_person": "70",
            "deposit_waived": "true",
            "price_tier_code": "school_weekday",
            "unknown_key": "ignored",
        },
        partial=False,
        settings=s,
    )
    assert clean["group_name"] == "TEST School"
    assert clean["contact_email"] == "jane@x.org"
    assert clean["contact_mobile"] == "27821234567"
    assert clean["price_per_person"] == Decimal("70.00")
    assert clean["deposit_waived"] is True
    assert "unknown_key" not in clean


def test_create_only_fields(s):
    clean = bs.validate_booking_data(
        {
            "group_name": "TEST",
            "contact_name": "x",
            "visit_date": "2026-11-12",
            "status": "confirmed",
            "doc_number": "1650",
            "questions": ["Shade?", "  ", "Braai?"],
            "confirmed_at": "2026-09-01T10:00:00",
        },
        partial=False,
        settings=s,
    )
    assert clean["status"] == "confirmed"
    assert clean["doc_number"] == 1650
    assert clean["questions"] == ["Shade?", "Braai?"]
    assert clean["confirmed_at"].year == 2026
    # Not accepted on PATCH.
    partial = bs.validate_booking_data({"status": "confirmed", "doc_number": 1}, partial=True, settings=s)
    assert partial == {}


# ------------------------------------------------------- price derivation --

def test_derive_pricing_on_create(s):
    fields = bs._derive_pricing(
        {}, {"visit_date": date(2026, 11, 12), "group_type": "school", "people_booked": 55}, s
    )
    assert fields["price_tier_code"] == "school_weekday"
    assert fields["price_per_person"] == Decimal("70.00")
    assert fields["price_overridden"] == 0
    assert fields["deposit_due"] == Decimal("2800.00")
    assert fields["deposit_overridden"] == 0


def test_explicit_price_equal_to_default_is_not_an_override(s):
    fields = bs._derive_pricing(
        {},
        {"visit_date": date(2026, 11, 12), "group_type": "school", "people_booked": 55, "price_per_person": Decimal("70")},
        s,
    )
    assert fields["price_overridden"] == 0


def test_explicit_different_price_is_an_override_and_survives_date_change(s):
    base = bs._derive_pricing(
        {},
        {
            "visit_date": date(2026, 11, 12),
            "group_type": "school",
            "people_booked": 55,
            "price_per_person": Decimal("60"),
            "price_override_reason": "Returning group",
        },
        s,
    )
    assert base["price_overridden"] == 1 and base["price_per_person"] == Decimal("60.00")
    assert base["deposit_due"] == Decimal("2400.00")  # 40 × 60
    row = {**base, "visit_date": date(2026, 11, 12), "group_type": "school", "people_booked": 55}
    moved = bs._derive_pricing(row, {"visit_date": date(2026, 12, 17)}, s)  # no-discount window
    assert moved["price_overridden"] == 1 and moved["price_per_person"] == Decimal("60.00")
    assert moved["price_tier_code"] == "public_weekend"
    cleared = bs._derive_pricing(row, {"price_overridden": False}, s)
    assert cleared["price_overridden"] == 0 and cleared["price_per_person"] == Decimal("70.00")


def test_deposit_override_and_waiver(s):
    base_row = {
        "visit_date": date(2026, 11, 12),
        "group_type": "school",
        "people_booked": 55,
        "price_tier_code": "school_weekday",
        "price_per_person": Decimal("70.00"),
        "price_overridden": 0,
        "deposit_due": Decimal("2800.00"),
        "deposit_overridden": 0,
        "deposit_waived": 0,
    }
    custom = bs._derive_pricing(base_row, {"deposit_due": Decimal("1000"), "deposit_override_reason": "Agreed"}, s)
    assert custom["deposit_overridden"] == 1 and custom["deposit_due"] == Decimal("1000.00")
    kept = bs._derive_pricing({**base_row, **custom}, {"people_booked": 200}, s)
    assert kept["deposit_due"] == Decimal("1000.00")  # override preserved on recalculation
    waived = bs._derive_pricing(base_row, {"deposit_waived": True}, s)
    assert waived["deposit_due"] == Decimal("0.00") and waived["deposit_waived"] == 1
    unwaived = bs._derive_pricing({**base_row, **waived}, {"deposit_waived": False}, s)
    assert unwaived["deposit_due"] == Decimal("2800.00") and unwaived["deposit_waived"] == 0


def test_people_change_recalculates_deposit_when_not_overridden(s):
    row = {
        "visit_date": date(2026, 11, 12),
        "group_type": "school",
        "people_booked": 55,
        "price_tier_code": "school_weekday",
        "price_per_person": Decimal("70.00"),
        "price_overridden": 0,
        "deposit_due": Decimal("2800.00"),
        "deposit_overridden": 0,
        "deposit_waived": 0,
    }
    out = bs._derive_pricing(row, {"people_booked": 200}, s)
    assert out["deposit_due"] == Decimal("4200.00")
    assert out["price_tier_code"] == "school_weekday"  # tier kept: date/type unchanged


def test_finance_from_row(s):
    row = {
        "id": 0,
        "price_per_person": Decimal("70.00"),
        "people_booked": 200,
        "deposit_due": Decimal("4200.00"),
        "deposit_waived": 0,
        "arrived_count": 180,
    }
    fin = bs.booking_finance(row, paid_total=Decimal("3200"), settings=s)
    assert fin["total_amount"] == Decimal("14000.00")
    assert fin["vat_amount"] == Decimal("1826.09")
    assert fin["final_amount"] == Decimal("12600.00")
    assert fin["balance_due"] == Decimal("9400.00")
    assert fin["deposit_outstanding"] == Decimal("1000.00")
    assert fin["deposit_covered"] is False
