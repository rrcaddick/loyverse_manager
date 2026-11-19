from src.services.inbound import bounce_back_decision, classify_automated, looks_like_booking


def test_auto_submitted_and_noreply_are_certain():
    assert classify_automated({"Auto-Submitted": "auto-replied"}, "someone@example.com", "Someone", "Out of office")[0] == "certain"
    assert classify_automated({}, "no-reply@yoco.com", "Yoco", "Receipt")[0] == "certain"
    assert classify_automated({}, "mailer-daemon@googlemail.com", None, "Delivery Status Notification (Failure)")[0] == "certain"


def test_bulk_provider_is_certain_unless_it_is_a_bank_notice():
    headers = {"Return-Path": "<bounce-123@mail.mailchimpapp.net>", "List-Unsubscribe": "<mailto:x>"}
    assert classify_automated(headers, "news@shop.co.za", "Shop News", "October specials")[0] == "certain"
    bank = {"Return-Path": "<x@amazonses.com>"}
    grade, _ = classify_automated(bank, "notifications@capitecbank.co.za", "Capitec", "Payment notification: R3 800.00")
    assert grade != "certain"


def test_receipt_style_sender_is_likely_and_a_bursar_is_human():
    grade, reason = classify_automated({}, "receipts@messaging.yoco.co.za", "Yoco", "Receipt from Farmyard")
    assert grade == "likely"
    grade, reason = classify_automated(
        {"Precedence": "list", "List-Id": "<office.school.org>"},
        "office@school.org", "Thandi Mokoena",
        "Grade 3 outing in November",
        "Good day, we would like to book a visit for 85 learners on 12 November. Could you send a quote?",
    )
    assert grade is None and "reads like a person" in reason
    assert classify_automated({}, "ibreply@absa.co.za", "Absa", "Your statement is ready")[0] == "likely"


def test_looks_like_booking_needs_a_person_and_the_words():
    assert looks_like_booking("Thandi Mokoena", "Visit", "We want to book for 40 kids on 3 December")
    assert not looks_like_booking("Shop Team", "Visit", "We want to book for 40 kids on 3 December")
    assert not looks_like_booking("Thandi Mokoena", "Hi", "Please see attached.")


def test_bounce_back_decision_rules(monkeypatch):
    from src.services import inbound

    monkeypatch.setattr(inbound, "_cfg", lambda: {"bounce_back_enabled": True, "form_window_hours": 24})
    monkeypatch.setattr(inbound.em, "get_bounce_back", lambda sender: None)
    assert bounce_back_decision({"from_email": "person@example.com"})[0] is True
    assert bounce_back_decision({"from_email": "no-reply@example.com"})[0] is False
    assert bounce_back_decision({"from_email": "person@example.com", "is_auto_generated": True})[0] is False
    from datetime import datetime, timedelta

    monkeypatch.setattr(inbound.em, "get_bounce_back", lambda sender: {"last_sent_at": datetime.now() - timedelta(hours=2)})
    send, reason = bounce_back_decision({"from_email": "person@example.com"})
    assert send is False and "inside the window" in reason
    monkeypatch.setattr(inbound, "_cfg", lambda: {"bounce_back_enabled": False})
    assert bounce_back_decision({"from_email": "person@example.com"})[0] is False


def test_a_development_copy_of_our_own_mail_is_never_a_customer():
    # Outside prod every send is redirected to the developer and prefixed; the copy
    # sits in the same mailbox and carries a real booking reference in its subject.
    grade, reason = classify_automated({}, "thefarmyardpark@gmail.com", "Farmyard Park", "[DEV \u2192 test@example.com] Proforma FY1757 \u2013 Sat 28 Nov")
    assert grade == "certain" and "development copy" in reason
    assert classify_automated({}, "someone@gmail.com", "Someone", "Proforma FY1757")[0] is None
