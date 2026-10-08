from datetime import date

import pytest

from src.services import public_form
from src.services.public_form import (
    date_problem,
    next_open_day_after,
    normalise_mobile,
    request_receipt_token,
    validate_request,
    verify_request_receipt_token,
)
from tests.ops.conftest import TODAY

CLOSED = {date(2026, 12, 24): "Christmas Eve", date(2026, 12, 31): "New Year's Eve"}


def payload(**overrides):
    base = {
        "group_name": "TEST Bright Start Primary",
        "group_type": "school",
        "area": "Kraaifontein",
        "contact_name": "Tooheera Adams",
        "contact_email": "Tooheera.Adams@Example.COM",
        "contact_mobile": "082 706 9415",
        "visit_date": "2026-11-05",
        "alternative_date": "2026-11-06",
        "adults": "12",
        "children": 88,
        "vehicles": 2,
        "gazebos": 0,
        "arrival_time": "09:30",
        "customer_notes": "Two buses.",
        "questions": ["Is there a kids' pool?", "  ", "Can we braai?"],
        "policy_accepted": True,
        "website": "",
    }
    base.update(overrides)
    return base


def validate(settings, **overrides):
    return validate_request(payload(**overrides), settings, closed_days=CLOSED, today=TODAY)


def test_valid_payload_is_normalised(settings):
    clean, errors = validate(settings)
    assert errors == {}
    assert clean["contact_email"] == "tooheera.adams@example.com"
    assert clean["contact_mobile"] == "27827069415"
    assert clean["visit_date"] == "2026-11-05"
    assert clean["alternative_date"] == "2026-11-06"
    assert clean["adults"] == 12 and clean["children"] == 88
    assert clean["people_booked"] == 100
    assert clean["questions"] == ["Is there a kids' pool?", "Can we braai?"]
    assert clean["enquiry_date"] == TODAY.isoformat()
    assert clean["policy_accepted"] is True


def test_required_fields(settings):
    _, errors = validate(settings, group_name="  ", contact_name=None, contact_email="", contact_mobile="")
    for field in ("group_name", "contact_name", "contact_email", "contact_mobile"):
        assert errors[field] == "This field is required"


def test_group_type_must_be_configured(settings):
    _, errors = validate(settings, group_type="circus")
    assert errors["group_type"] == "Choose a group type from the list"


def test_email_and_mobile_validation(settings):
    _, errors = validate(settings, contact_email="not-an-email", contact_mobile="12345")
    assert errors["contact_email"] == "Enter a valid email address"
    assert "mobile" in errors["contact_mobile"]


def test_foreign_mobile_accepted_when_fully_qualified():
    assert normalise_mobile("+44 20 7946 0958") == "442079460958"
    assert normalise_mobile("0827069415") == "27827069415"
    assert normalise_mobile("hello") is None


@pytest.mark.parametrize(
    "value, message",
    [
        ("2026-10-08", "Choose a date after today"),
        ("2026-10-07", "Choose a date after today"),
        ("2026-10-22", "The season opens on 31 October 2026"),
        ("2026-11-02", "We are closed on Mondays and Tuesdays. The next open day is Wednesday 4 November."),
        ("2026-11-03", "We are closed on Mondays and Tuesdays. The next open day is Wednesday 4 November."),
        ("2026-12-24", "The park is closed on 24 December 2026 (Christmas Eve). The next open day is Friday 25 December."),
        ("2027-05-06", "The season ends on 30 April 2027"),
        ("05/11/2026", "Enter a date as YYYY-MM-DD"),
    ],
)
def test_visit_date_rules(settings, value, message):
    _, errors = validate(settings, visit_date=value, alternative_date=None)
    assert errors["visit_date"] == message


def test_visit_date_required(settings):
    _, errors = validate(settings, visit_date="")
    assert errors["visit_date"] == "This field is required"


def test_date_problem_accepts_open_days(settings):
    assert date_problem(date(2026, 11, 5), settings, CLOSED, TODAY) is None
    assert date_problem(date(2026, 10, 31), settings, CLOSED, TODAY) is None  # opening day
    assert date_problem(date(2027, 4, 30), settings, CLOSED, TODAY) is None  # last day


def test_alternative_date_rules(settings):
    _, errors = validate(settings, alternative_date="2026-11-05")
    assert errors["alternative_date"] == "Choose a different date from your first choice"
    _, errors = validate(settings, alternative_date="2026-12-31")
    assert errors["alternative_date"].startswith("The park is closed on 31 December 2026")
    clean, errors = validate(settings, alternative_date=None)
    assert errors == {} and clean["alternative_date"] is None


TOO_SMALL = "Group bookings are for 10 or more people. For smaller groups, buy day tickets on Quicket."


def test_group_size_minimum(settings):
    _, errors = validate(settings, visitors=9)
    assert errors["visitors"] == TOO_SMALL
    _, errors = validate(settings, adults=4, children=5)
    assert errors["visitors"] == TOO_SMALL
    clean, errors = validate(settings, visitors=10)
    assert errors == {} and clean["people_booked"] == 10
    clean, errors = validate(settings, adults=None, children=10)
    assert errors == {} and clean["adults"] == 0 and clean["people_booked"] == 10


def test_group_size_maximum_names_the_phone(settings):
    _, errors = validate(settings, visitors=901)
    assert errors["visitors"] == "For more than 900 people please phone us on 081 461 4246."
    clean, errors = validate(settings, visitors=900)
    assert errors == {} and clean["people_booked"] == 900
    settings["form"]["max_group_size"] = 500
    _, errors = validate(settings, visitors=600)
    assert errors["visitors"].startswith("For more than 500 people")


