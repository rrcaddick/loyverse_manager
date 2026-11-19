"""Groups and history (2 Nov 2026): the keys and the scoring are pure; the
linking, the create hook and the history metrics need the local MySQL."""

from datetime import date, timedelta

import pytest

from src.services import groups

# ------------------------------------------------------------------ pure --


def test_name_key_keeps_only_the_distinctive_words():
    assert groups.name_key("Sunshine Primary School Grade 3") == "sunshine"
    assert groups.name_key("Grade 4") == ""
    assert groups.name_key("Mondale High") == groups.name_key("MONDALE HIGH SCHOOL")
    assert groups.area_key("Mitchell's Plain") == groups.area_key("Mitchells Plain")


def test_generic_mail_domains_say_nothing():
    assert groups.domain_of("jane@gmail.com") is None
    assert groups.domain_of("Admin@Mondale.co.za") == "mondale.co.za"


def _profile(**kw):
    p = groups.Profile(id=kw.get("id", 1), name=kw.get("name", "Mondale High"), group_type=kw.get("group_type", "school"), area=kw.get("area", "Mitchells Plain"))
    p.add_name(p.name)
    for alias in kw.get("aliases", []):
        p.add_name(alias)
    if p.area:
        p.area_keys.add(groups.area_key(p.area))
    p.emails |= set(kw.get("emails", []))
    p.mobiles |= set(kw.get("mobiles", []))
    p.domains |= {d for d in (groups.domain_of(e) for e in p.emails) if d}
    p.doc_numbers |= set(kw.get("doc_numbers", []))
    p.bookings = kw.get("bookings", [{"id": 1, "reference": "FY1473", "visit_date": date(2026, 10, 3), "status": "completed", "people_booked": 150, "group_name": p.name}])
    return p


def _facts(**booking):
    base = {"id": None, "group_name": "Mondale High", "area": "Mitchells Plain", "group_type": "school", "contact_email": None, "contact_mobile": None}
    base.update(booking)
    return groups.facts_for(base, contacts=[])


def test_a_known_address_is_confident():
    p = _profile(emails={"teacher@gmail.com"})
    points, why = groups.score(_facts(contact_email="Teacher@Gmail.com"), p)
    assert points >= groups.CONFIDENT and why[0] == "email"


def test_a_known_address_under_an_unrelated_name_is_only_a_suggestion():
    p = _profile(name="VGK Silversands Sunday School", area="Blackheath", emails={"jo@gmail.com"})
    points, why = groups.score(_facts(group_name="Dennemere Primary School", area="Blackheath", contact_email="jo@gmail.com"), p)
    assert groups.SUGGEST <= points < groups.CONFIDENT
    assert "different name" in why


def test_name_and_area_suggest_but_do_not_link():
    p = _profile(emails={"old@school.org.za"})
    points, why = groups.score(_facts(contact_email="new.person@gmail.com"), p)
    assert points == groups.SCORE_NAME + groups.SCORE_AREA
    assert groups.SUGGEST <= points < groups.CONFIDENT
    assert why == ["name", "area"]


def test_the_school_domain_makes_the_name_confident():
    p = _profile(emails={"old@mondale.co.za"})
    points, why = groups.score(_facts(contact_email="new@mondale.co.za"), p)
    assert points >= groups.CONFIDENT and "email domain" in why


def test_the_customers_own_previous_name_with_the_area_is_confident():
    p = _profile(aliases=["Mondale Grade 8s"])
    points, why = groups.score(_facts(group_name="Grade 9 outing", previous_visit_name="Mondale High School"), p)
    assert points == groups.SCORE_PREVIOUS_NAME + groups.SCORE_AREA
    assert points >= groups.CONFIDENT


def test_a_quoted_reference_is_confident():
    p = _profile(doc_numbers={1473})
    points, why = groups.score(_facts(customer_notes="Same as last year, FY1473"), p)
    assert points >= groups.CONFIDENT and "reference" in why


def test_a_different_group_in_the_same_area_scores_nothing():
    p = _profile()
    points, _ = groups.score(_facts(group_name="Rocklands Baptist", area="Mitchells Plain"), p)
    assert points == 0


