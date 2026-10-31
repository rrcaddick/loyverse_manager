"""The FNB client's pure helpers and its transport behaviour, no network.

Fixtures are responses captured from FNB's QA gateway (fnb repo, samples/).
"""

from __future__ import annotations

import copy
import json

import pytest

from src.clients.fnb import (
    FNBAPIError,
    FNBClient,
    FNBConfigError,
    check_balance_chain,
    fingerprint,
    fingerprint_entries,
    flatten,
)

ACCOUNT = "63002461513"


# ------------------------------------------------------------------ flatten ---

def test_flatten_credit(entries):
    first = entries("200_wide_range_8_entries.json")[0]
    row = flatten(first)
    assert row["entry_id"] == "20260407000001"
    assert row["booking_date"] == "2026-04-07"
    assert row["credit_debit"] == "CREDIT"
    assert row["amount"] == "100000000.00"
    assert row["signed_amount"] == 100000000.0
    assert row["end_to_end_id"] is None
    assert row["description"] == "ADJUST OF CR INTEREST"


def test_flatten_normalises_negative_debit_on_indicator(entries):
    debits = [e for e in entries("200_history_after_approvals.json") if e["creditDebitIndicator"] == "DEBIT"]
    assert debits, "fixture should contain debits"
    entry = debits[0]
    assert entry["amount"]["amount"].startswith("-")  # the wire form
    row = flatten(entry)
    assert row["amount"] == "2.01"
    assert row["signed_amount"] == -2.01
    assert row["credit_debit"] == "DEBIT"


def test_flatten_ignores_sign_on_credit():
    entry = {
        "amount": {"amount": "-15.00", "currency": "ZAR"},
        "creditDebitIndicator": "CREDIT",
    }
    assert flatten(entry)["signed_amount"] == 15.0


def test_flatten_tolerates_missing_blocks():
    row = flatten({})
    assert row["amount"] == "0.00" and row["booking_date"] is None and row["balance"] is None


# -------------------------------------------------------------- fingerprint ---

def test_fingerprint_is_stable_and_ignores_entry_id_and_balance(entries):
    entry = entries("200_lastItemKey_page.json")[0]
    base = fingerprint(ACCOUNT, entry)
    assert fingerprint(ACCOUNT, copy.deepcopy(entry)) == base
    moved = copy.deepcopy(entry)
    moved["entryId"] = "20260930000099"
    moved["availability"]["amount"] = "1.00"
    assert fingerprint(ACCOUNT, moved) == base
    assert len(base) == 32


def test_fingerprint_changes_with_content_account_and_occurrence(entries):
    entry = entries("200_lastItemKey_page.json")[0]
    base = fingerprint(ACCOUNT, entry)
    assert fingerprint("99999999999", entry) != base
    assert fingerprint(ACCOUNT, entry, occurrence=1) != base
    changed = copy.deepcopy(entry)
    changed["amount"]["amount"] = "1000.01"
    assert fingerprint(ACCOUNT, changed) != base


def test_fingerprint_entries_numbers_identical_siblings(entries):
    page = entries("200_lastItemKey_page.json")
    twin = copy.deepcopy(page[0])
    twin["entryId"] = "20260930000003"  # same payment twice on one day
    twin["availability"]["amount"] = "101448820.38"
    fps = fingerprint_entries(ACCOUNT, page + [twin])
    keys = [fp for fp, _ in fps]
    assert len(keys) == len(set(keys)) == 3
    assert keys[0] == fingerprint(ACCOUNT, page[0], 0)
    assert keys[2] == fingerprint(ACCOUNT, twin, 1)
    # Order-independent for distinct content, order-dependent only among twins.
    again = [fp for fp, _ in fingerprint_entries(ACCOUNT, page + [twin])]
    assert again == keys


# ------------------------------------------------------------ balance chain ---

def test_balance_chain_holds_on_fixture(entries):
    assert check_balance_chain(entries("200_wide_range_8_entries.json")) == []
    assert check_balance_chain(entries("200_history_after_approvals.json")) == []


def test_balance_chain_reports_break_and_skips_zero_balances(entries):
    rows = copy.deepcopy(entries("200_wide_range_8_entries.json"))
    rows[2]["availability"]["amount"] = "1.00"
    breaks = check_balance_chain(rows)
    assert [b["entry_id"] for b in breaks] == [rows[2]["entryId"], rows[3]["entryId"]]
    rows = copy.deepcopy(entries("200_wide_range_8_entries.json"))
    rows[-1]["availability"]["amount"] = "0.00"  # future-dated tail entry: no balance yet
    assert check_balance_chain(rows) == []


# ---------------------------------------------------------------- transport ---

class FakeResponse:
    def __init__(self, status: int, body, headers: dict | None = None):
        self.status_code = status
        self._body = body
        self.headers = headers or {}
        self.text = json.dumps(body) if not isinstance(body, str) else body

    def json(self):
        if isinstance(self._body, str):
            raise ValueError("not json")
        return self._body


class FakeSession:
    """Scripted responses: ``history`` is a queue consumed by GET calls."""

    def __init__(self, history: list[FakeResponse], token_status: int = 200):
        self.history = list(history)
        self.token_status = token_status
        self.token_calls = 0
        self.calls: list[dict] = []

    def post(self, url, auth=None, data=None, headers=None, timeout=None):
        self.token_calls += 1
        assert auth == ("id", "secret")
        assert data == {"grant_type": "client_credentials"}
        if self.token_status != 200:
            return FakeResponse(self.token_status, {"error": "invalid_client"})
        return FakeResponse(200, {"access_token": f"tok{self.token_calls}", "expires_in": 360, "scope": "i_can_tran_hist"})

    def request(self, method, url, params=None, json=None, headers=None, timeout=None):
        self.calls.append({"method": method, "url": url, "params": params, "headers": headers})
        assert headers["Authorization"].startswith("Bearer tok")
        assert headers["X-Request-ID"] and headers["X-Idempotency-ID"]
        assert headers["X-Request-ID"] != headers["X-Idempotency-ID"]
        return self.history.pop(0)


