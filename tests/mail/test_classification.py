from __future__ import annotations

from email.message import EmailMessage

import pytest

from src.services import mail_ingest as mi


@pytest.mark.parametrize(
    "headers,sender,folder,expected",
    [
        ({}, "jo@example.com", "INBOX", False),
        ({"auto-submitted": "auto-replied"}, "jo@example.com", "INBOX", True),
        ({"auto-submitted": "no"}, "jo@example.com", "INBOX", False),
        ({"precedence": "bulk"}, "jo@example.com", "INBOX", True),
        ({"precedence": "list"}, "jo@example.com", "INBOX", True),
        ({"precedence": "first-class"}, "jo@example.com", "INBOX", False),
        ({"list-id": "<news.example.com>"}, "jo@example.com", "INBOX", True),
        ({"list-unsubscribe": "<mailto:x>"}, "jo@example.com", "INBOX", True),
        ({}, "MAILER-DAEMON@googlemail.com", "INBOX", True),
        ({}, "noreply@quicket.co.za", "INBOX", True),
        ({}, "no-reply@accounts.google.com", "INBOX", True),
        ({}, "notification@facebookmail.com", "INBOX", True),
        ({}, "notifications-are-fun@example.com", "INBOX", True),
        ({}, "messaging-service@post.xero.com", "INBOX", True),
        ({}, "newsletter@shop.example", "INBOX", True),
        ({}, "info@school.example", "INBOX", False),
        ({}, "accounts@school.example", "INBOX", False),
        ({}, "bookings@farmyardpark.co.za", "INBOX", True),  # our own address in INBOX
        ({}, "bookings@farmyardpark.co.za", "[Gmail]/Sent Mail", False),
        ({"x-failed-recipients": "a@b.c"}, "x@y.z", "INBOX", True),
    ],
)
def test_detect_auto_generated(headers, sender, folder, expected):
    assert mi.detect_auto_generated(headers, sender, folder, own_address="bookings@farmyardpark.co.za") is expected


# ---------------------------------------------------- the three-layer filter ---


def _raw(headers: dict[str, str], body: str = "Hello") -> bytes:
    """A realistic RFC822 message; ``headers`` may repeat ``Received`` via a list."""
    msg = EmailMessage()
    for name, value in headers.items():
        if isinstance(value, (list, tuple)):
            for v in value:
                msg[name] = v
        else:
            msg[name] = value
    if "To" not in msg:
        msg["To"] = "bookings@farmyardpark.co.za"
    if "Date" not in msg:
        msg["Date"] = "Thu, 08 Oct 2026 08:00:00 +0000"
    msg.set_content(body)
    return msg.as_bytes()


GMAIL_HOP = "from mail-sor-f41.google.com (mail-sor-f41.google.com. [209.85.220.41]) by mx.google.com with SMTPS"


def _row(parsed, **over):
    row = {
        "direction": "inbound", "from_email": parsed.from_email, "subject": parsed.subject,
        "body_text": parsed.text, "to_emails": parsed.to, "cc_emails": parsed.cc, "gmail_thrid": 1,
    }
    row.update(over)
    return row


def test_yoco_receipt_is_dropped_by_sender_shape(fake_bookings):
    fake_bookings([])
    parsed = mi.parse_message(_raw({
        "From": "Yoco <receipts@messaging.yoco.co.za>",
        "Subject": "Receipt from Hose 24 (Pty) Ltd for R750.00",
        "Return-Path": "<bounces+4121@em.messaging.yoco.co.za>",
        "Received": [GMAIL_HOP, "from o1.em.messaging.yoco.co.za (o1.em.messaging.yoco.co.za) by mx.google.com"],
    }, "You paid R750.00 to Hose 24 (Pty) Ltd with your card ending 1234."))
    assert mi.automated_layer(parsed.headers, parsed.from_email, parsed.subject)[0] == 1  # provider in Received
    # Without headers the sender domain is still a provider fingerprint (stored rows have no headers)…
    assert mi.automated_layer({}, parsed.from_email, parsed.subject) == (1, "sender domain via yoco")
    # …and the local part alone is enough on any other host.
    assert mi.automated_layer({}, "receipts@hose24.example", parsed.subject) == (2, "sender receipts@hose24.example (receipts)")
    verdict, reason = mi.classify_automated(parsed, _row(parsed), ignored_rules=[])
    assert verdict == "drop" and reason.startswith("headers:")


