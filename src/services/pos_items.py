"""What the Loyverse items mean to the gate, in one place.

The terminals, the headcount rules and the reports all need to know which receipt lines are
people and which line is a re-entry.  Loyverse's own item ids are not stable (the per-booking
online and group items are created and deleted daily; names and prices change), so the kinds
are keyed on what Ray controls:

* **SKU** for the fixed items: Visitor (public admission, quantity = heads), Re-Entry (R0),
  Group Payment (money only, never heads).
* **Category** for the per-booking items the back office creates: Online Tickets and Groups
  (quantity = heads).  The category *ids* are the anchor (``config.constants.CATEGORIES``);
  the terminals can only see category names, so the names are resolved from the live account
  and handed to them in the roster's policy block.  Renaming a category in Loyverse therefore
  needs no code change; deleting one shows up in ``verify()``.

Lines arrive from the terminals with ``sku`` and ``category`` (bridge build 32+), quantities in
thousandths.
"""

import threading
import time

from config.constants import CATEGORIES
from config.settings import LOYVERSE_API_KEY
from src.utils.logging import setup_logger

logger = setup_logger("pos_items")

VISITOR_SKU = "10000"
REENTRY_SKU = "10001"
GROUP_PAYMENT_SKU = "10037"
HEAD_SKUS = (VISITOR_SKU,)
# CATEGORIES keys whose items count as heads, with the names to assume when the account cannot be asked.
HEAD_CATEGORY_KEYS = {"online_ticket": "Online Tickets", "groups": "Groups"}
REENTRY_CUTOFF = "18:00"  # a re-entry pass is dead at this time on the day it was issued
THOUSANDTHS = 1000
NAMES_TTL_SECONDS = 15 * 60


def _norm(text):
    return " ".join(str(text or "").split()).casefold()


class ItemKinds:
    """Classifies receipt lines; ``current()`` is the live mapping, cached briefly."""

    _lock = threading.Lock()
    _cached = None
    _cached_at = 0.0

    def __init__(self, head_skus=HEAD_SKUS, reentry_sku=REENTRY_SKU, head_categories=None, cutoff=REENTRY_CUTOFF,
                 group_payment_sku=GROUP_PAYMENT_SKU):
        self.head_skus = tuple(str(s) for s in head_skus)
        self.reentry_sku = str(reentry_sku)
        self.group_payment_sku = str(group_payment_sku)
        self.head_categories = tuple(head_categories or HEAD_CATEGORY_KEYS.values())
        self._head_categories_norm = {_norm(c) for c in self.head_categories}
        self.cutoff = cutoff

    # ---- the live mapping ---------------------------------------------------------------------

    @classmethod
    def current(cls):
        """Head category names resolved from the live account (by id), refreshed every 15 minutes;
        the configured fallback names when the account cannot be reached."""
        with cls._lock:
            if cls._cached is not None and time.monotonic() - cls._cached_at < NAMES_TTL_SECONDS:
                return cls._cached
            names = cls._resolve_category_names()
            cls._cached = cls(head_categories=names)
            cls._cached_at = time.monotonic()
            return cls._cached

    @classmethod
    def _resolve_category_names(cls):
        fallback = list(HEAD_CATEGORY_KEYS.values())
        if not LOYVERSE_API_KEY:
            return fallback
        try:
            from src.clients.loyverse import LoyverseClient

            categories = LoyverseClient(LOYVERSE_API_KEY).get("categories").get("categories") or []
        except Exception as e:  # the gate must keep working on the configured names
            logger.warning(f"could not read Loyverse categories, using configured names: {e}")
            return fallback
        by_id = {c.get("id"): c.get("name") for c in categories if not c.get("deleted_at")}
        names = []
        for key, default in HEAD_CATEGORY_KEYS.items():
            name = by_id.get(CATEGORIES.get(key))
            if not name:
                logger.warning(f"Loyverse category for {key} ({CATEGORIES.get(key)}) not found; assuming '{default}'")
                name = default
            names.append(name)
        return names

    def policy(self):
        """The block the terminals receive in the roster."""
        return {
            "reentry_sku": self.reentry_sku,
            "head_skus": list(self.head_skus),
            "head_categories": list(self.head_categories),
            "cutoff": self.cutoff,
        }

    # ---- classifying lines --------------------------------------------------------------------

    @staticmethod
    def quantity(line):
        try:
            return int(line.get("quantity") or 0) / THOUSANDTHS
        except (TypeError, ValueError):
            return 0

    def is_reentry(self, line):
        return str(line.get("sku") or "") == self.reentry_sku

    def is_head(self, line):
        if line.get("voided"):
            return False
        if str(line.get("sku") or "") in self.head_skus:
            return True
        return _norm(line.get("category")) in self._head_categories_norm

    def headcount(self, lines):
        """People paid for on these lines (Visitor, online and group lines), as an int."""
        return int(round(sum(self.quantity(l) for l in lines or [] if isinstance(l, dict) and self.is_head(l))))

    def reentry_heads(self, lines):
        return int(round(sum(self.quantity(l) for l in lines or [] if isinstance(l, dict) and self.is_reentry(l) and not l.get("voided"))))

    def other_lines(self, lines):
        """Lines that are neither re-entry nor heads (gazebos, group payment, anything new)."""
        return [l for l in lines or [] if isinstance(l, dict) and not self.is_reentry(l) and not self.is_head(l)]

    # ---- checking the live account ------------------------------------------------------------

    def verify(self):
        """Problems with the live account against this mapping, as a list of sentences (empty = fine)."""
        problems = []
        if not LOYVERSE_API_KEY:
            return ["LOYVERSE_API_KEY is not set; the mapping cannot be checked"]
        from src.clients.loyverse import LoyverseClient

        client = LoyverseClient(LOYVERSE_API_KEY)
        categories = {c.get("id"): c for c in client.get("categories").get("categories") or []}
        for key in HEAD_CATEGORY_KEYS:
            cat = categories.get(CATEGORIES.get(key))
            if not cat or cat.get("deleted_at"):
                problems.append(f"category for {key} ({CATEGORIES.get(key)}) is missing from the account")
        items = client.get("items").get("items") or []
        skus = {}
        for item in items:
            if item.get("deleted_at"):
                continue
            for v in item.get("variants") or []:
                skus[str(v.get("sku"))] = (item.get("item_name"), v.get("default_price"))
        for sku, what in ((self.reentry_sku, "re-entry"), (self.group_payment_sku, "group payment")):
            if sku not in skus:
                problems.append(f"no item with SKU {sku} ({what})")
        for sku in self.head_skus:
            if sku not in skus:
                problems.append(f"no item with SKU {sku} (public admission)")
        if self.reentry_sku in skus and (skus[self.reentry_sku][1] or 0) != 0:
            problems.append(f"the re-entry item (SKU {self.reentry_sku}, {skus[self.reentry_sku][0]!r}) is not priced at 0")
        return problems