def make_client(session: FakeSession, sleeps: list | None = None) -> FNBClient:
    return FNBClient(
        "id",
        "secret",
        "https://api.example.test/apigateway/",
        account=ACCOUNT,
        session=session,
        sleep=(sleeps.append if sleeps is not None else (lambda s: None)),
    )


def test_pagination_follows_last_item_key_until_last_page(fixture):
    page = fixture("200_lastItemKey_page.json")["body"]
    first = copy.deepcopy(page)
    first["groupHeader"]["pagination"] = {"lastPageIndicator": False, "lastItemKey": "20260930000002"}
    second = copy.deepcopy(page)
    second["entry"] = [copy.deepcopy(page["entry"][0])]
    second["entry"][0]["entryId"] = "20261001000001"
    session = FakeSession([FakeResponse(200, first), FakeResponse(200, second)])
    client = make_client(session)

    got = list(client.iter_transactions(from_date="2026-09-01", to_date="2026-10-10"))

    assert [e["entryId"] for e in got] == ["20260930000001", "20260930000002", "20261001000001"]
    assert len(session.calls) == 2
    assert session.calls[0]["params"] == {"fromDate": "2026-09-01", "toDate": "2026-10-10"}
    assert session.calls[1]["params"]["lastItemKey"] == "20260930000002"
    assert session.calls[0]["url"].endswith(f"/transaction-history/retrieve/v2/{ACCOUNT}")
    assert session.token_calls == 1  # token cached across pages
    assert client.request_count == 3


def test_empty_window_entry_null(fixture):
    body = fixture("200_empty_entry_null.json")["body"]
    assert body["entry"] is None
    client = make_client(FakeSession([FakeResponse(200, body)]))
    assert list(client.iter_transactions(from_date="2026-10-06", to_date="2026-09-01")) == []


def test_401_reauthenticates_once(fixture):
    body = fixture("200_lastItemKey_page.json")["body"]
    session = FakeSession([FakeResponse(401, {"error": "Unauthorized", "message": "expired"}), FakeResponse(200, body)])
    client = make_client(session)
    got = list(client.iter_transactions())
    assert len(got) == 2
    assert session.token_calls == 2
    assert session.calls[1]["headers"]["Authorization"] == "Bearer tok2"


def test_second_401_raises_with_trace_id():
    session = FakeSession(
        [
            FakeResponse(401, {"message": "bad"}),
            FakeResponse(401, {"message": "still bad"}, {"parent_trace_id": "trace-123"}),
        ]
    )
    client = make_client(session)
    with pytest.raises(FNBAPIError) as exc:
        list(client.iter_transactions())
    assert exc.value.status == 401
    assert exc.value.trace_id == "trace-123"
    assert exc.value.body == {"message": "still bad"}
    assert "still bad" in str(exc.value)


def test_429_sleeps_for_ratelimit_reset_and_retries(fixture):
    body = fixture("200_lastItemKey_page.json")["body"]
    sleeps: list = []
    session = FakeSession([FakeResponse(429, {"message": "slow down"}, {"x-ratelimit-reset": "7"}), FakeResponse(200, body)])
    client = make_client(session, sleeps)
    assert len(list(client.iter_transactions())) == 2
    assert sleeps == [7]


def test_400_raises_api_error():
    session = FakeSession([FakeResponse(400, {"code": 400, "message": "Account not provisioned", "traceId": "t"})])
    client = make_client(session)
    with pytest.raises(FNBAPIError) as exc:
        client.get_transactions_page(from_date="2026-09-01", to_date="2026-09-02")
    assert exc.value.status == 400 and "not provisioned" in str(exc.value)


def test_token_failure_raises():
    session = FakeSession([], token_status=401)
    client = make_client(session)
    with pytest.raises(FNBAPIError) as exc:
        client.authenticate()
    assert exc.value.status == 401


def test_missing_credentials_raise_config_error():
    with pytest.raises(FNBConfigError):
        FNBClient("", "secret", "https://x")
    client = FNBClient("id", "secret", "https://x", account=None, session=FakeSession([]))
    with pytest.raises(FNBConfigError):
        client.get_transactions_page()


def test_from_settings_requires_all_three(monkeypatch):
    from config import settings as cfg

    monkeypatch.setattr(cfg, "FNB_CLIENT_ID", "id")
    monkeypatch.setattr(cfg, "FNB_CLIENT_SECRET", "secret")
    monkeypatch.setattr(cfg, "FNB_ACCOUNT_NUMBER", None)
    with pytest.raises(FNBConfigError, match="FNB_ACCOUNT_NUMBER"):
        FNBClient.from_settings()
    monkeypatch.setattr(cfg, "FNB_ACCOUNT_NUMBER", "123")
    client = FNBClient.from_settings(session=FakeSession([]))
    assert client.account == "123"
    assert client.base_url.rstrip("/") == cfg.FNB_BASE_URL.rstrip("/")


def test_helpers_import_without_network(monkeypatch):
    """The pure helpers work with the network stack disabled."""
    import socket

    def refuse(*args, **kwargs):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket, "create_connection", refuse)
    entry = {"amount": {"amount": "1.00", "currency": "ZAR"}, "creditDebitIndicator": "CREDIT",
             "bookingDate": {"Date": "2026-10-01"}}
    assert fingerprint_entries("1", [entry, entry])[1][0] == fingerprint("1", entry, 1)
