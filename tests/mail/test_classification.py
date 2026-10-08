from __future__ import annotations

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
