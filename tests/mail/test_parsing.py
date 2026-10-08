from __future__ import annotations

from datetime import datetime
from email.message import EmailMessage

from src.services import mail_ingest as mi


def _raw(msg: EmailMessage) -> bytes:
    return msg.as_bytes()


def _base(subject="Group visit", frm='"Jo Soap" <jo@example.com>'):
    msg = EmailMessage()
    msg["From"] = frm
    msg["To"] = "bookings@farmyardpark.co.za, Second <two@example.com>"
    msg["Cc"] = "cc@example.com"
    msg["Subject"] = subject
    msg["Date"] = "Thu, 08 Oct 2026 08:00:00 +0000"
    msg["Message-ID"] = "<abc@example.com>"
    msg["In-Reply-To"] = "<parent@example.com>"
    msg["References"] = "<root@example.com> <parent@example.com>"
    return msg


def test_multipart_alternative_prefers_plain_and_keeps_sanitized_html():
    msg = _base()
    msg.set_content("Hello there\n\nWe would like to visit on 14 November.")
    msg.add_alternative(
        "<html><head><style>p{color:red}</style></head><body><p>Hello <b>there</b></p>"
        "<script>alert(1)</script><a href='javascript:x()' onclick='y()'>link</a></body></html>",
        subtype="html",
    )
    parsed = mi.parse_message(_raw(msg))
    assert parsed.from_name == "Jo Soap"
    assert parsed.from_email == "jo@example.com"
    assert parsed.to == ["bookings@farmyardpark.co.za", "two@example.com"]
    assert parsed.cc == ["cc@example.com"]
    assert parsed.subject == "Group visit"
    assert parsed.message_id == "<abc@example.com>"
    assert parsed.in_reply_to == "<parent@example.com>"
    assert "<root@example.com>" in parsed.references
    assert parsed.text.startswith("Hello there")
    assert parsed.snippet.startswith("Hello there We would like")
    # Date header is UTC 08:00 -> 10:00 SAST, stored naive
    assert parsed.date == datetime(2026, 10, 8, 10, 0, 0)
    html = parsed.html
    assert "<script" not in html and "<style" not in html and "onclick" not in html
    assert "javascript:" not in html
    assert "<b>there</b>" in html
    assert parsed.attachments == []


def test_html_only_derives_text_and_snippet():
    msg = _base()
    msg.set_content("<p>Good day,</p><p>We are a <i>school</i> of 60 learners.</p>", subtype="html")
    parsed = mi.parse_message(_raw(msg))
    assert "Good day," in parsed.text
    assert "school of 60 learners" in parsed.text
    assert parsed.snippet.startswith("Good day,")
    assert parsed.html and "<i>school</i>" in parsed.html


def test_attachments_are_collected_and_small_inline_images_skipped():
    msg = _base()
    msg.set_content("See attached")
    msg.add_alternative("<p>See attached <img src='cid:logo'></p>", subtype="html")
    # Small inline image (skipped)
    msg.get_payload()[1].add_related(b"\x89PNG" + b"\x00" * 100, maintype="image", subtype="png", cid="<logo>")
    msg.add_attachment(b"%PDF-1.4 fake", maintype="application", subtype="pdf", filename="Quote request.pdf")
    msg.add_attachment(b"col,val\n1,2\n", maintype="text", subtype="csv", filename="../../evil name?.csv")
    msg.add_attachment(b"dup", maintype="application", subtype="octet-stream", filename="a.bin")
    msg.add_attachment(b"dup2", maintype="application", subtype="octet-stream", filename="a.bin")
    parsed = mi.parse_message(_raw(msg))
    names = [a.filename for a in parsed.attachments]
    assert names == ["Quote request.pdf", "evil name_.csv", "a.bin", "a-2.bin"]
    assert parsed.attachments[0].content_type == "application/pdf"
    assert parsed.attachments[0].payload == b"%PDF-1.4 fake"
    assert parsed.text.startswith("See attached")


def test_large_inline_image_is_kept_and_oversize_attachment_skipped(monkeypatch):
    monkeypatch.setattr(mi, "MAX_ATTACHMENT_BYTES", 30_000)
    msg = _base()
    msg.set_content("x")
    msg.add_alternative("<p>x <img src='cid:big'></p>", subtype="html")
    msg.get_payload()[1].add_related(b"\x89PNG" + b"\x00" * 20_000, maintype="image", subtype="png", cid="<big>")
    msg.add_attachment(b"z" * 50_000, maintype="application", subtype="zip", filename="big.zip")
    parsed = mi.parse_message(_raw(msg))
    assert [a.filename for a in parsed.attachments] == ["part.png"]
    assert parsed.attachments[0].inline is True
    assert parsed.skipped_attachments == [{"filename": "big.zip", "size": 50_000, "reason": "too_large"}]


def test_encoded_headers_and_charsets():
    raw = (
        b"From: =?utf-8?q?Fran=C3=A7ois_du_Toit?= <francois@skool.co.za>\r\n"
        b"To: bookings@farmyardpark.co.za\r\n"
        b"Subject: =?iso-8859-1?q?Cr=E8che_uitstappie_-_navraag?=\r\n"
        b"Date: Wed, 7 Oct 2026 14:30:00 +0200\r\n"
        b"Message-ID: <x@y>\r\n"
        b"Content-Type: text/plain; charset=iso-8859-1\r\n"
        b"Content-Transfer-Encoding: quoted-printable\r\n"
        b"\r\n"
        b"Goeie dag, ons cr=E8che wil graag kom besoek.\r\n"
    )
    parsed = mi.parse_message(raw)
    assert parsed.from_name == "François du Toit"
    assert parsed.from_email == "francois@skool.co.za"
    assert parsed.subject == "Crèche uitstappie - navraag"
    assert "crèche" in parsed.text
    assert parsed.date == datetime(2026, 10, 7, 14, 30, 0)


def test_missing_date_falls_back_to_internaldate_and_bad_headers_do_not_raise():
    raw = b"From: broken <<not an address\r\nSubject: hi\r\n\r\nbody"
    from datetime import timezone

    parsed = mi.parse_message(raw, internaldate=datetime(2026, 10, 1, 6, 0, tzinfo=timezone.utc))
    assert parsed.date == datetime(2026, 10, 1, 8, 0)
    assert parsed.text == "body"
    assert parsed.subject == "hi"


def test_sanitize_html_caps_size(monkeypatch):
    monkeypatch.setattr(mi, "MAX_HTML_BYTES", 50)
    out = mi.sanitize_html("<p>" + "x" * 200 + "</p>")
    assert out.endswith("[message truncated]</em></p>")
    assert len(out.encode()) < 50 + 60


def test_safe_filename():
    assert mi.safe_filename("  ..hidden  ") == "hidden"
    assert mi.safe_filename("") == "attachment"
    assert mi.safe_filename("C:\\Users\\me\\Quote (final).pdf") == "Quote (final).pdf"
    long = mi.safe_filename("a" * 200 + ".pdf")
    assert long.endswith(".pdf") and len(long) <= 120
