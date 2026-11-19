"""The documents blueprint through the Flask test client (admin session)."""

from __future__ import annotations

import pytest

from src.models.base import execute, query_one
from web.api import SESSION_CSRF_KEY, SESSION_USER_KEY

pytestmark = pytest.mark.usefixtures("require_db")


@pytest.fixture(scope="module")
def app():
    from web.app import create_app

    app = create_app()
    app.config.update(TESTING=True)
    return app


@pytest.fixture
def admin_client(app):
    """A client signed in as a throwaway admin (row removed afterwards)."""
    email = "test-documents-agent@example.test"
    execute("DELETE FROM users WHERE email = %s", (email,))
    admin_id = execute(
        """
        INSERT INTO users (email, full_name, role, password_hash, must_change_password, is_active)
        VALUES (%s, 'TEST documents admin', 'admin', 'not-a-real-hash', 0, 1)
        """,
        (email,),
    )
    client = app.test_client()
    with client.session_transaction() as sess:
        sess[SESSION_USER_KEY] = admin_id
        sess[SESSION_CSRF_KEY] = "test-csrf"
    try:
        yield client
    finally:
        execute("DELETE FROM users WHERE id = %s", (admin_id,))
        assert query_one("SELECT id FROM users WHERE email = %s", (email,)) is None


def test_email_preview_sample_for_every_kind(admin_client):
    from src.services.email_templates import KINDS

    for kind in KINDS:
        res = admin_client.get(f"/api/v1/documents/email-preview/{kind}")
        assert res.status_code == 200, (kind, res.data[:200])
        assert res.mimetype == "text/html"
        assert b"Linda Caddick" in res.data
    res = admin_client.get("/api/v1/documents/email-preview/proforma?format=json")
    assert res.status_code == 200 and set(res.get_json()) == {"subject", "html", "text"}
    res = admin_client.get("/api/v1/documents/email-preview/proforma?format=text")
    assert res.status_code == 200 and res.mimetype == "text/plain"
    assert admin_client.get("/api/v1/documents/email-preview/newsletter").status_code == 422


def test_anonymous_is_denied(app):
    client = app.test_client()
    assert client.get("/api/v1/documents/email-preview/proforma").status_code == 401
    assert client.get("/api/v1/documents/1/pdf").status_code == 401


def test_missing_document_and_booking(admin_client):
    assert admin_client.get("/api/v1/documents/999999999/pdf").status_code == 404
    res = admin_client.post(
        "/api/v1/bookings/999999999/documents/preview",
        json={"kind": "proforma"},
        headers={"X-CSRF-Token": "test-csrf"},
    )
    assert res.status_code == 404
    res = admin_client.post(
        "/api/v1/bookings/1/documents/preview",
        json={"kind": "receipt"},
        headers={"X-CSRF-Token": "test-csrf"},
    )
    assert res.status_code == 422
    assert admin_client.get("/api/v1/bookings/999999999/documents").get_json() == {"items": []}
