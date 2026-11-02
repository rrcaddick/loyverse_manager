from datetime import date

import pytest

from src.services.booking import InvalidTransition, STATUS_LABELS, TRANSITIONS, check_transition


def test_request_transitions():
    assert "requested" in TRANSITIONS and TRANSITIONS["requested"] == {"proforma_sent", "declined", "cancelled"}
    assert TRANSITIONS["declined"] == {"requested"}
    check_transition("requested", "proforma_sent", date(2026, 12, 1), date(2026, 10, 26))
    check_transition("requested", "declined", date(2026, 12, 1), date(2026, 10, 26))
    with pytest.raises(InvalidTransition):
        check_transition("requested", "confirmed", date(2026, 12, 1), date(2026, 10, 26))
    assert STATUS_LABELS["requested"] == "Request" and STATUS_LABELS["declined"] == "Declined"