def test_absa_payment_notice_is_dropped_unless_it_names_a_booking(fake_bookings):
    fake_bookings([{"id": 7, "doc_number": 1703, "reference": "FY1703", "contact_email": "payer@example.com"}])
    parsed = mi.parse_message(_raw(
        {"From": "ibreply@absa.co.za", "Subject": "Notice of payment: The Farmyard Park",
         "Received": [GMAIL_HOP, "from mta1.absa.co.za by mx.google.com"]},
        "A payment of R1500.00 has been made to The Farmyard Park. Reference: Deposit school trip",
    ))
    layer = mi.automated_layer(parsed.headers, parsed.from_email, parsed.subject)
    assert layer == (2, "sender ibreply@absa.co.za (ibreply)")
    assert mi.classify_automated(parsed, _row(parsed), ignored_rules=[]) == ("drop", "sender: " + layer[1])

    with_ref = mi.parse_message(_raw(
        {"From": "ibreply@absa.co.za", "Subject": "Notice of payment: The Farmyard Park"},
        "A payment of R1500.00 has been made. Reference: FY1703 deposit",
    ))
    verdict, reason = mi.classify_automated(with_ref, _row(with_ref), ignored_rules=[])
    assert verdict == "automated" and "kept for booking 7 (reference)" in reason


def test_mailchimp_newsletter_is_dropped_by_headers(fake_bookings):
    fake_bookings([])
    parsed = mi.parse_message(_raw({
        "From": "The Craft Market <hello@craftmarket.example>",
        "Subject": "October market dates and a special offer",
        "List-Unsubscribe": "<https://craftmarket.us10.list-manage.com/unsubscribe?u=1>, <mailto:unsub@mail.mcsv.net>",
        "X-Mailer": "MailChimp Mailer - **CID12345**",
        "Received": [GMAIL_HOP, "from mail12.atl61.mcsv.net (mail12.atl61.mcsv.net. [205.201.131.12]) by mx.google.com"],
    }))
    assert mi.automated_layer(parsed.headers, parsed.from_email, parsed.subject) == (1, "List-Unsubscribe header")
    assert mi.classify_automated(parsed, _row(parsed), ignored_rules=[])[0] == "drop"
    # Even without the list header the provider fingerprint in X-Mailer / Received is enough.
    parsed2 = mi.parse_message(_raw({
        "From": "The Craft Market <hello@craftmarket.example>", "Subject": "October market dates",
        "X-Mailer": "MailChimp Mailer - **CID12345**",
    }))
    assert mi.automated_layer(parsed2.headers, parsed2.from_email, parsed2.subject) == (1, "x-mailer via mailchimp")
    parsed3 = mi.parse_message(_raw({"From": "Drew <hello@m.articulationmail.com>", "Subject": "Quick question"}))
    assert mi.automated_layer({}, parsed3.from_email, parsed3.subject) == (1, "sender domain via articulationmail")


def test_school_bursar_asking_for_an_invoice_is_a_person(fake_bookings):
    fake_bookings([])
    parsed = mi.parse_message(_raw(
        {"From": "Mrs P Daniels <bursar@hillcrestprimary.org>", "Subject": "Invoice for our visit on 14 November",
         "Received": [GMAIL_HOP, "from outlook.office365.com by mx.google.com"]},
        "Good day\n\nPlease could you send us an invoice for 60 learners and 6 teachers so that "
        "finance can process the payment.\n\nKind regards\nMrs Daniels, Bursar",
    ))
    assert mi.automated_layer(parsed.headers, parsed.from_email, parsed.subject) is None
    assert mi.classify_automated(parsed, _row(parsed), ignored_rules=[]) == (None, None)
    # Accounts departments writing by hand are people too.
    assert mi.automated_layer({}, "accounts@school.example", "Proof of payment") is None
    assert mi.automated_layer({}, "finance.office@school.example", "Re: Invoice INV-5598") is None


