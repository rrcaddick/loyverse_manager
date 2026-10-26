from datetime import datetime

from src.services import matching as mt


def test_distinctive_tokens_drop_generic_words_and_grades():
    assert mt.distinctive_tokens("Vissershok Primary gr 3: 6-10") == ["vissershok"]
    assert mt.distinctive_tokens("New Apostolic Church Kraaifontein") == ["kraaifontein"]
    assert mt.distinctive_tokens("Mondale High School") == ["mondale"]
    assert mt.distinctive_tokens("Laerskool Stellenbosch") == ["stellenbosch"]
    assert mt.distinctive_tokens("Family outing") == []


def test_name_parts_skip_particles():
    assert mt.name_parts("Charmaine Van Schalkwyk") == ("charmaine", "schalkwyk")
    assert mt.name_parts("Michelle") == ("michelle", None)
    assert mt.name_parts("Pieter de la Rey") == ("pieter", "rey")


def test_phone_variants_cover_the_common_spellings():
    v = mt.phone_variants("+27 82 706 9415")
    assert "082 706 9415" in v and "0827069415" in v and "27827069415" in v and "27 82 706 9415" in v
    assert len(v) == len(set(v))
    assert mt.phone_variants("12345") == []


def test_mobiles_in_text_find_every_spelling():
    text = "Cell: 082-706-9415 or +27 (0)82 706 9415, tel 0827069415, cell:0827069415, (082) 706 94 15"
    assert mt.mobiles_in_text(text) == {"27827069415"}
    assert mt.mobiles_in_text("ref 2026/10/22 order 123456") == set()


def test_reference_query_covers_subject_body_and_filenames():
    q = mt.reference_query(1719)
    assert "FY1719" in q and 'filename:"FY 1719"' in q and "INV-1719" in q
    assert mt.reference_query(None) is None


def test_score_group_plus_surname_attaches_but_group_alone_reviews():
    booking = mt.BookingFacts.from_row(
        {"id": 1, "reference": "FY1719", "doc_number": 1719, "group_name": "Vissershok Primary gr 3: 6-10",
         "contact_name": "Charmaine Van Schalkwyk", "contact_mobile": None}
    )
    both = mt.ThreadFacts(thrid=1, participants={"evschalkwyk67@gmail.com"}, from_names={"E v Schalkwyk"},
                          subjects={"Vissershok Primary School - Foundation Phase Outing"}, text="Good day, 120 children.")
    pts, why = mt.score(both, booking)
    assert pts == 90 and why == ["group", "surname"] and mt.verdict(pts) == "attach"
    alone = mt.ThreadFacts(thrid=2, participants={"someone@example.com"}, subjects={"Vissershoek outing"}, text="")
    pts, why = mt.score(alone, booking)
    assert pts == 60 and why == ["group"] and mt.verdict(pts) == "review"


def test_score_mobile_and_reference_are_decisive():
    booking = mt.BookingFacts.from_row(
        {"id": 2, "reference": "FY1703", "doc_number": 1703, "group_name": "Oasis", "contact_name": "Sam Jones",
         "contact_mobile": "082 706 9415"}
    )
    t = mt.ThreadFacts(thrid=3, participants={"x@example.com"}, subjects={"hello"}, text="call me on 082 706 9415")
    assert mt.score(t, booking)[1] == ["mobile"]
    t2 = mt.ThreadFacts(thrid=4, participants={"x@example.com"}, subjects={"Proforma FY1703"}, text="")
    assert mt.verdict(mt.score(t2, booking)[0]) == "attach"


def _thread(thrid, last):
    return mt.ThreadFacts(thrid=thrid, first_at=last, last_at=last)


