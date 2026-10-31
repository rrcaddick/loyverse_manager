from __future__ import annotations

from datetime import date

from src.services import mail_ingest as mi

BOOKINGS = [
    {"id": 1, "reference": "FY1703", "doc_number": 1703, "status": "proforma_sent", "group_name": "Sunshine Primary",
     "contact_name": "Jo Soap", "contact_email": "jo@sunshine.edu.za", "contact_mobile": "27814614246",
     "visit_date": date(2026, 11, 14), "email_thread_id": 900},
    {"id": 2, "reference": "FY1704", "doc_number": 1704, "status": "enquiry", "group_name": "Hope Church Youth",
     "contact_name": "Pastor Ben", "contact_email": "ben@hopechurch.org.za", "contact_mobile": "27821234567",
     "visit_date": date(2026, 12, 5), "email_thread_id": None},
    {"id": 3, "reference": "FY1600", "doc_number": 1600, "status": "cancelled", "group_name": "Old Group",
     "contact_name": "Jo Soap", "contact_email": "jo@sunshine.edu.za", "contact_mobile": "27830000000",
     "visit_date": date(2026, 1, 1), "email_thread_id": None},
]


def _row(**over):
    base = {"id": 10, "direction": "inbound", "gmail_thrid": 555, "from_email": "someone@else.com",
            "from_name": "Someone", "to_emails": ["bookings@farmyardpark.co.za"], "cc_emails": [],
            "subject": "Hello", "body_text": "Just a question.", "is_auto_generated": 0, "review_status": "none"}
    base.update(over)
    return base


def test_reference_beats_everything(fake_bookings):
    fake_bookings(BOOKINGS)
    row = _row(subject="Re: INV 1704 payment", from_email="jo@sunshine.edu.za", gmail_thrid=900,
               body_text="Call 081 461 4246")
    assert mi.match_message(row) == (2, "reference")


def test_thread_beats_email_and_phone(fake_bookings):
    fake = fake_bookings(BOOKINGS)
    fake.linked_threads[777] = 2
    row = _row(gmail_thrid=777, from_email="jo@sunshine.edu.za", body_text="081 461 4246")
    assert mi.match_message(row) == (2, "thread")
    # bookings.email_thread_id also counts as a thread link
    assert mi.match_message(_row(gmail_thrid=900)) == (1, "thread")


def test_email_prefers_active_booking_then_phone(fake_bookings):
    fake_bookings(BOOKINGS)
    assert mi.match_message(_row(from_email="JO@sunshine.edu.za")) == (1, "email")
    assert mi.match_message(_row(body_text="My number is +27 82 123 4567, thanks")) == (2, "phone")


def test_outbound_matches_on_recipients(fake_bookings):
    fake_bookings(BOOKINGS)
    row = _row(direction="outbound", from_email="bookings@farmyardpark.co.za",
               to_emails=["ben@hopechurch.org.za"], gmail_thrid=None)
    assert mi.match_message(row) == (2, "email")


def test_no_match(fake_bookings):
    fake_bookings(BOOKINGS)
    assert mi.match_message(_row()) == (None, None)


def test_unknown_reference_falls_through_to_email(fake_bookings):
    fake_bookings(BOOKINGS)
    assert mi.match_message(_row(subject="FY9999", from_email="ben@hopechurch.org.za")) == (2, "email")


def test_suggestions_score_and_reasons(fake_bookings):
    fake_bookings(BOOKINGS)
    row = _row(from_name="Jo Soap", from_email="j.soap@sunshine.edu.za", subject="Sunshine Primary outing",
               body_text="Regards, Jo 081 461 4246")
    out = mi.suggest_bookings(row)
    assert out and out[0]["booking_id"] == 1
    reasons = " ".join(out[0]["reasons"])
    assert "Same email domain" in reasons and "mobile" in reasons and "Sender name resembles" in reasons
    assert out[0]["score"] == 1.0
    assert all(s["booking_id"] != 3 or s["score"] < out[0]["score"] for s in out)


def test_suggestions_ignore_free_mail_domains(fake_bookings):
    fake_bookings([dict(BOOKINGS[1], contact_email="ben@gmail.com")])
    out = mi.suggest_bookings(_row(from_email="other@gmail.com", from_name="Nobody", subject="Hi"))
    assert out == []


def test_plan_thread_links_picks_latest_thread_once():
    from datetime import datetime

    bookings = [BOOKINGS[0], dict(BOOKINGS[1], contact_email="jo@sunshine.edu.za")]
    messages = [
        {"id": 1, "gmail_thrid": 100, "direction": "inbound", "from_email": "jo@sunshine.edu.za", "to_emails": [],
         "cc_emails": [], "from_name": "Jo", "subject": "old", "sent_at": datetime(2026, 9, 1), "body_text": ""},
        {"id": 2, "gmail_thrid": 200, "direction": "inbound", "from_email": "jo@sunshine.edu.za", "to_emails": [],
         "cc_emails": [], "from_name": "Jo", "subject": "new", "sent_at": datetime(2026, 10, 1), "body_text": ""},
        {"id": 3, "gmail_thrid": 200, "direction": "outbound", "from_email": "bookings@farmyardpark.co.za",
         "to_emails": ["jo@sunshine.edu.za"], "cc_emails": [], "from_name": "", "subject": "Re: new",
         "sent_at": datetime(2026, 10, 2), "body_text": ""},
        {"id": 4, "gmail_thrid": 300, "direction": "inbound", "from_email": "x@y.z", "to_emails": [], "cc_emails": [],
         "from_name": "Hope Church Youth", "subject": "", "sent_at": datetime(2026, 9, 15), "body_text": ""},
    ]
    plan = mi.plan_thread_links(bookings, messages)
    by_booking = {p["booking_id"]: p for p in plan}
    # Booking 1 (earlier visit) takes the latest shared thread; booking 2 falls back to its fuzzy-name thread.
    assert by_booking[1]["gmail_thrid"] == 200 and by_booking[1]["messages"] == 2
    assert by_booking[2]["gmail_thrid"] == 300 and by_booking[2]["reasons"] == ["name"]