def test_visitors_wins_over_adults_and_children(settings):
    clean, errors = validate(settings, visitors=45, adults=12, children=88)
    assert errors == {} and clean["people_booked"] == 45 and "visitors" not in clean


def test_arrival_time_must_be_a_slot(settings):
    clean, errors = validate(settings, arrival_time="09:30")
    assert errors == {} and clean["arrival_time"] == "09:30"
    clean, errors = validate(settings, arrival_time="Not sure yet")
    assert errors == {} and clean["arrival_time"] == "Not sure yet"
    _, errors = validate(settings, arrival_time="about ten")
    assert errors["arrival_time"] == "Choose an arrival time from the list"
    clean, errors = validate(settings, arrival_time="")
    assert errors == {} and clean["arrival_time"] is None
    settings["form"]["arrival_slots"] = ["08:00"]
    _, errors = validate(settings, arrival_time="09:30")
    assert "arrival_time" in errors


def test_gazebos_capped_at_the_park_fleet(settings):
    clean, errors = validate(settings, gazebos=7)
    assert errors == {} and clean["gazebos"] == 7
    _, errors = validate(settings, gazebos=8)
    assert errors["gazebos"] == "We have 7 gazebos to hire"


def test_next_open_day_after(settings):
    assert next_open_day_after(date(2026, 11, 2), settings, CLOSED, TODAY) == date(2026, 11, 4)
    assert next_open_day_after(date(2026, 12, 23), settings, CLOSED, TODAY) == date(2026, 12, 25)
    assert next_open_day_after(date(2027, 4, 30), settings, CLOSED, TODAY) is None  # season over


def test_counts_must_be_whole_non_negative(settings):
    _, errors = validate(settings, adults="twelve", children=-1, vehicles=1.5, gazebos=True)
    assert errors["adults"] == "Enter a whole number"
    assert errors["children"] == "Must be 0 or more"
    assert errors["vehicles"] == "Enter a whole number"
    assert errors["gazebos"] == "Enter a whole number"


def test_question_limits(settings):
    _, errors = validate(settings, questions=["q"] * 6)
    assert errors["questions"] == "You can ask up to 5 questions"
    _, errors = validate(settings, questions=["x" * 501])
    assert errors["questions"] == "Keep each question under 500 characters"
    _, errors = validate(settings, questions="just one question as a string")
    assert errors == {}
    _, errors = validate(settings, questions={"not": "a list"})
    assert errors["questions"] == "Questions must be a list"


def test_text_lengths(settings):
    _, errors = validate(settings, arrival_time="x" * 21, customer_notes="y" * 2001, group_name="z" * 256)
    assert errors["arrival_time"] == "Keep this under 20 characters"
    assert errors["customer_notes"] == "Keep this under 2000 characters"
    assert errors["group_name"] == "Keep this under 255 characters"


def test_policy_and_honeypot(settings):
    _, errors = validate(settings, policy_accepted=False)
    assert errors["policy_accepted"] == "Agree to the booking terms to send your request"
    _, errors = validate(settings, policy_accepted="true")
    assert "policy_accepted" not in errors
    _, errors = validate(settings, website="http://spam.example")
    assert errors["website"] == "Leave this field empty"


def test_non_dict_payload(settings):
    _, errors = validate_request(None, settings, closed_days=CLOSED, today=TODAY)
    assert errors["group_name"] == "This field is required"


# ------------------------------------------------------------- receipt ---

def test_request_receipt_token_round_trip():
    token = request_receipt_token(123)
    assert token and isinstance(token, str)
    assert verify_request_receipt_token(token, 123) == (True, "")
    assert verify_request_receipt_token(token, 124) == (False, "mismatch")
    assert verify_request_receipt_token("garbage", 123) == (False, "invalid")
    assert verify_request_receipt_token(None, 123) == (False, "missing")


def test_request_receipt_token_expires_and_checks_purpose(monkeypatch):
    import jwt as pyjwt

    expired = request_receipt_token(5, ttl_days=-1)
    assert verify_request_receipt_token(expired, 5) == (False, "expired")
    secret = public_form._receipt_secret()
    other = pyjwt.encode({"booking_id": 5, "purpose": "ticket_image"}, secret, algorithm="HS256")
    assert verify_request_receipt_token(other, 5) == (False, "purpose")


def test_acknowledgement_is_off_by_default_and_never_raises(settings, monkeypatch):
    booking = {"id": 1, "reference": "FY1", "contact_email": "x@example.test"}
    assert public_form.send_acknowledgement_if_enabled(booking, settings) is None
    settings["form"]["acknowledgement_enabled"] = True
    calls = []

    def fake_send(**kw):
        calls.append(kw)
        return {"id": 9, "send_status": "sent"}

    from src.services import mail_send

    monkeypatch.setattr(mail_send, "send_email", fake_send)
    monkeypatch.setattr(
        "src.services.email_templates.render_email",
        lambda kind, b, s, **ctx: type("R", (), {"subject": "s", "html": "h", "text": "t"})(),
    )
    out = public_form.send_acknowledgement_if_enabled(booking, settings)
    assert out == {"id": 9, "send_status": "sent"}
    assert calls and calls[0]["to"] == ["x@example.test"] and calls[0]["kind"] == "acknowledgement"
    assert calls[0]["booking_id"] == 1 and calls[0]["actor"] is None

    def boom(**kw):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(mail_send, "send_email", boom)
    assert public_form.send_acknowledgement_if_enabled(booking, settings) is None  # logged, not raised
    assert public_form.send_acknowledgement_if_enabled({**booking, "contact_email": None}, settings) is None
