"""The Loyverse accounts behind the terminals: who reported which, and which one is live.

The live account is the one whose e-mail matches the merchant behind this back office's
Loyverse API token (``GET /merchant``, cached for ten minutes), so switching the token to the
production account makes its terminals the live ones at their next roster refresh, and a
training terminal on the throwaway account is never live. ``POS_LIVE_ACCOUNT=<owner id>`` in
the environment pins it by hand. Alerts, reports, the portal and the CLI read the live
account; each terminal reads and writes only its own (``src/models/pos_accounts.py``).
"""
import logging
import os
import time

from config.settings import LOYVERSE_API_KEY
from src.models.pos_accounts import PosAccount, current_account, normalise_account_id
from src.models.pos_staff import PosDevice

logger = logging.getLogger(__name__)

MERCHANT_CACHE_SECONDS = 600


class PosAccountService:
    _merchant = {"at": 0.0, "email": None}

    # ---- from the terminals ------------------------------------------------------------------

    @classmethod
    def seen(cls, account, device_id):
        """The ``account`` block of a registration or roster call: {"id", "business_name", "email"}.
        Records the account, notes it on the device and re-checks which account is live."""
        if not isinstance(account, dict):
            return None
        account_id = normalise_account_id(account.get("id"))
        if not account_id:
            return None
        try:
            PosAccount.seen(account_id, str(account.get("business_name") or ""), str(account.get("email") or ""))
            PosDevice.set_account(device_id, account_id)
            cls.refresh_live()
        except Exception as e:  # never cost the terminal its roster
            logger.error(f"recording account {account_id} for {device_id} failed: {e}")
        return account_id

    # ---- which account is live ---------------------------------------------------------------

    @classmethod
    def merchant_email(cls):
        """The e-mail of the merchant this back office's Loyverse token belongs to (cached); None when unknown."""
        now = time.monotonic()
        if now - cls._merchant["at"] < MERCHANT_CACHE_SECONDS:
            return cls._merchant["email"]
        email = None
        if LOYVERSE_API_KEY:
            try:
                from src.clients.loyverse import LoyverseClient

                merchant = LoyverseClient(LOYVERSE_API_KEY).get("merchant", {}) or {}
                email = str(merchant.get("email") or "").strip().lower() or None
            except Exception as e:
                logger.warning(f"Loyverse merchant lookup failed: {e}")
                return cls._merchant["email"]  # keep the last answer through a blip
        cls._merchant.update(at=now, email=email)
        return email

    @classmethod
    def refresh_live(cls):
        """Re-evaluate the live account: the pinned one, else the account whose e-mail matches
        the API token's merchant; none when nothing matches. Returns the live account id."""
        pinned = normalise_account_id(os.getenv("POS_LIVE_ACCOUNT", ""))
        if pinned:
            if PosAccount.live_id() != pinned:
                PosAccount.set_live(pinned)
            return pinned
        email = cls.merchant_email()
        if email is None:
            return PosAccount.live_id()
        matches = [a for a in PosAccount.all() if (a.get("email") or "").strip().lower() == email]
        wanted = matches[0]["account_id"] if matches else None
        if PosAccount.live_id() != wanted:
            PosAccount.set_live(wanted)
            logger.info(f"live POS account is now {wanted or 'unknown'}")
        return wanted

    @classmethod
    def owner_facing(cls):
        """Whether the current scope is the owner's data: the live account, or no account is known
        to be live yet (then nothing is held back). A training terminal's request is never owner-facing."""
        live = PosAccount.live_id()
        if live is None:
            return True
        return current_account() == live

    # ---- for the CLI -------------------------------------------------------------------------

    @classmethod
    def summary(cls):
        counts = PosAccount.counts()
        rows = {a["account_id"]: dict(a) for a in PosAccount.all()}
        for account_id in counts:
            rows.setdefault(account_id, {"account_id": account_id, "business_name": "", "email": "", "live": 0})
        for account_id, row in rows.items():
            row["counts"] = counts.get(account_id, {})
        return sorted(rows.values(), key=lambda r: (-int(r.get("live") or 0), r["account_id"]))

    @classmethod
    def purge(cls, account_id):
        return PosAccount.purge(normalise_account_id(account_id) if account_id else "")

    @classmethod
    def adopt_untagged(cls, account_id):
        account_id = normalise_account_id(account_id)
        if not account_id:
            raise ValueError("an account id is a number")
        return PosAccount.adopt_untagged(account_id)