def test_summary_reads_the_past():
    visits = [
        {"relation": "past", "status": "completed", "visit_date": "2025-10-04", "turnout_pct": 88, "deposit_days": 9, "deposit_on_time": True, "lead_days": 40, "booked": 150, "arrived": 132, "same_contact": True, "reminders_sent": 1, "paid_total": 9000.0, "refunded": 0.0, "id": 1, "reference": "FY1473", "settled": "on the day"},
        {"relation": "past", "status": "cancelled", "visit_date": "2024-10-05", "turnout_pct": None, "deposit_days": None, "deposit_on_time": None, "lead_days": 20, "booked": 100, "arrived": None, "same_contact": False, "reminders_sent": 2, "paid_total": 0.0, "refunded": 0.0, "id": 2, "reference": "FY1200", "settled": None},
        {"relation": "upcoming", "status": "confirmed", "visit_date": "2026-12-01", "turnout_pct": None, "deposit_days": 3, "deposit_on_time": True, "lead_days": 10, "booked": 160, "arrived": None, "same_contact": True, "reminders_sent": 0, "paid_total": 1000.0, "refunded": 0.0, "id": 3, "reference": "FY1800", "settled": None},
    ]
    s = groups.summarise(visits)
    assert s["visits"] == 1 and s["cancellations"] == 1 and s["first_year"] == 2024
    assert s["last"]["reference"] == "FY1473" and s["turnout_avg_pct"] == 88
    assert s["deposit_on_time"] == {"on_time": 1, "of": 1} and s["typical_month"] == "October"
    assert s["same_person"] is True and s["reminders_total"] == 3
    assert groups.summarise([visits[2]]) is None


# -------------------------------------------------------------------- db --

try:
    from src.models.base import query_one

    query_one("SELECT 1 AS ok")
    DB_OK = True
except Exception:  # noqa: BLE001
    DB_OK = False

db = pytest.mark.skipif(not DB_OK, reason="MySQL not reachable")

if DB_OK:
    from src.models import booking as bm
    from src.models import booking_group as gm
    from src.models.base import query
    from src.services import booking as bs

VISIT = date(2026, 11, 12)


@pytest.fixture
def created():
    ids: list[int] = []
    yield ids
    for booking_id in ids:
        bm.delete(booking_id)  # removes a group left empty


def make(created, **overrides):
    data = {
        "group_name": "TEST Groups pytest school",
        "group_type": "school",
        "area": "TEST Klapmuts",
        "contact_name": "Jane Test",
        "contact_email": "groups.pytest@example.com",
        "contact_mobile": "082 555 0101",
        "visit_date": VISIT.isoformat(),
        "adults": 5,
        "children": 50,
        "status": "proforma_sent",
    }
    data.update(overrides)
    row = bs.create_booking(data, source="manual", actor=None)
    created.append(row["id"])
    return row


@db
def test_a_first_booking_gets_a_group_of_its_own(created):
    b = make(created)
    assert b["group_id"]
    g = gm.get(b["group_id"])
    assert g["name"] == "TEST Groups pytest school" and g["area"] == "TEST Klapmuts"
    assert any(e["kind"] == "group_linked" for e in query("SELECT kind FROM booking_events WHERE booking_id = %s", (b["id"],)))


@db
def test_the_same_address_links_the_next_booking_and_learns_the_spelling(created):
    first = make(created)
    second = make(created, group_name="TEST Groups Pytest School Grade 4", visit_date=(VISIT + timedelta(days=7)).isoformat(), contact_name="Another Teacher")
    assert second["group_id"] == first["group_id"]
    assert "TEST Groups Pytest School Grade 4" in gm.alias_names(first["group_id"])
    history = groups.history_for(second)
    assert history["group"]["bookings"] == 2
    assert [v["reference"] for v in history["visits"]] == [first["reference"]]
    v = history["visits"][0]
    assert v["same_contact"] is True and v["booked"] == 55 and v["relation"] == "upcoming"
    assert history["summary"] is None  # nothing in the past yet


@db
def test_the_same_name_with_a_new_person_is_suggested_not_linked(created):
    first = make(created)
    second = make(created, contact_email="someone.else@gmail.com", contact_mobile="082 555 0202", visit_date=(VISIT + timedelta(days=14)).isoformat())
    assert second["group_id"] is None
    suggestions = groups.suggestions_for(second)
    assert suggestions and suggestions[0]["group_id"] == first["group_id"] and not suggestions[0]["confident"]
    assert suggestions[0]["why"] == ["name", "area"]
    # Yes: linked, and the record's history now shows the first booking.
    groups.link_booking(second["id"], first["group_id"], None, method="manual")
    assert bm.get(second["id"])["group_id"] == first["group_id"]
    # New group: a group of its own; the earlier one keeps the first booking.
    groups.new_group_for(second["id"], None)
    own = bm.get(second["id"])["group_id"]
    assert own and own != first["group_id"]
    assert gm.get(first["group_id"]) is not None


@db
def test_rebook_carries_the_group(created):
    first = make(created)
    again = make(created, group_id=first["group_id"], contact_email="new.booker@example.com", contact_mobile="082 555 0303", group_name="TEST Entirely different words", visit_date=(VISIT + timedelta(days=21)).isoformat())
    assert again["group_id"] == first["group_id"]
    assert "TEST Entirely different words" in gm.alias_names(first["group_id"])


