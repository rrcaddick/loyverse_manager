"""FNB transaction-history client (port of ``~/repos/python/fnb/fnb_client.py``).

Everything here was verified live against FNB's gateway; the README in that
repo (§3, §4, §7, §13.5) has the evidence. The behaviours that matter:

* OAuth2 client-credentials token over HTTP basic auth at ``POST /oauth2/token/v2``,
  cached until 30 s before ``expires_in``; there is no refresh token.
* ``GET /transaction-history/retrieve/v2/{account}?fromDate&toDate&lastItemKey``
  with a fresh ``X-Request-ID`` / ``X-Idempotency-ID`` on every call.
* Pagination through ``groupHeader.pagination.lastItemKey`` (the key is
  *exclusive*) until ``lastPageIndicator`` is true.
* 401 → re-authenticate once and retry; 429 → sleep ``x-ratelimit-reset`` seconds
  and retry. Anything else raises ``FNBAPIError`` with the body and trace id.
* An empty window returns ``"entry": null``, not an empty list.
* DEBIT amounts arrive as negative strings; ``flatten`` normalises on the
  ``creditDebitIndicator`` and never on the sign.
* ``entryId`` is positional (``YYYYMMDD`` + per-day counter) and FNB says it is
  not unique, so identity is ``fingerprint()``: content plus an occurrence index.
* The gateway caches a ``(account, fromDate, toDate)`` window for 30–70 minutes;
  a poller must vary ``toDate`` (see ``src/services/bank.py``).
* Production history only reaches back to 2026-07-01.

The helpers at the bottom (``flatten``, ``fingerprint``, ``fingerprint_entries``,
``check_balance_chain``) are pure and need no network or credentials.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Iterator

import requests

from src.utils.logging import setup_logger

logger = setup_logger("fnb")

TOKEN_PATH = "/oauth2/token/v2"
TXN_HISTORY_PATH = "/transaction-history/retrieve/v2/{account}"
TOKEN_SAFETY_MARGIN_S = 30  # re-auth this many seconds before expires_in
DEFAULT_TIMEOUT_S = 30.0
MAX_ATTEMPTS = 3


class FNBError(Exception):
    """Base class for everything this module raises."""


class FNBConfigError(FNBError):
    """Credentials or account number missing from config.settings."""


class FNBAPIError(FNBError):
    """Non-2xx response. Carries the parsed body and FNB's trace id for support."""

    def __init__(self, status: int, body: Any, trace_id: str | None = None):
        self.status = status
        self.body = body
        self.trace_id = trace_id
        if isinstance(body, dict):
            message = body.get("message") or body.get("error") or str(body)
        else:
            message = str(body)[:300]
        super().__init__(f"HTTP {status}: {message} (traceId={trace_id})")


@dataclass
class Token:
    access_token: str
    expires_at: float  # epoch seconds
    scope: str = ""

    @property
    def is_valid(self) -> bool:
        return time.time() < self.expires_at - TOKEN_SAFETY_MARGIN_S


