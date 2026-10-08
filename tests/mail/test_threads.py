"""Thread derivation, reopen semantics and stream merging. Pure: works on
dicts, no database."""

from __future__ import annotations

import json
from datetime import datetime

from src.services import conversations as cv

OWN = "thefarmyardpark@gmail.com"
T0 = datetime(2026, 10, 7, 9, 0, 0)


def msg(i, direction, at, **over):
    row = {
        "id": i,
        "gmail_thrid": 1878302343153220866,
        "direction": direction,
        "kind": None,
        "from_name": "Jen Morris" if direction == "inbound" else "The Farmyard Park",
        "from_email": "jen@example.com" if direction == "inbound" else OWN,
        "to_emails": [OWN] if direction == "inbound" else ["jen@example.com"],
        "cc_emails": [],
        "subject": "Re: Group visit" if i > 1 else "Group visit",
        "sent_at": at,
        "snippet": f"snippet {i}",
        "body_new_text": f"New text of message {i}",
        "body_text": f"New text of message {i}\n\n> quoted",
        "split_version": 1,
        "is_auto_generated": False,
        "send_status": None if direction == "inbound" else "sent",
        "booking_id": None,
        "has_attachments": False,
    }
    row.update(over)
    return row


def test_derive_thread_basic_inbound_only():
    d = cv.derive_thread([msg(1, "inbound", T0)], own_address=OWN)
    assert d["counterpart_email"] == "jen@example.com" and d["counterpart_name"] == "Jen Morris"
    assert d["subject"] == "Group visit"
    assert d["message_count"] == 1
    assert d["last_direction"] == "inbound"
    assert d["last_inbound_at"] == T0 and d["last_outbound_at"] is None
    assert d["last_snippet"] == "New text of message 1"
    assert d["has_automated_only"] is False
    assert d["booking_id"] is None


def test_derive_thread_outbound_latest_prefixes_you_and_uses_new_text():
    rows = [msg(1, "inbound", T0), msg(2, "outbound", datetime(2026, 10, 7, 10, 0))]
    d = cv.derive_thread(rows, own_address=OWN)
    assert d["last_direction"] == "outbound"
    assert d["last_snippet"] == "You: New text of message 2"
    assert d["last_message_at"] == datetime(2026, 10, 7, 10, 0)
    assert d["last_outbound_at"] == datetime(2026, 10, 7, 10, 0)
    assert d["subject"] == "Group visit"  # first message, Re: stripped on later ones anyway


def test_failed_send_and_automated_mail_do_not_count_for_the_queue():
    rows = [
        msg(1, "inbound", T0),
        msg(2, "outbound", datetime(2026, 10, 7, 10, 0), send_status="failed"),
    ]
    d = cv.derive_thread(rows, own_address=OWN)
    assert d["last_direction"] == "inbound"  # still needs a reply
    assert d["last_outbound_at"] is None
    assert d["last_snippet"] == "You: New text of message 2"  # the row itself is still the newest

    rows = [
        msg(1, "inbound", T0),
        msg(2, "outbound", datetime(2026, 10, 7, 10, 0)),
        msg(3, "inbound", datetime(2026, 10, 7, 10, 5), is_auto_generated=True, from_email="noreply@example.com"),
    ]
    d = cv.derive_thread(rows, own_address=OWN)
    assert d["last_direction"] == "outbound"  # an auto-reply does not put it back in Needs reply
    assert d["counterpart_email"] == "jen@example.com"
    assert d["has_automated_only"] is False


def test_automated_only_thread_is_flagged_and_counterpart_still_found():
    rows = [msg(1, "inbound", T0, is_auto_generated=True, from_email="alerts@bank.example", from_name="Bank")]
    d = cv.derive_thread(rows, own_address=OWN)
    assert d["has_automated_only"] is True
    assert d["counterpart_email"] == "alerts@bank.example"
    assert d["last_direction"] == "inbound"