def test_choose_cluster_takes_the_newest_season_and_respects_the_floor():
    old = _thread(1, datetime(2025, 3, 2))
    old2 = _thread(2, datetime(2025, 3, 20))
    new = _thread(3, datetime(2026, 9, 15))
    new2 = _thread(4, datetime(2026, 10, 1))
    chosen, rejected, note = mt.choose_cluster([old, old2, new, new2])
    assert [t.thrid for t in chosen] == [3, 4] and {t.thrid for t in rejected} == {1, 2}
    assert note.startswith("newest of 2")
    chosen, rejected, note = mt.choose_cluster([old, old2])
    assert chosen == [] and len(rejected) == 2 and "before" in note
    straddle = [_thread(5, datetime(2025, 12, 20)), _thread(6, datetime(2026, 1, 10))]
    chosen, _r, _n = mt.choose_cluster(straddle)
    assert [t.thrid for t in chosen] == [5, 6]


def test_expandable_addresses_skip_robots_and_us():
    t = mt.ThreadFacts(thrid=1, participants={"teacher@school.org", "no-reply@bank.co.za", "info@school.org", "bookings@farmyardpark.co.za"})
    assert mt.expandable_addresses(t, {"bookings@farmyardpark.co.za"}) == {"teacher@school.org"}


def test_clusters_join_on_overlapping_spans():
    quote = mt.ThreadFacts(thrid=1, first_at=datetime(2026, 4, 7), last_at=datetime(2026, 4, 9))
    notice = mt.ThreadFacts(thrid=2, first_at=datetime(2026, 4, 15), last_at=datetime(2026, 6, 26))
    chosen, rejected, note = mt.choose_cluster([quote, notice])
    assert {t.thrid for t in chosen} == {1, 2} and rejected == [] and note == "one cluster"


def test_cc_only_address_is_weaker_than_the_contact():
    booking = mt.BookingFacts.from_row({"id": 1, "reference": None, "doc_number": None, "group_name": "Harbour of Hope Ministries",
                                        "contact_name": "Harlane Solomons", "contact_email": "harlane@example.com"})
    booking.cc_emails.add("jill@example.com")
    other = mt.ThreadFacts(thrid=1, participants={"jill@example.com"}, subjects={"Quotation: 19 December 2026"}, text="")
    pts, why = mt.score(other, booking)
    assert why == ["cc-contact"] and mt.verdict(pts) == "review"
    own = mt.ThreadFacts(thrid=2, participants={"harlane@example.com"}, subjects={"Wanting to know"}, text="")
    assert mt.verdict(mt.score(own, booking)[0]) == "attach"


def test_short_group_words_are_weak_evidence():
    booking = mt.BookingFacts.from_row({"id": 1, "reference": None, "doc_number": None, "group_name": "St Mark's Church",
                                        "contact_name": "Denise Lowton"})
    t = mt.ThreadFacts(thrid=1, participants={"markfredericks1@gmail.com"}, from_names={"Mark Fredericks"},
                       subjects={"New Apostolic church Klapmuts Sunday School outing"}, text="")
    pts, why = mt.score(t, booking)
    assert pts == 35 and mt.verdict(pts) == "no"


def test_park_addresses_are_never_contacts():
    assert mt.is_park_address("farmyardmanagers@gmail.com")
    assert mt.is_park_address("info@farmyardpark.co.za")
    assert not mt.is_park_address("jill@example.com")


def test_senders_on_attached_mail_become_full_contacts():
    from src.services import migration

    t = mt.ThreadFacts(thrid=1, participants={"zdollie@nhhs.co.za", "office@nhhs.co.za"}, senders={"zdollie@nhhs.co.za"})
    assert migration.mt.expandable_addresses(t, set()) == {"zdollie@nhhs.co.za"}  # office@ is a shared box
    assert t.senders == {"zdollie@nhhs.co.za"}


def test_dates_in_reads_written_dates():
    from datetime import date

    found = mt.dates_in("Quotation: 19 December 2026 for 550 people, or 7/11/2026")
    assert date(2026, 12, 19) in found and date(2026, 11, 7) in found
