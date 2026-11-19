from __future__ import annotations

import email
import email.policy

import pytest

from src.services import mail_send as ms


def test_dev_rewrite_redirects_every_recipient_and_prefixes_subject():
    to, cc, subject = ms.apply_dev_rewrite(
        ["customer@school.co.za", " Second@x.org "], ["cc@y.org", "customer@school.co.za"], "Your proforma FY1703", env="dev"
    )
    assert to == [ms.DEV_MAIL_RECIPIENT]
    assert cc == []
    assert subject == "[DEV → customer@school.co.za, Second@x.org, cc@y.org] Your proforma FY1703"


@pytest.mark.parametrize("env", ["dev", "development", "staging", "test", "", "PROD "])
def test_dev_rewrite_applies_to_anything_but_prod(env):
    to, cc, subject = ms.apply_dev_rewrite(["a@b.c"], ["d@e.f"], "S", env=env)
    if env.strip().lower() == "prod":
        assert (to, cc, subject) == (["a@b.c"], ["d@e.f"], "S")
    else:
        assert to == [ms.DEV_MAIL_RECIPIENT] and cc == [] and subject.startswith("[DEV → a@b.c, d@e.f] ")


def test_module_default_env_is_not_prod_in_tests():
    # The repo's local .env sets ENV=dev; this guards against someone flipping it while testing.
    assert ms.is_prod() is False


def test_build_mime_structure_headers_and_threading():
    msg = ms.build_mime(
        from_addr="bookings@farmyardpark.co.za",
        from_name="The Farmyard Park",
        to=["jo@example.com"],
        cc=["cc@example.com"],
        subject="Proforma FY1703",
        text="Plain version",
        html="<p>HTML <b>version</b></p>",
        attachments=[("FY1703.pdf", b"%PDF-1.4", "application/pdf"), ("notes.txt", b"hi", "")],
        in_reply_to="<parent@example.com>",
        references="<root@example.com> <parent@example.com>",
    )
    raw = msg.as_bytes()
    parsed = email.message_from_bytes(raw, policy=email.policy.default)
    assert parsed["From"] == "The Farmyard Park <bookings@farmyardpark.co.za>"
    assert parsed["Reply-To"] == "The Farmyard Park <bookings@farmyardpark.co.za>"
    assert parsed["To"] == "jo@example.com"
    assert parsed["Cc"] == "cc@example.com"
    assert parsed["Subject"] == "Proforma FY1703"
    assert parsed["Message-ID"].endswith("@farmyardpark.co.za>")
    assert parsed["In-Reply-To"] == "<parent@example.com>"
    assert parsed["References"] == "<root@example.com> <parent@example.com>"
    assert parsed["Date"]
    assert parsed.get_content_type() == "multipart/mixed"
    parts = list(parsed.iter_parts())
    assert parts[0].get_content_type() == "multipart/alternative"
    alt = [p.get_content_type() for p in parts[0].iter_parts()]
    assert alt == ["text/plain", "text/html"]
    assert parsed.get_body(preferencelist=("plain",)).get_content().strip() == "Plain version"
    assert "<b>version</b>" in parsed.get_body(preferencelist=("html",)).get_content()
    atts = list(parsed.iter_attachments())
    assert [(a.get_filename(), a.get_content_type()) for a in atts] == [
        ("FY1703.pdf", "application/pdf"),
        ("notes.txt", "text/plain"),
    ]
    assert atts[0].get_payload(decode=True) == b"%PDF-1.4"


def test_build_mime_without_attachments_is_alternative_only():
    msg = ms.build_mime(from_addr="a@b.c", from_name="N", to=["x@y.z"], subject="S", text="t", html="<p>t</p>")
    assert msg.get_content_type() == "multipart/alternative"
    assert msg["In-Reply-To"] is None and msg["References"] is None