def test_outbound_only_thread_takes_counterpart_from_recipients():
    rows = [msg(1, "outbound", T0, to_emails=["school@example.org", OWN], kind="proforma")]
    d = cv.derive_thread(rows, own_address=OWN)
    assert d["counterpart_email"] == "school@example.org"
    assert d["counterpart_name"] is None
    assert d["last_direction"] == "outbound"


def test_booking_id_comes_from_the_newest_linked_message():
    rows = [msg(1, "inbound", T0, booking_id=7), msg(2, "inbound", datetime(2026, 10, 8), booking_id=9)]
    assert cv.derive_thread(rows, own_address=OWN)["booking_id"] == 9
    assert cv.derive_thread([], own_address=OWN) == {}


def test_unsplit_rows_fall_back_to_body_text_for_the_snippet():
    rows = [msg(1, "inbound", T0, split_version=0, body_new_text=None, body_text="Raw body text here")]
    assert cv.derive_thread(rows, own_address=OWN)["last_snippet"] == "Raw body text here"


def test_should_reopen_only_for_newer_inbound_on_a_done_thread():
    done = {"status": "done", "done_at": datetime(2026, 10, 7, 12, 0)}
    assert cv.should_reopen(done, {"last_direction": "inbound", "last_inbound_at": datetime(2026, 10, 7, 13, 0)}) is True
    assert cv.should_reopen(done, {"last_direction": "inbound", "last_inbound_at": datetime(2026, 10, 7, 11, 0)}) is False
    assert cv.should_reopen(done, {"last_direction": "outbound", "last_inbound_at": datetime(2026, 10, 7, 13, 0)}) is False
    assert cv.should_reopen({"status": "open", "done_at": None}, {"last_direction": "inbound", "last_inbound_at": T0}) is False
    assert cv.should_reopen(None, {"last_direction": "inbound", "last_inbound_at": T0}) is False
    assert cv.should_reopen({"status": "done", "done_at": None}, {"last_direction": "inbound", "last_inbound_at": T0}) is True


def test_thread_to_api_unread_and_string_thrid():
    row = {
        "gmail_thrid": 1878302343153220866, "booking_id": 3, "booking_reference": "FY1703",
        "booking_group_name": "Mount Olive", "status": "open", "not_booking": 0,
        "counterpart_name": "Jen", "counterpart_email": "jen@example.com", "subject": "Group visit",
        "last_snippet": "hello", "last_message_at": T0, "last_inbound_at": T0, "last_outbound_at": None,
        "last_direction": "inbound", "message_count": 1, "has_attachments": 1, "has_automated_only": 0,
        "done_at": None, "done_by": None, "created_at": T0, "updated_at": T0,
    }
    item = cv.thread_to_api(row)
    assert item["thrid"] == "1878302343153220866" and isinstance(item["thrid"], str)
    assert item["booking"] == {"id": 3, "reference": "FY1703", "group_name": "Mount Olive"}
    assert item["unread"] is True and item["has_attachments"] is True
    assert item["last_message_at"] == "2026-10-07T09:00:00"
    row["last_outbound_at"] = datetime(2026, 10, 7, 9, 30)
    assert cv.thread_to_api(row)["unread"] is False
    row["last_outbound_at"] = None
    row["status"] = "done"
    assert cv.thread_to_api(row)["unread"] is False


