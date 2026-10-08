"""The booking status machine (docs/booking-system.md §5)."""

from datetime import date

import pytest

from src.services.booking import (
    STATUSES,
    TRANSITIONS,
    InvalidTransition,
    allowed_transitions,
    check_transition,
)

TODAY = date(2026, 11, 20)
FUTURE = date(2026, 12, 5)
PAST = date(2026, 11, 1)


def test_every_status_has_a_transition_entry():
    assert set(TRANSITIONS) == set(STATUSES)


@pytest.mark.parametrize(
    "current, new",
    [
        ("enquiry", "proforma_sent"),
        ("enquiry", "confirmed"),
        ("enquiry", "cancelled"),
        ("enquiry", "lapsed"),
        ("proforma_sent", "confirmed"),
        ("proforma_sent", "cancelled"),
        ("proforma_sent", "lapsed"),
        ("confirmed", "completed"),
        ("confirmed", "cancelled"),
        ("cancelled", "enquiry"),
        ("lapsed", "enquiry"),
    ],
)
def test_allowed(current, new):
    check_transition(current, new, FUTURE, TODAY)


@pytest.mark.parametrize(
    "current, new",
    [
        ("enquiry", "completed"),
        ("enquiry", "no_show"),
        ("proforma_sent", "enquiry"),
        ("proforma_sent", "completed"),
        ("confirmed", "enquiry"),
        ("confirmed", "proforma_sent"),
        ("confirmed", "lapsed"),
        ("completed", "cancelled"),
        ("completed", "enquiry"),
        ("no_show", "enquiry"),
        ("cancelled", "confirmed"),
        ("lapsed", "proforma_sent"),
    ],
)
def test_disallowed(current, new):
    with pytest.raises(InvalidTransition):
        check_transition(current, new, FUTURE, TODAY)


def test_same_status_is_rejected():
    with pytest.raises(InvalidTransition):
        check_transition("enquiry", "enquiry", FUTURE, TODAY)


def test_unknown_status_is_rejected():
    with pytest.raises(InvalidTransition):
        check_transition("enquiry", "wibble", FUTURE, TODAY)


def test_no_show_only_after_visit_date():
    with pytest.raises(InvalidTransition):
        check_transition("confirmed", "no_show", FUTURE, TODAY)
    with pytest.raises(InvalidTransition):
        check_transition("confirmed", "no_show", TODAY, TODAY)
    check_transition("confirmed", "no_show", PAST, TODAY)


def test_allowed_transitions_lists_only_valid_moves():
    assert allowed_transitions("confirmed", FUTURE, TODAY) == ["completed", "cancelled"]
    assert allowed_transitions("confirmed", PAST, TODAY) == ["completed", "cancelled", "no_show"]
    assert allowed_transitions("completed", PAST, TODAY) == []
    assert allowed_transitions("cancelled", FUTURE, TODAY) == ["enquiry"]