def test_send_email_applies_rewrite_and_records_row(monkeypatch):
    sent = {}

    class FakeSmtp:
        def send(self, from_addr, to_addrs, mime_bytes):
            sent["from"] = from_addr
            sent["to"] = list(to_addrs)
            sent["mime"] = email.message_from_bytes(mime_bytes, policy=email.policy.default)

    stored = {}

    def fake_insert(data):
        stored.update({"direction": "outbound", **data})  # mirrors em.insert_outbound
        return 42

    events = []
    monkeypatch.setattr(ms, "GmailSmtp", FakeSmtp)
    monkeypatch.setattr(ms, "GMAIL_ADDRESS", "bookings@farmyardpark.co.za")
    monkeypatch.setattr(ms, "ENV", "dev")
    monkeypatch.setattr(ms, "sender_name", lambda settings=None: "The Farmyard Park")
    monkeypatch.setattr(ms.em, "booking_by_id", lambda bid: {"id": bid, "email_thread_id": 123})
    monkeypatch.setattr(ms.em, "latest_message_id_for_booking", lambda bid: "<last@example.com>")
    monkeypatch.setattr(ms.em, "get_by_message_id_header", lambda h: {"references_header": "<root@example.com>"})
    monkeypatch.setattr(ms.em, "insert_outbound", fake_insert)
    monkeypatch.setattr(ms.em, "get", lambda i: {"id": i, **stored})
    monkeypatch.setattr(ms.em, "to_api", lambda row, full=False: row)
    monkeypatch.setattr(ms, "add_booking_event", lambda *a, **k: events.append(a))

    rendered = ms.RenderedEmail(subject="Proforma FY1703", html="<p>Hi</p>", text="Hi")
    row = ms.send_email(to=["customer@school.co.za"], rendered=rendered,
                        attachments=[("FY1703.pdf", b"%PDF", "application/pdf")], booking_id=7, kind="proforma", actor=1)

    assert sent["to"] == [ms.DEV_MAIL_RECIPIENT]
    assert sent["mime"]["To"] == ms.DEV_MAIL_RECIPIENT
    assert sent["mime"]["Subject"] == "[DEV → customer@school.co.za] Proforma FY1703"
    assert sent["mime"]["In-Reply-To"] == "<last@example.com>"
    assert sent["mime"]["References"] == "<root@example.com> <last@example.com>"
    assert stored["direction"] == "outbound" and stored["kind"] == "proforma"
    assert stored["to_emails"] == [ms.DEV_MAIL_RECIPIENT]
    assert stored["send_status"] == "sent" and stored["send_error"] is None
    assert stored["gmail_thrid"] == 123 and stored["booking_id"] == 7 and stored["sent_by"] == 1
    assert stored["attachments_meta"] == [{"filename": "FY1703.pdf", "size": 4, "content_type": "application/pdf"}]
    assert row["id"] == 42
    assert events and events[0][1] == "email_sent"


def test_send_email_records_failure_without_raising(monkeypatch):
    class BrokenSmtp:
        def send(self, *a):
            raise ms.GmailError("boom")

    stored = {}
    events = []
    monkeypatch.setattr(ms, "GmailSmtp", BrokenSmtp)
    monkeypatch.setattr(ms, "GMAIL_ADDRESS", "bookings@farmyardpark.co.za")
    monkeypatch.setattr(ms, "sender_name", lambda settings=None: "The Farmyard Park")
    monkeypatch.setattr(ms.em, "booking_by_id", lambda bid: {"id": bid, "email_thread_id": None})
    monkeypatch.setattr(ms.em, "latest_message_id_for_booking", lambda bid: None)
    monkeypatch.setattr(ms.em, "insert_outbound", lambda data: stored.update(data) or 1)
    monkeypatch.setattr(ms.em, "get", lambda i: {"id": i, **stored})
    monkeypatch.setattr(ms.em, "to_api", lambda row, full=False: row)
    monkeypatch.setattr(ms, "add_booking_event", lambda *a, **k: events.append(a))

    row = ms.send_email(to=["x@y.z"], rendered=ms.RenderedEmail("S", "<p>b</p>", "b"), booking_id=3, kind="reply", actor=None)
    assert row["send_status"] == "failed" and "boom" in row["send_error"]
    assert events[0][1] == "email_failed"


def test_send_email_requires_recipient():
    with pytest.raises(ms.MailSendError):
        ms.send_email(to=[], rendered=ms.RenderedEmail("S", "", ""), booking_id=None, kind="custom", actor=None)


def test_reply_subject_keeps_gmail_threading():
    assert ms.reply_subject_for("Bookings") == "Re: Bookings"
    assert ms.reply_subject_for("Re: Bookings") == "Re: Bookings"
    assert ms.reply_subject_for("RE: Bookings") == "RE: Bookings"
    assert ms.reply_subject_for("  ") == "Your enquiry to The Farmyard Park"
