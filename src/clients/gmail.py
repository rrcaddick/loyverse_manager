"""Gmail transport: IMAP (read-only) and SMTP (STARTTLS).

The mailbox is the park's live bookings inbox, so the IMAP side is strictly
read-only by construction: folders are always selected with ``readonly=True``,
bodies are fetched with ``BODY.PEEK[]`` (which does not set ``\\Seen``), and
there is no method that sets flags, moves, deletes or expunges anything.

    with GmailImap() as imap:
        uidvalidity = imap.select("INBOX")
        uids = imap.search_above_uid(last_uid)
        for item in imap.fetch(uids):
            item["uid"], item["gmail_msgid"], item["gmail_thrid"], item["raw"]

    GmailSmtp().send(from_addr, [to], mime_bytes)

Both classes retry once on a transient (socket / server-abort) error with a
fresh connection; everything else surfaces as a typed ``GmailError``.
"""

from __future__ import annotations

import imaplib
import smtplib
import socket
import ssl
import time
from datetime import date, datetime
from typing import Iterable, Iterator

from imapclient import IMAPClient
from imapclient.exceptions import IMAPClientError, LoginError

from config.settings import (
    GMAIL_ADDRESS,
    GMAIL_APP_PASSWORD,
    GMAIL_IMAP_HOST,
    GMAIL_SMTP_HOST,
    GMAIL_SMTP_PORT,
)
from src.utils.logging import setup_logger

logger = setup_logger("gmail")

INBOX = "INBOX"
SENT = "[Gmail]/Sent Mail"

# imapclient hands back the body under BODY[] even when requested as BODY.PEEK[].
_BODY_KEYS = (b"BODY[]", b"BODY.PEEK[]", b"RFC822")
_FETCH_ITEMS = ["X-GM-MSGID", "X-GM-THRID", "INTERNALDATE", "FLAGS", "BODY.PEEK[]"]


INBOX = "INBOX"
SENT = "[Gmail]/Sent Mail"
ALL_MAIL = "[Gmail]/All Mail"


class GmailError(Exception):
    """Base class for Gmail transport failures."""


class GmailConfigError(GmailError):
    """GMAIL_ADDRESS / GMAIL_APP_PASSWORD are not configured."""


class GmailAuthError(GmailError):
    """Login refused (bad app password, IMAP disabled, account locked)."""


class GmailTransientError(GmailError):
    """Network or server hiccup; the operation was retried once and still failed."""


class GmailReadOnlyViolation(GmailError):
    """Something asked for a writable folder. Never allowed."""


_TRANSIENT = (
    socket.error,
    socket.timeout,
    ssl.SSLError,
    imaplib.IMAP4.abort,
    ConnectionError,
    smtplib.SMTPServerDisconnected,
    smtplib.SMTPConnectError,
    EOFError,
)


def _require_credentials() -> tuple[str, str]:
    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
        raise GmailConfigError("GMAIL_ADDRESS and GMAIL_APP_PASSWORD must be set")
    return GMAIL_ADDRESS, GMAIL_APP_PASSWORD


# ------------------------------------------------------------------ IMAP ---


