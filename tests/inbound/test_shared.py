"""A conversation can belong to several bookings (3 Nov 2026): the rules
that put one mail on all of them, run with injected bookings (no database)."""

from datetime import date

from src.services import inbound


def _booking(id_: int, email: str, visit: date, name: str, doc: int) -> dict:
    return {
        "id": id_, "reference": f"FY{doc}", "doc_number": doc, "group_name": name, "area": None,
        "contact_name": "Jill Anthony", "contact_email": email, "contact_mobile": None,
        "visit_date": visit, "status": "confirmed", "email_thread_id": None,
        "emails": {email}, "mobiles": set(),
    }


def _mail(**over) -> dict:
    row = {"id": 1, "gmail_thrid": None, "from_email": "jill@example.org", "from_name": "Jill Anthony", "to_emails": [], "cc_emails": [],
           "subject": "Numbers for Saturday", "body_text": "Hi Linda, the buses are confirmed.", "sent_at": None}
    row.update(over)
    return row


def test_one_contact_several_bookings_on_one_day_is_one_party():
    day = date(2026, 12, 19)
    bookings = [_booking(1, "jill@example.org", day, "Potters house - Mitchells Plain", 1709), _booking(2, "jill@example.org", day, "Potters house - Atlantis", 1710), _booking(3, "jill@example.org", day, "Potters house - Belhar", 1711)]
    chosen, candidates, method = inbound.match_open_booking(_mail(), bookings)
    assert isinstance(chosen, list) and [b["id"] for b in chosen] == [1, 2, 3]
    assert candidates == [] and method == "email+same day"
    assert inbound._same_party(bookings) is True


def test_one_contact_two_days_is_still_a_question():
    bookings = [_booking(1, "rene@example.org", date(2026, 12, 5), "VGK Silversands Sunday School", 1711), _booking(2, "rene@example.org", date(2027, 3, 11), "Dennemere Primary School", 1765)]
    chosen, candidates, method = inbound.match_open_booking(_mail(from_email="rene@example.org", subject="Hello"), bookings)
    assert chosen is None and [b["id"] for b in candidates] == [1, 2] and method == "email"


def test_the_group_name_in_the_mail_still_picks_one_of_two_days():
    bookings = [_booking(1, "rene@example.org", date(2026, 12, 5), "VGK Silversands Sunday School", 1711), _booking(2, "rene@example.org", date(2027, 3, 11), "Dennemere Primary School", 1765)]
    chosen, _candidates, method = inbound.match_open_booking(_mail(from_email="rene@example.org", subject="Dennemere Primary School funday"), bookings)
    assert chosen and chosen["id"] == 2 and method.startswith("email+")
