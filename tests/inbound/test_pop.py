from decimal import Decimal

from src.services.pop import is_genuine, parse_pop_text


def test_parse_fnb_style_pop():
    text = """FNB  Proof of Payment
    Payment to: The Farmyard Park
    Amount: R 3 800.00
    Beneficiary reference: FY1703 Oasis
    Date: 12/10/2026
    """
    p = parse_pop_text(text)
    assert p["bank"] == "FNB" and p["amount"] == Decimal("3800.00")
    assert p["reference"].startswith("FY1703") and p["paid_on"].isoformat() == "2026-10-12"
    assert p["is_pop"] is True


def test_body_signal_without_a_bank_pdf():
    p = parse_pop_text("Hi Linda, I paid the deposit of R2 500 this morning, ref Mondale. Thanks")
    assert p["signal"] is True and p["amount"] == Decimal("2500") and p["is_pop"] is True
    q = parse_pop_text("Hi, could you confirm the price per child for a weekday?")
    assert q["signal"] is False and q["is_pop"] is False


def test_genuine_attachments_exclude_signature_logos():
    assert is_genuine({"content_type": "application/pdf", "size": 2000, "inline": False})
    assert not is_genuine({"content_type": "image/png", "size": 2000, "inline": True})
    assert not is_genuine({"content_type": "image/png", "size": 4000, "inline": False})
    assert is_genuine({"content_type": "image/jpeg", "size": 240_000, "inline": False})