class GmailImap:
    """Read-only IMAP session against the bookings mailbox."""

    def __init__(
        self,
        host: str | None = None,
        address: str | None = None,
        password: str | None = None,
        timeout: float = 60.0,
    ):
        self.host = host or GMAIL_IMAP_HOST
        self.address = address
        self.password = password
        self.timeout = timeout
        self._client: IMAPClient | None = None
        self._folder: str | None = None

    # -- lifecycle ---------------------------------------------------------

    def __enter__(self) -> "GmailImap":
        self.connect()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def connect(self) -> None:
        address, password = (
            (self.address, self.password)
            if self.address and self.password
            else _require_credentials()
        )
        try:
            client = IMAPClient(self.host, ssl=True, timeout=self.timeout)
            client.login(address, password)
        except LoginError as exc:
            raise GmailAuthError(f"IMAP login refused: {exc}") from exc
        except _TRANSIENT as exc:
            raise GmailTransientError(f"IMAP connect failed: {exc}") from exc
        except IMAPClientError as exc:
            raise GmailError(f"IMAP connect failed: {exc}") from exc
        self._client = client
        self._folder = None

    def close(self) -> None:
        if self._client is None:
            return
        try:
            self._client.logout()
        except Exception:  # noqa: BLE001 - best effort on the way out
            try:
                self._client.shutdown()
            except Exception:  # noqa: BLE001
                pass
        self._client = None
        self._folder = None

    @property
    def client(self) -> IMAPClient:
        if self._client is None:
            self.connect()
        assert self._client is not None
        return self._client

    def _reconnect(self) -> None:
        folder = self._folder
        self.close()
        self.connect()
        if folder:
            self._select(folder)

    def _retry(self, label: str, fn, *args):
        """Run ``fn``; on a transient failure reconnect and try exactly once more."""
        try:
            return fn(*args)
        except _TRANSIENT as exc:
            logger.warning(f"IMAP {label} hit a transient error, retrying once: {exc}")
            time.sleep(1.0)
            try:
                self._reconnect()
                return fn(*args)
            except _TRANSIENT as exc2:
                raise GmailTransientError(f"IMAP {label} failed after retry: {exc2}") from exc2
            except IMAPClientError as exc2:
                raise GmailError(f"IMAP {label} failed: {exc2}") from exc2
        except IMAPClientError as exc:
            raise GmailError(f"IMAP {label} failed: {exc}") from exc

    # -- folders -----------------------------------------------------------

    def list_folders(self) -> list[str]:
        def _do():
            return [name for _flags, _delim, name in self.client.list_folders()]

        return self._retry("list_folders", _do)

    def _select(self, folder: str) -> int:
        info = self.client.select_folder(folder, readonly=True)
        self._folder = folder
        return int(info.get(b"UIDVALIDITY", 0))

    def select(self, folder: str, readonly: bool = True) -> int:
        """Select ``folder`` read-only and return its UIDVALIDITY.

        ``readonly`` exists for signature clarity only; asking for a writable
        folder raises instead of silently honouring it.
        """
        if not readonly:
            raise GmailReadOnlyViolation("The bookings mailbox is read-only")
        return self._retry("select", self._select, folder)

    # -- search ------------------------------------------------------------

    def search_since(self, since: date | datetime) -> list[int]:
        """UIDs of messages received on/after ``since`` (IMAP SINCE is date-granular)."""
        if isinstance(since, datetime):
            since = since.date()

        def _do():
            return sorted(int(u) for u in self.client.search(["SINCE", since]))

        return self._retry("search_since", _do)

    def search_between(self, since: date | datetime, before: date | datetime) -> list[int]:
        """UIDs received on/after ``since`` and strictly before ``before`` (date-granular)."""
        if isinstance(since, datetime):
            since = since.date()
        if isinstance(before, datetime):
            before = before.date()

        def _do():
            return sorted(int(u) for u in self.client.search(["SINCE", since, "BEFORE", before]))

        return self._retry("search_between", _do)

    def search_above_uid(self, last_uid: int) -> list[int]:
        """UIDs strictly greater than ``last_uid``.

        Gmail answers ``UID n:*`` with the highest existing UID even when it is
        below ``n``, so the result is filtered client-side.
        """
        start = int(last_uid) + 1

        def _do():
            found = self.client.search(["UID", f"{start}:*"])
            return sorted(int(u) for u in found if int(u) > int(last_uid))

        return self._retry("search_above_uid", _do)

    def search_gmail(self, query: str) -> list[int]:
        """UIDs matching a Gmail search-box query (X-GM-RAW) in the selected folder.

        Accepts the full web syntax: ``from:``, ``to:``, ``cc:``, ``subject:``,
        ``filename:``, ``after:YYYY/MM/DD``, quoted phrases and ``OR``.
        """

        def _do():
            return sorted(int(u) for u in self.client.gmail_search(query))

        return self._retry("search_gmail", _do)

    def search_thread(self, gmail_thrid: int) -> list[int]:
        """Every UID of a Gmail conversation in the selected folder."""

        def _do():
            return sorted(int(u) for u in self.client.search(["X-GM-THRID", int(gmail_thrid)]))

        return self._retry("search_thread", _do)

    def search_msgid(self, gmail_msgid: int) -> list[int]:
        def _do():
            return sorted(int(u) for u in self.client.search(["X-GM-MSGID", int(gmail_msgid)]))

        return self._retry("search_msgid", _do)

    def fetch_meta(self, uids: Iterable[int], chunk: int = 200) -> Iterator[dict]:
        """Headers only (no bodies): ``uid``, ``gmail_msgid``, ``gmail_thrid``,
        ``internaldate``, ``size``, ``from_name``, ``from_email``, ``to``, ``cc``,
        ``subject``, ``message_id``, ``headers`` (lower-cased name -> value)."""
        uid_list = sorted(set(int(u) for u in uids))
        items = [b"X-GM-MSGID", b"X-GM-THRID", b"INTERNALDATE", b"RFC822.SIZE", b"BODY.PEEK[HEADER]"]
        for i in range(0, len(uid_list), max(1, chunk)):
            batch = uid_list[i : i + chunk]

            def _do(batch=batch):
                return self.client.fetch(batch, items)

            response = self._retry("fetch_meta", _do)
            for uid in batch:
                data = response.get(uid)
                if not data:
                    continue
                raw = next((data[k] for k in (b"BODY[HEADER]", b"BODY.PEEK[HEADER]") if k in data), b"")
                yield dict(
                    _parse_header_block(bytes(raw)),
                    uid=uid,
                    gmail_msgid=_as_int(data.get(b"X-GM-MSGID")),
                    gmail_thrid=_as_int(data.get(b"X-GM-THRID")),
                    internaldate=data.get(b"INTERNALDATE"),
                    size=_as_int(data.get(b"RFC822.SIZE")) or 0,
                )

    # -- idle --------------------------------------------------------------

    def idle_wait(self, timeout: int = 1500) -> bool:
        """Block until the server reports a change in the selected folder or
        ``timeout`` seconds pass. Returns True when something changed."""
        client = self.client
        client.idle()
        try:
            responses = client.idle_check(timeout=timeout)
        finally:
            client.idle_done()
        return any(len(r) > 1 and r[1] in (b"EXISTS", b"RECENT", b"EXPUNGE", b"FETCH") for r in responses or [])

    # -- fetch -------------------------------------------------------------

    def fetch(self, uids: Iterable[int], chunk: int = 50) -> Iterator[dict]:
        """Yield one dict per message, in UID order, fetched ``chunk`` at a time.

        Keys: ``uid``, ``gmail_msgid``, ``gmail_thrid``, ``internaldate``
        (aware datetime or None), ``flags`` (list[str]), ``raw`` (bytes).
        Bodies are fetched with BODY.PEEK[] so the server never marks them read.
        """
        uid_list = sorted(set(int(u) for u in uids))
        for i in range(0, len(uid_list), max(1, chunk)):
            batch = uid_list[i : i + chunk]

            def _do(batch=batch):
                return self.client.fetch(batch, _FETCH_ITEMS)

            response = self._retry("fetch", _do)
            for uid in batch:
                data = response.get(uid)
                if not data:
                    logger.warning(f"IMAP fetch returned nothing for uid {uid}")
                    continue
                raw = next((data[k] for k in _BODY_KEYS if k in data), None)
                if raw is None:
                    logger.warning(f"IMAP fetch for uid {uid} had no body: {sorted(data)}")
                    continue
                yield {
                    "uid": uid,
                    "gmail_msgid": _as_int(data.get(b"X-GM-MSGID")),
                    "gmail_thrid": _as_int(data.get(b"X-GM-THRID")),
                    "internaldate": data.get(b"INTERNALDATE"),
                    "flags": [_as_str(f) for f in data.get(b"FLAGS", ())],
                    "raw": bytes(raw),
                }