def test_build_stream_merges_and_dedupes(monkeypatch):
    monkeypatch.setattr(cv, "_attachments_for", lambda mid: [])
    messages = [
        msg(1, "inbound", T0, body_new_html="<p>new</p>", body_quoted_html="<blockquote>a<br>b</blockquote>", signature_text="Regards\nJen"),
        msg(2, "outbound", datetime(2026, 10, 7, 11, 0), kind="proforma", sent_by=1, sent_by_name="Linda"),
    ]
    notes = [{"id": 5, "gmail_thrid": 1878302343153220866, "body": "Called her", "author_user_id": 1,
              "author_name": "Linda", "created_at": datetime(2026, 10, 7, 10, 0)}]
    events = [
        {"id": 20, "booking_id": 3, "kind": "email_sent", "summary": "Proforma FY1703", "data": '{"email_message_id": 2}',
         "actor_user_id": 1, "actor_name": "Linda", "created_at": datetime(2026, 10, 7, 11, 0)},
        {"id": 21, "booking_id": 3, "kind": "note", "summary": "Called her", "data": '{"text": "Called her", "thread_note_id": 5}',
         "actor_user_id": 1, "actor_name": "Linda", "created_at": datetime(2026, 10, 7, 10, 0)},
        {"id": 22, "booking_id": 3, "kind": "payment_matched", "summary": "Deposit matched", "data": '{"payment_id": 8, "bank_transaction_id": 4}',
         "actor_user_id": None, "actor_name": None, "created_at": datetime(2026, 10, 7, 12, 0)},
        {"id": 23, "booking_id": 3, "kind": "note", "summary": "Booking note", "data": '{"text": "Booking note"}',
         "actor_user_id": 1, "actor_name": "Linda", "created_at": datetime(2026, 10, 7, 12, 30)},
        {"id": 24, "booking_id": 3, "kind": "document_issued", "summary": "FY1703 v1", "data": '{"document_id": 9}',
         "actor_user_id": 1, "actor_name": "Linda", "created_at": datetime(2026, 10, 7, 10, 59)},
    ]
    items = cv.build_stream(messages, notes, events)
    assert [i["type"] for i in items] == ["inbound", "note", "event", "outbound", "event", "note"]
    assert [i["key"] for i in items] == ["msg-1", "note-5", "event-24", "msg-2", "event-22", "bnote-23"]
    first = items[0]
    assert first["body_new_html"] == "<p>new</p>" and first["has_quoted"] is True and first["quoted_lines"] == 2
    assert first["has_signature"] is True and first["signature_text"] == "Regards\nJen"
    assert first["at"] == "2026-10-07T09:00:00" and first["gmail_thrid"] == "1878302343153220866"
    outbound = items[3]
    assert outbound["kind"] == "proforma" and outbound["sent_by_name"] == "Linda" and outbound["send_status"] == "sent"
    payment = items[4]
    assert payment["link"] == {"kind": "payment", "id": 8, "bank_transaction_id": 4, "booking_id": 3}
    doc = items[2]
    assert doc["link"] == {"kind": "document", "id": 9, "booking_id": 3}
    booking_note = items[5]
    assert booking_note["source"] == "booking" and booking_note["body"] == "Booking note" and booking_note["booking_id"] == 3


def test_message_item_for_an_unsplit_row_uses_original_bodies(monkeypatch):
    monkeypatch.setattr(cv, "_attachments_for", lambda mid: [])
    item = cv.message_item(msg(1, "inbound", T0, split_version=0, body_new_text=None, body_html="<p>raw</p>", body_text="raw"))
    assert item["body_new_html"] == "<p>raw</p>" and item["body_new_text"] == "raw"
    assert item["has_quoted"] is False and item["quoted_lines"] == 0 and item["has_signature"] is False


def test_templates_merge_and_fill_placeholders(monkeypatch):
    stored = {"items": [
        {"key": "price_list", "label": "Prices", "body_html": "<p>See {website}</p>"},
        {"key": "custom", "label": "Custom", "subject": "Hello {signature_name}", "body_html": "<p>Form: {form_url}</p>"},
        {"key": "broken"},
    ]}
    monkeypatch.setattr(cv, "query_one", lambda sql, params=None: {"value": json.dumps(stored)} if "app_settings" in sql else None)
    monkeypatch.setattr(cv, "_template_context", lambda: {"website": "www.farmyardpark.co.za", "form_url": "https://x/request",
                                                           "signature_name": "Linda", "deposit_percent": "30", "min_people": "40"})
    items = cv.templates()
    keys = [i["key"] for i in items]
    assert keys == ["price_list", "availability", "deposit_terms", "form_link", "custom"]
    price = items[0]
    assert price["label"] == "Prices" and price["body_html"] == "<p>See www.farmyardpark.co.za</p>"
    assert price["body_text"] == "See www.farmyardpark.co.za"
    custom = items[-1]
    assert custom["subject"] == "Hello Linda" and "https://x/request" in custom["body_html"]
    assert "{" not in items[2]["body_html"]