class FNBClient:
    """Authenticated access to the transaction-history endpoint.

    ``session`` and ``sleep`` are injectable so the retry paths can be tested
    without a network.
    """

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        base_url: str,
        account: str | None = None,
        timeout: float = DEFAULT_TIMEOUT_S,
        session: requests.Session | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if not client_id or not client_secret or not base_url:
            raise FNBConfigError("FNB client id, secret and base URL are all required")
        self.client_id = client_id
        self.client_secret = client_secret
        self.base_url = base_url.rstrip("/")
        self.account = account
        self.timeout = timeout
        self.session = session or requests.Session()
        self._sleep = sleep
        self._token: Token | None = None
        self.request_count = 0  # every HTTP call, token requests included

    @classmethod
    def from_settings(cls, **overrides) -> "FNBClient":
        """Build from ``config.settings``; raises ``FNBConfigError`` when unset."""
        from config import settings as cfg

        missing = [
            name
            for name in ("FNB_CLIENT_ID", "FNB_CLIENT_SECRET", "FNB_ACCOUNT_NUMBER")
            if not getattr(cfg, name, None)
        ]
        if missing:
            raise FNBConfigError(f"Missing FNB settings: {', '.join(missing)}")
        kwargs: dict[str, Any] = {
            "client_id": cfg.FNB_CLIENT_ID,
            "client_secret": cfg.FNB_CLIENT_SECRET,
            "base_url": cfg.FNB_BASE_URL,
            "account": cfg.FNB_ACCOUNT_NUMBER,
        }
        kwargs.update(overrides)
        return cls(**kwargs)

    # ----------------------------------------------------------------- auth ---

    def authenticate(self) -> Token:
        self.request_count += 1
        response = self.session.post(
            self.base_url + TOKEN_PATH,
            auth=(self.client_id, self.client_secret),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
            timeout=self.timeout,
        )
        if response.status_code != 200:
            raise FNBAPIError(
                response.status_code, _safe_json(response), _trace_id(response)
            )
        body = response.json()
        self._token = Token(
            access_token=body["access_token"],
            expires_at=time.time() + int(body.get("expires_in", 300)),
            scope=body.get("scope", ""),
        )
        logger.info(
            f"FNB token acquired (expires_in={body.get('expires_in')}, "
            f"scope={self._token.scope or '-'})"
        )
        return self._token

    def _bearer(self) -> str:
        if self._token is None or not self._token.is_valid:
            self.authenticate()
        assert self._token is not None
        return f"Bearer {self._token.access_token}"

    # -------------------------------------------------------------- request ---

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json_body: dict | None = None,
        ok: tuple[int, ...] = (200,),
    ) -> requests.Response:
        """Authenticated call: re-auth once on 401, wait and retry on 429."""
        url = self.base_url + path
        for attempt in range(MAX_ATTEMPTS):
            headers = {
                "Authorization": self._bearer(),
                "Accept": "application/json",
                "X-Request-ID": str(uuid.uuid4()),
                "X-Idempotency-ID": str(uuid.uuid4()),
            }
            self.request_count += 1
            response = self.session.request(
                method,
                url,
                params=params,
                json=json_body,
                headers=headers,
                timeout=self.timeout,
            )
            logger.info(
                f"FNB {method} {path} {params or ''} -> {response.status_code} "
                f"(ratelimit remaining={response.headers.get('x-ratelimit-remaining')} "
                f"trace={_trace_id(response)})"
            )
            if response.status_code in ok:
                return response
            if response.status_code == 401 and attempt == 0:
                self._token = None  # expired mid-flight; re-auth and retry once
                continue
            if response.status_code == 429 and attempt < MAX_ATTEMPTS - 1:
                wait = _int_header(response, "x-ratelimit-reset", 60)
                logger.warning(f"FNB rate limited, sleeping {wait}s")
                self._sleep(wait)
                continue
            raise FNBAPIError(
                response.status_code, _safe_json(response), _trace_id(response)
            )
        raise FNBAPIError(0, "retries exhausted")

    # -------------------------------------------------- transaction history ---

    def get_transactions_page(
        self,
        account: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        last_item_key: str | None = None,
    ) -> dict:
        """One raw page. Dates are ``YYYY-MM-DD`` and inclusive on both ends."""
        account = self._account(account)
        params = {
            key: value
            for key, value in {
                "fromDate": from_date,
                "toDate": to_date,
                "lastItemKey": last_item_key,
            }.items()
            if value
        }
        return self.request(
            "GET", TXN_HISTORY_PATH.format(account=account), params=params
        ).json()

    def iter_pages(
        self,
        account: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> Iterator[dict]:
        key: str | None = None
        while True:
            body = self.get_transactions_page(account, from_date, to_date, key)
            yield body
            pagination = (body.get("groupHeader") or {}).get("pagination") or {}
            if pagination.get("lastPageIndicator", True) or not pagination.get("lastItemKey"):
                return
            key = pagination["lastItemKey"]

    def iter_transactions(
        self,
        account: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> Iterator[dict]:
        """Every raw entry across all pages, oldest first as the API returns them."""
        for body in self.iter_pages(account, from_date, to_date):
            for entry in body.get("entry") or []:  # null when the window is empty
                yield entry

    def _account(self, account: str | None) -> str:
        account = account or self.account
        if not account:
            raise FNBConfigError("No FNB account number given")
        return account


# ----------------------------------------------------------------- helpers ---

FLAT_FIELDS = (
    "entry_id",
    "booking_date",
    "value_date",
    "description",
    "end_to_end_id",
    "amount",
    "currency",
    "credit_debit",
    "signed_amount",
    "balance",
    "balance_currency",
    "balance_credit_debit",
)


def flatten(entry: dict) -> dict:
    """Flatten one API entry into plain columns.

    ``amount`` is the unsigned magnitude as a 2dp string; ``signed_amount`` is a
    float signed by ``creditDebitIndicator``. The sign that happens to be on the
    wire (debits arrive negative) is ignored on purpose.
    """
    details = (entry.get("entryDetails") or {}).get("transactionDetails") or {}
    amount = entry.get("amount") or {}
    availability = entry.get("availability") or {}
    credit_debit = entry.get("creditDebitIndicator")
    magnitude = abs(float(amount.get("amount") or 0))
    return {
        "entry_id": entry.get("entryId"),
        "booking_date": (entry.get("bookingDate") or {}).get("Date"),
        "value_date": (entry.get("valueDate") or {}).get("Date"),
        "description": (details.get("remittanceInfo") or {}).get("unstructured"),
        "end_to_end_id": (details.get("reference") or {}).get("endToEndId"),
        "amount": f"{magnitude:.2f}",
        "currency": amount.get("currency"),
        "credit_debit": credit_debit,
        "signed_amount": magnitude if credit_debit == "CREDIT" else -magnitude,
        "balance": availability.get("amount"),
        "balance_currency": availability.get("currency"),
        "balance_credit_debit": availability.get("creditDebitIndicator"),
    }


def fingerprint(account: str, entry: dict, occurrence: int = 0) -> str:
    """Stable content key for an entry, independent of ``entryId``.

    Two entries identical in every field the bank exposes (day, amount,
    direction, description, endToEndId) are told apart by ``occurrence``: their
    0-based position among identical siblings on that booking date in API order.
    The running balance is excluded because it moves when the bank re-orders a day.
    """
    row = flatten(entry)
    key = "|".join(
        [
            account,
            row["booking_date"] or "",
            row["value_date"] or "",
            row["credit_debit"] or "",
            str(row["amount"] or ""),
            row["currency"] or "",
            (row["description"] or "").strip(),
            (row["end_to_end_id"] or "").strip(),
            str(occurrence),
        ]
    )
    return hashlib.sha256(key.encode()).hexdigest()[:32]


def fingerprint_entries(account: str, entries) -> list[tuple[str, dict]]:
    """``[(fingerprint, entry)]`` for a page or a whole window, numbering identical
    siblings in the order the API returned them."""
    counts: dict[str, int] = {}
    out: list[tuple[str, dict]] = []
    for entry in entries:
        base = fingerprint(account, entry, 0)
        n = counts.get(base, 0)
        counts[base] = n + 1
        out.append((fingerprint(account, entry, n) if n else base, entry))
    return out


def check_balance_chain(entries, opening_balance: float | None = None) -> list[dict]:
    """Verify ``prev_balance + signed_amount == availability.amount`` in API order.

    Returns the entries where the chain breaks. Entries whose reported balance
    is exactly 0.00 are skipped and do not reset the chain: the bank returns
    0.00 for entries booked after the current business date.
    """
    breaks: list[dict] = []
    prev = opening_balance
    for entry in entries:
        row = flatten(entry)
        balance = float(row["balance"] or 0)
        if balance == 0.0:
            continue
        if prev is not None and abs(prev + row["signed_amount"] - balance) > 0.005:
            breaks.append(
                {
                    "entry_id": row["entry_id"],
                    "expected": round(prev + row["signed_amount"], 2),
                    "reported": balance,
                    **row,
                }
            )
        prev = balance
    return breaks


def _safe_json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text


def _trace_id(response: requests.Response) -> str | None:
    return response.headers.get("parent_trace_id") or response.headers.get("traceId")


def _int_header(response: requests.Response, name: str, default: int) -> int:
    try:
        return int(response.headers.get(name, default))
    except (TypeError, ValueError):
        return default