def _parse_header_block(raw: bytes) -> dict:
    """The few header fields the planners need, parsed from a BODY[HEADER] block."""
    import email
    import email.policy
    from email.utils import getaddresses

    out = {
        "from_name": None, "from_email": None, "to": [], "cc": [], "subject": "",
        "message_id": None, "in_reply_to": None, "date": None, "headers": {},
    }
    if not raw:
        return out
    try:
        msg = email.message_from_bytes(raw, policy=email.policy.default)
    except Exception:  # noqa: BLE001
        return out
    try:
        pairs = getaddresses([str(v) for v in msg.get_all("From", [])])
    except Exception:  # noqa: BLE001
        pairs = []
    if pairs:
        out["from_name"] = (pairs[0][0] or None)
        out["from_email"] = (pairs[0][1] or "").lower() or None

    def _list(name: str) -> list[str]:
        try:
            return [a.lower() for _n, a in getaddresses([str(v) for v in msg.get_all(name, [])]) if a]
        except Exception:  # noqa: BLE001
            return []

    out["to"] = _list("To")
    out["cc"] = _list("Cc")
    out["subject"] = str(msg.get("Subject") or "")[:500]
    out["message_id"] = (str(msg.get("Message-ID") or "").strip() or None)
    out["in_reply_to"] = (str(msg.get("In-Reply-To") or "").strip() or None)
    try:
        from email.utils import parsedate_to_datetime

        out["date"] = parsedate_to_datetime(str(msg.get("Date"))) if msg.get("Date") else None
    except Exception:  # noqa: BLE001
        out["date"] = None
    headers: dict[str, str] = {}
    for key, value in msg.items():
        k = key.lower()
        v = str(value)
        headers[k] = (headers[k] + "\n" + v) if k in headers else v
    out["headers"] = headers
    return out


