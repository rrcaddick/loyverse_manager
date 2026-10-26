from datetime import date

import pytest

from src.services.booking import InvalidTransition, STATUS_LABELS, TRANSITIONS, check_transition


def test_request_transitions():
    assert "requested" in TRANSITIONS and TRANSITIONS["requested"] >= {"enquiry", "proforma_sent", "declined"}
    assert TRANSITIONS["declined"] == {"requested", "enquiry"}
    check_transition("requested", "enquiry", date(2026, 12, 1), date(2026, 10, 26))
    check_transition("requested", "declined", date(2026, 12, 1), date(2026, 10, 26))
    with pytest.raises(InvalidTransition):
        check_transition("requested", "confirmed", date(2026, 12, 1), date(2026, 10, 26))
    assert STATUS_LABELS["requested"] == "Request" and STATUS_LABELS["declined"] == "Declined"
