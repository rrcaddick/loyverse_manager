from __future__ import annotations

from src.services import extraction as ex


def test_returns_empty_dict_without_api_key(monkeypatch):
    monkeypatch.setattr(ex, "ANTHROPIC_API_KEY", None)
    assert ex.extract_booking_fields("Hi we want to book") == {}


def test_input_is_capped_and_subject_included():
    prompt = ex._prepare_input("x" * 10_000, "Visit")
    assert prompt.startswith("Subject: Visit")
    assert "[truncated]" in prompt
    assert len(prompt) < ex.MAX_INPUT_CHARS + 200


def test_clean_normalises_types():
    out = ex._clean({"adults": "12", "children": None, "group_type": "zoo", "questions": [" a? ", ""], "notes": " n "})
    assert out["adults"] == 12 and out["children"] is None
    assert out["group_type"] is None
    assert out["questions"] == ["a?"]
    assert out["notes"] == "n"
    assert set(out) == set(ex.FIELD_KEYS)


def test_schema_covers_every_field():
    assert set(ex.SCHEMA["properties"]) == set(ex.FIELD_KEYS)
    assert ex.SCHEMA["additionalProperties"] is False


def test_api_errors_never_raise(monkeypatch):
    monkeypatch.setattr(ex, "ANTHROPIC_API_KEY", "sk-test")

    class Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("no network")

    monkeypatch.setattr(ex, "_client", Boom)
    out = ex.extract_booking_fields("hello", subject="x")
    assert set(out) == {"error"}