class GmailImapWriter(GmailImap):
    """The one read-write session: it only ever adds or removes Gmail labels.

    Removing the ``\\Inbox`` label is what Gmail calls archiving; nothing here
    deletes, moves or flags a message.
    """

    def select(self, folder: str, readonly: bool = False) -> int:
        def _do():
            info = self.client.select_folder(folder, readonly=readonly)
            self._folder = folder
            return int(info.get(b"UIDVALIDITY", 0))

        return self._retry("select_rw", _do)

    def ensure_label(self, label: str) -> None:
        names = set(self.list_folders())
        if label not in names:
            self._retry("create_folder", self.client.create_folder, label)

    def add_label(self, uids: Iterable[int], label: str) -> None:
        uid_list = sorted(set(int(u) for u in uids))
        if uid_list:
            self._retry("add_gmail_labels", self.client.add_gmail_labels, uid_list, label)

    def remove_label(self, uids: Iterable[int], label: str) -> None:
        uid_list = sorted(set(int(u) for u in uids))
        if uid_list:
            self._retry("remove_gmail_labels", self.client.remove_gmail_labels, uid_list, label)

    def archive(self, uids: Iterable[int]) -> None:
        self.remove_label(uids, "\\Inbox")



def _as_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_str(value) -> str:
    if isinstance(value, bytes):
        return value.decode("ascii", "replace")
    return str(value)


# ------------------------------------------------------------------ SMTP ---


class GmailSmtp:
    """Submit mail over Gmail SMTP with STARTTLS (port 587)."""

    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
        address: str | None = None,
        password: str | None = None,
        timeout: float = 30.0,
    ):
        self.host = host or GMAIL_SMTP_HOST
        self.port = int(port or GMAIL_SMTP_PORT or 587)
        self.address = address
        self.password = password
        self.timeout = timeout

    def _credentials(self) -> tuple[str, str]:
        if self.address and self.password:
            return self.address, self.password
        return _require_credentials()

    def _send_once(self, from_addr: str, to_addrs: list[str], mime_bytes: bytes) -> dict:
        address, password = self._credentials()
        context = ssl.create_default_context()
        with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            try:
                server.login(address, password)
            except smtplib.SMTPAuthenticationError as exc:
                raise GmailAuthError(f"SMTP login refused: {exc.smtp_code}") from exc
            refused = server.sendmail(from_addr, to_addrs, mime_bytes)
        return refused or {}

    def send(self, from_addr: str, to_addrs: list[str], mime_bytes: bytes) -> None:
        """Send ``mime_bytes`` to ``to_addrs``. Raises GmailError on failure."""
        recipients = [a for a in to_addrs if a]
        if not recipients:
            raise GmailError("No recipients")
        attempt = 0
        while True:
            attempt += 1
            try:
                refused = self._send_once(from_addr, recipients, mime_bytes)
            except GmailAuthError:
                raise
            except _TRANSIENT as exc:
                if attempt >= 2:
                    raise GmailTransientError(f"SMTP send failed after retry: {exc}") from exc
                logger.warning(f"SMTP transient error, retrying once: {exc}")
                time.sleep(1.5)
                continue
            except smtplib.SMTPRecipientsRefused as exc:
                raise GmailError(f"All recipients refused: {exc.recipients}") from exc
            except smtplib.SMTPException as exc:
                raise GmailError(f"SMTP send failed: {exc}") from exc
            if refused:
                raise GmailError(f"Some recipients refused: {refused}")
            return
