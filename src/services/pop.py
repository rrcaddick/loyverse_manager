"""Proof of payment on customer mail.

Every genuine attachment on a booking's mail is kept as a document on the
booking. A readable bank PDF is parsed (bank, amount, reference, date) and
the matching credit proposed or allocated; an image or an unreadable scan,
or a mail whose words say "paid", raises a "proof of payment to verify"
action with the search pre-filled. Signature logos and inline images are
never treated as attachments.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from config.settings import DATA_DIR
from src.models import document as document_model
from src.models import email_message as em
from src.models import pop as pop_model
from src.models.base import execute
from src.services import payment_search
from src.utils.logging import setup_logger

logger = setup_logger("pop")

BANK_RE = re.compile(
    r"\b(FNB|First National Bank|ABSA|Capitec|Standard Bank|Nedbank|TymeBank|Tyme Bank|Discovery Bank|"
    r"African Bank|Investec|Bidvest Bank|Old Mutual)\b",
    re.IGNORECASE,
)
POP_WORDS_RE = re.compile(
    r"(proof of payment|payment (?:notification|confirmation|advice|made|sent)|\bpop\b|\bpaid\b|\beft\b|"
    r"transfer(?:red)?\b|deposit(?:ed)?\b|\bremittance\b|payment has been|has been paid)",
    re.IGNORECASE,
)
AMOUNT_RE = re.compile(r"(?:ZAR|R)\s?(\d{1,3}(?:[ ,]\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)(?!\d)")
AMOUNT_LABEL_RE = re.compile(r"amount[^\n\d]{0,20}(?:ZAR|R)?\s?(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)", re.IGNORECASE)
REF_RE = re.compile(
    r"(?:beneficiary|recipient|their|payment|your|my|own|statement)?\s*(?:reference|ref\.?|description)\s*[:\-]?\s*([^\n]{2,60})",
    re.IGNORECASE,
)
DATE_RE = re.compile(r"\b(\d{1,2}[/\-. ]\d{1,2}[/\-. ]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b")
GENUINE_MIN_BYTES = 12 * 1024
IMAGE_TYPES = ("image/jpeg", "image/png", "image/heic", "image/webp", "image/gif")


def is_genuine(att: dict) -> bool:
    """A real attachment, not a signature logo or an inline picture."""
    ctype = (att.get("content_type") or "").lower()
    size = int(att.get("size") or att.get("size_bytes") or 0)
    if att.get("inline"):
        return False
    if ctype == "application/pdf" or (att.get("filename") or "").lower().endswith(".pdf"):
        return True
    if ctype.startswith("image/"):
        return size >= GENUINE_MIN_BYTES
    return False


def _amount(text: str) -> Decimal | None:
    m = AMOUNT_LABEL_RE.search(text)
    candidates: list[Decimal] = []
    if m:
        try:
            candidates.append(Decimal(m.group(1).replace(" ", "").replace(",", "")))
        except Exception:  # noqa: BLE001
            pass
    for m in AMOUNT_RE.finditer(text):
        try:
            candidates.append(Decimal(m.group(1).replace(" ", "").replace(",", "")))
        except Exception:  # noqa: BLE001
            continue
    candidates = [c for c in candidates if 10 <= c <= 500_000]
    if not candidates:
        return None
    return candidates[0]


def _paid_on(text: str) -> date | None:
    from dateutil import parser as dateparser

    for m in DATE_RE.finditer(text):
        try:
            d = dateparser.parse(m.group(1), dayfirst=True, fuzzy=False)
        except Exception:  # noqa: BLE001
            continue
        if d and 2024 <= d.year <= 2030:
            return d.date()
    return None


def parse_pop_text(text: str | None) -> dict:
    """{bank, amount, reference, paid_on, is_pop} from the text of a PDF or body."""
    t = text or ""
    bank = BANK_RE.search(t)
    ref = None
    for m in REF_RE.finditer(t):
        value = m.group(1).strip(" :-\t")
        if value and not value.lower().startswith(("number", "no.")):
            ref = value[:120]
            break
    amount = _amount(t)
    out = {
        "bank": bank.group(1) if bank else None,
        "amount": amount,
        "reference": ref,
        "paid_on": _paid_on(t),
        "signal": bool(POP_WORDS_RE.search(t)),
    }
    out["is_pop"] = bool(bank and amount) or (out["signal"] and amount is not None)
    return out


def pdf_text(path: Path, pages: int = 2) -> str:
    try:
        import fitz  # PyMuPDF

        with fitz.open(str(path)) as doc:
            return "\n".join(doc[i].get_text() for i in range(min(pages, doc.page_count)))
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"PDF text failed for {path}: {exc}")
        return ""


def _store_document(booking_id: int, message_id: int, att: dict, kind: str) -> int:
    doc_id = document_model.insert(
        int(booking_id), kind, f"ATT{int(att['id'])}", 1, att["file_path"], Decimal(0), Decimal(0), Decimal(0),
        {"filename": att.get("filename"), "content_type": att.get("content_type"), "size": att.get("size_bytes")}, None,
    )
    execute(
        "UPDATE documents SET title = %s, email_message_id = %s, attachment_id = %s WHERE id = %s",
        ((att.get("filename") or "")[:255], int(message_id), int(att["id"]), doc_id),
    )
    return doc_id


def inspect_message(message_id: int, booking_id: int | None, *, auto_allocate: bool = True) -> dict:
    """Look at a stored message's attachments and words for proof of payment.
    Returns {candidates: [...], documents: n}. Safe to call twice."""
    msg = em.get(int(message_id))
    if msg is None or msg.get("direction") != "inbound":
        return {"candidates": [], "documents": 0}
    body = msg.get("body_new_text") or msg.get("body_text") or ""
    body_parse = parse_pop_text(f"{msg.get('subject') or ''}\n{body}")
    attachments = [a for a in em.list_attachments(int(message_id)) if is_genuine(a)]
    out: list[int] = []
    documents = 0
    for att in attachments:
        path = DATA_DIR / att["file_path"]
        parsed = {"is_pop": False, "signal": False}
        if (att.get("content_type") or "").lower() == "application/pdf" or str(att.get("filename", "")).lower().endswith(".pdf"):
            parsed = parse_pop_text(pdf_text(path)) if path.exists() else parsed
        is_pop = bool(parsed.get("is_pop")) or (body_parse["signal"] and (parsed.get("amount") or att.get("content_type", "").startswith("image/")))
        if booking_id:
            doc_id = _store_document(int(booking_id), int(message_id), att, "pop" if is_pop else "attachment")
            documents += 1
        else:
            doc_id = None
        if not is_pop and not body_parse["signal"]:
            continue
        cid = pop_model.insert(
            booking_id, int(message_id), int(att["id"]), doc_id,
            parsed=bool(parsed.get("is_pop")), text_signal=bool(body_parse["signal"]),
            bank_name=parsed.get("bank") or body_parse.get("bank"), reference=parsed.get("reference") or body_parse.get("reference"),
            amount=parsed.get("amount") or body_parse.get("amount"), paid_on=parsed.get("paid_on") or body_parse.get("paid_on"),
        )
        out.append(cid)
    if not attachments and body_parse["signal"] and booking_id and (body_parse.get("amount") or body_parse.get("reference")):
        out.append(
            pop_model.insert(
                booking_id, int(message_id), None, None, parsed=False, text_signal=True,
                bank_name=body_parse.get("bank"), reference=body_parse.get("reference"),
                amount=body_parse.get("amount"), paid_on=body_parse.get("paid_on"),
            )
        )
    if auto_allocate and booking_id:
        for cid in out:
            try_auto_allocate(cid)
    return {"candidates": out, "documents": documents}


def try_auto_allocate(candidate_id: int) -> dict | None:
    """Allocate when one credit matches the parsed amount and the booking's
    reference or the POP's reference; otherwise leave it pending."""
    cand = pop_model.get(int(candidate_id))
    if not cand or cand["status"] != "pending" or not cand.get("booking_id") or not cand.get("amount"):
        return None
    booking = em.booking_by_id(int(cand["booking_id"]))
    if not booking:
        return None
    found = payment_search.search(booking, amount=cand["amount"], reference=cand.get("reference"))
    hits = [
        r for r in found["items"]
        if r.get("match_status") in ("unmatched", "suggested")
        and any(w.startswith("amount") for w in r["why"])
        and any(w.startswith(("booking reference", "reference", "group name")) for w in r["why"])
    ]
    if len(hits) != 1:
        return None
    result = payment_search.allocate(int(hits[0]["id"]), int(booking["id"]), None, method="pop")
    pop_model.set_status(int(candidate_id), "allocated", None, bank_transaction_id=int(hits[0]["id"]),
                         payment_id=(result.get("payment") or {}).get("id") if isinstance(result, dict) else None)
    return result


def allocate(candidate_id: int, tx_id: int, actor: int | None) -> dict:
    cand = pop_model.get(int(candidate_id))
    if not cand or not cand.get("booking_id"):
        raise ValueError("Proof of payment not found or not on a booking")
    result = payment_search.allocate(int(tx_id), int(cand["booking_id"]), actor, method="pop")
    pop_model.set_status(int(candidate_id), "allocated", actor, bank_transaction_id=int(tx_id),
                         payment_id=(result.get("payment") or {}).get("id") if isinstance(result, dict) else None)
    return result


def dismiss(candidate_id: int, actor: int | None) -> None:
    pop_model.set_status(int(candidate_id), "dismissed", actor)


def serialize(row: dict) -> dict:
    out = dict(row)
    for k in ("amount",):
        if out.get(k) is not None:
            out[k] = float(out[k])
    for k in ("paid_on", "resolved_at", "created_at", "visit_date"):
        if isinstance(out.get(k), (date, datetime)):
            out[k] = out[k].isoformat()
    return out