def test_subject_hints_are_stored_as_automated_but_replies_and_forwards_are_people(fake_bookings):
    fake_bookings([])
    hint = mi.parse_message(_raw({"From": "Accounts <accounts@vendor.example>", "Subject": "Statement of account - September"}))
    assert mi.automated_layer(hint.headers, hint.from_email, hint.subject) == (3, "subject starts 'Statement'")
    assert mi.classify_automated(hint, _row(hint), ignored_rules=[]) == ("automated", "subject: subject starts 'Statement'")
    assert mi.automated_layer({}, "sales@vendor.example", "Invoice INV-5598 from OKRAN 38 (PTY) LTD") == (3, "subject carries 'Invoice INV-'")
    assert mi.automated_layer({}, "news@shop.example", "Our spring newsletter")[0] == 3
    # A person forwarding a receipt or replying to a notice is a person writing to us.
    assert mi.automated_layer({}, "zdollie@nhhs.co.za", "Fwd: Notice of Payment: The Farmyard Park") is None
    assert mi.automated_layer({}, "sales@reliance.example", "RE: Invoice INV-5598 from OKRAN") is None
    # A certain layer still wins over the subject.
    assert mi.automated_layer({}, "messaging-service@post.xero.com", "Invoice INV-5598 from OKRAN")[0] == 2


def test_ignored_senders_are_treated_as_certain(fake_bookings):
    fake_bookings([{"id": 3, "doc_number": 1800, "contact_email": "creditors@labco.co.za"}])
    rules = [{"id": 1, "pattern": "labco.co.za", "kind": "domain"}, {"id": 2, "pattern": "jo@gmail.com", "kind": "address"}]
    parsed = mi.parse_message(_raw({"From": "Supplier Statements <statements.team@mail.labco.co.za>", "Subject": "Hello"}))
    assert mi.classify_automated(parsed, _row(parsed, from_email="someone@mail.labco.co.za"), rules) == ("drop", "ignored sender @labco.co.za")
    verdict, reason = mi.classify_automated(parsed, _row(parsed, from_email="creditors@labco.co.za"), rules)
    assert verdict == "automated" and "kept for booking 3 (email)" in reason
    assert mi.classify_automated(parsed, _row(parsed, from_email="jo@gmail.com"), rules)[0] == "drop"
    assert mi.classify_automated(parsed, _row(parsed, from_email="jo@gmail.com.example"), rules) == (None, None)
    assert mi.classify_automated(parsed, _row(parsed, direction="outbound"), rules) == (None, None)


def test_sender_tokens_match_whole_words_of_the_local_part():
    assert mi.automated_layer({}, "billing-team@vendor.example", "x")[0] == 2
    assert mi.automated_layer({}, "invoices+ar@vendor.example", "x")[0] == 2
    assert mi.automated_layer({}, "statements.sa@bank.example", "x")[0] == 2
    assert mi.automated_layer({}, "MAILER-DAEMON@googlemail.com", "x")[0] == 2
    assert mi.automated_layer({}, "abilling@vendor.example", "x") is None
    assert mi.automated_layer({}, "jo.alerts-smith@gmail.com", "x")[0] == 2  # 'alerts' token (existing 'alert' rule)


def test_reference_regex_variants():
    text = "Re: FY1703 - deposit paid. Also see INV 1704, inv-1705 and fy1706."
    assert mi.find_references(text) == [1703, 1704, 1705, 1706]


def test_reference_regex_rejects_noise():
    assert mi.find_references("FY12 FY123456 INVOICE1703 ify1703 FY 1703x") == []
    assert mi.find_references("Your FY 1703 proforma") == [1703]
    assert mi.find_references("FY1703 FY1703 FY1703") == [1703]
    assert mi.find_references(None, "", "INV1700") == [1700]


def test_za_mobile_extraction_and_normalisation():
    text = "Contact me on 081 461 4246 or +27 (0)82 123 4567. Office 021 555 1234. Ref 2026-11-14."
    assert mi.extract_za_mobiles(text) == {"27814614246", "27821234567"}
    assert mi.normalise_mobile("081 461 4246") == "27814614246"
    assert mi.normalise_mobile("+27 (0)82 123 4567") == "27821234567"
    assert mi.normalise_mobile("0027 82 123 4567") == "27821234567"
    assert mi.normalise_mobile("021 555 1234") is None
    assert mi.normalise_mobile("") is None