@db
def test_history_metrics_for_a_past_visit(created):
    first = make(created, visit_date=(date.today() - timedelta(days=200)).isoformat(), status="confirmed")
    bs.record_payment(first["id"], "eft", 500, date.today() - timedelta(days=220), "dep", None, None)
    from src.models.base import execute

    execute(
        "UPDATE bookings SET status = 'completed', arrived_count = 44, proforma_sent_at = %s, hold_expires_on = %s, enquiry_date = %s WHERE id = %s",
        ((date.today() - timedelta(days=230)).isoformat() + " 10:00:00", (date.today() - timedelta(days=215)).isoformat(), (date.today() - timedelta(days=240)).isoformat(), first["id"]),
    )
    second = make(created)
    history = groups.history_for(second)
    v = history["visits"][0]
    assert v["relation"] == "past" and v["status"] == "completed"
    assert v["booked"] == 55 and v["arrived"] == 44 and v["turnout_pct"] == 80
    assert v["proforma_days"] == 10 and v["deposit_days"] == 10 and v["deposit_on_time"] is True
    assert v["lead_days"] == 40 and v["paid_total"] == 500.0
    s = history["summary"]
    assert s["visits"] == 1 and s["turnout_avg_pct"] == 80 and s["deposit_on_time"] == {"on_time": 1, "of": 1}
    assert s["same_person"] is True


@db
def test_the_form_keeps_the_previous_visit_name():
    from src.services import public_form
    from src.services.settings import get_settings

    payload = {
        "visit_date": (date.today() + timedelta(days=30)).isoformat(),
        "visitors": 40,
        "group_name": "TEST Grade 9 outing",
        "group_type": "school",
        "area": "Paarl",
        "previous_visit_name": "  Mondale High School ",
        "contact_name": "Jane Test",
        "contact_email": "jane@example.com",
        "contact_mobile": "082 123 4567",
        "questions": [],
        "policy_accepted": True,
    }
    clean, errors = public_form.validate_request(payload, get_settings(), closed_days=set())
    assert "previous_visit_name" not in errors
    assert clean["previous_visit_name"] == "Mondale High School"


def test_short_forms_misspellings_and_old_versus_new():
    assert groups.name_tokens("NAC Blue Downs") == groups.name_tokens("New Apostolic Church, Blue Downs")
    assert groups.name_tokens("OAC Choir") == groups.name_tokens("Old Apostolic Choir")
    p = _profile(name="New Apostolic Church", area="Elsies River", aliases=["New Apostolic, Elsies River"])
    points, why = groups.score(_facts(group_name="New Apostilic", area="Elsies River"), p)
    assert points == groups.SCORE_NAME_PARTIAL + groups.SCORE_AREA and "name (part)" in why  # the misspelling still reads
    points, _ = groups.score(_facts(group_name="Old Apostolic Church", area="Elsies River"), p)
    assert points == 0  # a different church in the same suburb
    points, why = groups.score(_facts(group_name="NAC Elsies River", area="Elsies River"), p)
    assert "name" in why and points >= groups.SCORE_NAME


@db
def test_the_form_accepts_a_group_pick_and_none_of_these():
    from src.services import public_form
    from src.services.settings import get_settings

    base = {
        "visit_date": (date.today() + timedelta(days=30)).isoformat(),
        "visitors": 40,
        "group_name": "TEST Grade 9 outing",
        "group_type": "school",
        "area": "Paarl",
        "contact_name": "Jane Test",
        "contact_email": "jane@example.com",
        "contact_mobile": "082 123 4567",
        "questions": [],
        "policy_accepted": True,
    }
    clean, errors = public_form.validate_request({**base, "group_id": "999999999"}, get_settings(), closed_days=set())
    assert errors.get("group_name") == "Choose the group from the list again"
    clean, errors = public_form.validate_request({**base, "group_choice": "none"}, get_settings(), closed_days=set())
    assert not errors and clean["group_id"] is None and clean["group_choice"] == "none"


def test_public_suggestions_hide_families_and_need_three_letters():
    from src.services import public_form

    assert public_form._public_group({"name": "Daniels Family", "group_type": "nonprofit"}) is False
    assert public_form._public_group({"name": "Kiana's Angels Aftercare", "group_type": "family"}) is False
    assert public_form._public_group({"name": "Mondale High", "group_type": "school"}) is True
    assert public_form.suggest_groups("ne", None, None)["matches"] == []
    assert public_form.suggest_rate_limited("203.0.113.9", now=1.0) is False
    for i in range(public_form.SUGGEST_PER_MINUTE):
        public_form.suggest_rate_limited("203.0.113.9", now=1.0 + i * 0.1)
    assert public_form.suggest_rate_limited("203.0.113.9", now=10.0) is True
