"""Split an email body into the new part, the quoted history and the signature.

    result = split_message(body_html, body_text)
    result["new_html"], result["new_text"], result["quoted_html"],
    result["signature_text"], result["confidence"], result["method"]

Pure: no database, no settings, no network. Used by ``mail_ingest`` on every
stored message (``split_version = SPLIT_VERSION``) and by the backfill script.

Rules (docs/research/03-conversations-inbox.md):

* HTML quote boundary, earliest wins: Gmail ``div.gmail_quote`` (also the
  ``x_gmail_quote`` Outlook-web copy), Outlook ``#divRplyFwdMsg`` with its
  ``<hr>``/``appendonsend`` preamble, ``<blockquote type="cite">`` (Apple Mail),
  any ``<blockquote>`` preceded by an attribution line ("On … wrote:",
  "Op … geskryf:", "Am … schrieb:"), a ``-----Original Message-----`` line, or
  a ``From: … Sent: … To: … Subject:`` header block.
* Text quote boundary: the same attribution lines, ``>``-prefixed lines, the
  original-message rule and the header block, whichever comes first.
* Signature (on the new text): a ``--`` line, a "Sent from my iPhone/Samsung/…"
  line, or a sign-off ("Kind regards", "Regards", "Thanks", "Groete", …) with at
  most four short lines after it. The signature is only separated when it can
  be removed from both the text and the HTML, so the two never disagree.
* Unparseable, or a split that would leave nothing new, means everything is
  new (``confidence = "none"``). Nothing is ever discarded: the caller keeps
  ``body_html``/``body_text`` as the original.

HTML returned here is sanitised again: scripts, styles, frames, forms and
event handlers are gone, tracking pixels are dropped and remote ``<img src>``
becomes ``data-src`` so nothing loads until the viewer asks for it.
"""

from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass
from typing import Iterable

import html2text

SPLIT_VERSION = 1

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_NONE = "none"

MAX_SIGNATURE_LINES = 4  # non-blank lines allowed after a sign-off
MAX_SIGNATURE_LINE_CHARS = 80
MAX_SIGNATURE_LINE_WORDS = 7
MAX_DEVICE_SIGNATURE_LINES = 6  # lines allowed after "Sent from my …"
MAX_DASH_SIGNATURE_LINES = 15  # lines allowed after "-- "
ATTRIBUTION_WINDOW = 600  # chars of visible text inspected before a blockquote

# --------------------------------------------------------------- patterns ---

# "On Wed, 7 Oct 2026 at 09:41, Name <a@b.c> wrote:" possibly wrapped over
# lines (never across a blank line). Afrikaans and German variants included.
_ATTRIBUTION_LINE_RE = re.compile(
    r"^[ \t]*(?:On|Op|Am)\b(?:[^\n]|\n(?!\s*\n)){0,300}?\b(?:wrote|geskryf|schrieb)\s*:[ \t]*$",
    re.MULTILINE,
)
# The same thing at the END of a whitespace-collapsed text window.
_ATTRIBUTION_TAIL_RE = re.compile(
    r"(?:(?<=\s)|^)(?:On|Op|Am)\b.{0,300}?\b(?:wrote|geskryf|schrieb)\s*:\s*$",
    re.DOTALL,
)
_ORIGINAL_MESSAGE_RE = re.compile(
    r"^[ \t>]*-{2,}\s*(?:Original (?:Message|Appointment)|Oorspronklike boodskap|"
    r"Ursprüngliche Nachricht)\s*-{2,}[ \t]*$",
    re.MULTILINE | re.IGNORECASE,
)
_ORIGINAL_MESSAGE_INLINE_RE = re.compile(
    r"-{2,}\s*(?:Original (?:Message|Appointment)|Oorspronklike boodskap)\s*-{2,}",
    re.IGNORECASE,
)
_HEADER_FROM_RE = re.compile(r"^[ \t>]*\*?(?:From|Van)\s*:\*?\s*\S", re.MULTILINE | re.IGNORECASE)
_HEADER_SENT_RE = re.compile(r"^[ \t>]*\*?(?:Sent|Date|Gestuur|Datum)\s*:\*?", re.MULTILINE | re.IGNORECASE)
_HEADER_SUBJECT_RE = re.compile(r"^[ \t>]*\*?(?:Subject|Onderwerp)\s*:\*?", re.MULTILINE | re.IGNORECASE)
_HEADER_BLOCK_TEXT_RE = re.compile(
    r"\b(?:From|Van)\s*:\s*\S.{0,300}?\b(?:Sent|Date|Gestuur|Datum)\s*:.{0,300}?\b(?:Subject|Onderwerp)\s*:",
    re.DOTALL | re.IGNORECASE,
)
_SEPARATOR_LINE_RE = re.compile(
    r"^[ \t>]*(?:_{8,}|-{8,}|={8,}|-{3,}\s*(?:Forwarded message|Aangestuurde boodskap)\s*-{3,})[ \t]*$",
    re.IGNORECASE,
)
_QUOTE_LINE_RE = re.compile(r"^[ \t]*>")

_DASH_SIG_RE = re.compile(r"^-- ?$")
_DEVICE_SIG_RE = re.compile(
    r"^[ \t]*(?:Sent|Gestuur) (?:from|vanaf) (?:my |n |'n )?(?:iPhone|iPad|Samsung|Galaxy|Huawei|Android|"
    r"Outlook|Yahoo|BlackBerry|Windows|Mail|Gmail|mobile|phone|device|smartphone|Xiaomi|Oppo|Nokia|"
    r"Honor|Vivo|OnePlus|Telkom|Vodacom|MTN)\b.*$",
    re.IGNORECASE,
)
_SIGNOFF_WORDS = (
    "kind regards", "kindest regards", "kind regard", "warm regards", "warmest regards",
    "best regards", "regards", "best wishes", "with thanks", "many thanks", "thanks again",
    "thanks so much", "thank you so much", "thank you kindly", "thank you", "thanks",
    "thanking you", "cheers", "sincerely", "yours sincerely", "yours faithfully", "yours truly",
    "all the best", "best", "take care", "blessings", "god bless",
    "groete", "vriendelike groete", "beste groete", "baie dankie", "dankie", "liefde groete",
    "met vriendelike groete", "mvg",
)
_SIGNOFF_RE = re.compile(
    r"^[ \t]*[*_]*(?:" + "|".join(re.escape(w) for w in sorted(_SIGNOFF_WORDS, key=len, reverse=True)) + r")"
    r"[*_]*[ \t]*[,.!;:]*[ \t]*(?:\S+(?:[ \t]+\S+)?)?[ \t]*$",
    re.IGNORECASE,
)

_RE_PREFIX_RE = re.compile(r"^\s*(?:(?:re|fw|fwd|aw|wg|tr)\s*:\s*)+", re.IGNORECASE)

# --------------------------------------------------------- html tokeniser ---

_TAG_RE = re.compile(r"<!--.*?-->|<!\[CDATA\[.*?\]\]>|<[^<>]*>", re.DOTALL)
_TAG_NAME_RE = re.compile(r"^<\s*(/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)")
_ATTR_RE = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""")

VOID_TAGS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
     "source", "track", "wbr"}
)
BLOCK_TAGS = frozenset(
    {"address", "article", "aside", "blockquote", "div", "dl", "dd", "dt", "fieldset", "footer",
     "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
     "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"}
)


@dataclass
class Token:
    kind: str  # "open" | "close" | "text" | "comment"
    start: int
    end: int
    name: str = ""
    attrs: dict | None = None
    self_closing: bool = False

    @property
    def is_void(self) -> bool:
        return self.kind == "open" and (self.name in VOID_TAGS or self.self_closing)


def tokenize(html: str) -> list[Token]:
    """Tags and text runs with their offsets into ``html``. Tolerant of junk."""
    tokens: list[Token] = []
    pos = 0
    for m in _TAG_RE.finditer(html):
        if m.start() > pos:
            tokens.append(Token("text", pos, m.start()))
        raw = m.group(0)
        if raw.startswith("<!--") or raw.startswith("<![CDATA["):
            tokens.append(Token("comment", m.start(), m.end()))
        else:
            nm = _TAG_NAME_RE.match(raw)
            if nm is None:
                tokens.append(Token("text", m.start(), m.end()))
            else:
                closing = nm.group(1) == "/"
                name = nm.group(2).lower()
                attrs = None
                if not closing:
                    attrs = {k.lower(): (v1 if v1 is not None else v2 if v2 is not None else v3 or "")
                             for k, v1, v2, v3 in _ATTR_RE.findall(raw)}
                tokens.append(
                    Token("close" if closing else "open", m.start(), m.end(), name, attrs,
                          self_closing=raw.rstrip(">").rstrip().endswith("/"))
                )
        pos = m.end()
    if pos < len(html):
        tokens.append(Token("text", pos, len(html)))
    return tokens


def _classes(tok: Token) -> set[str]:
    return set((tok.attrs or {}).get("class", "").lower().split())


def _attr(tok: Token, name: str) -> str:
    return (tok.attrs or {}).get(name, "")


def _is_whitespace_text(html: str, tok: Token) -> bool:
    return tok.kind == "text" and not html_lib.unescape(html[tok.start:tok.end]).strip()


class _VisibleText:
    """Visible text of a token range with a map back to the owning token."""

    def __init__(self, html: str, tokens: list[Token], start_index: int = 0, end_index: int | None = None):
        self.html = html
        self.tokens = tokens
        parts: list[str] = []
        self.spans: list[tuple[int, int, int]] = []  # (joined_start, joined_end, token_index)
        length = 0
        for i in range(start_index, len(tokens) if end_index is None else end_index):
            tok = tokens[i]
            if tok.kind == "text":
                text = html_lib.unescape(html[tok.start:tok.end])
                text = re.sub(r"[ \t\r\n\xa0  ]+", " ", text)
                if not text:
                    continue
                parts.append(text)
                self.spans.append((length, length + len(text), i))
                length += len(text)
            elif tok.kind in ("open", "close") and (tok.name in BLOCK_TAGS or tok.name == "br"):
                parts.append("\n")
                length += 1
        self.text = "".join(parts)

    def token_at(self, position: int) -> tuple[int, int] | None:
        """(token_index, raw_offset) for a position in ``text``."""
        for js, je, idx in self.spans:
            if js <= position < je:
                tok = self.tokens[idx]
                raw = self.html[tok.start:tok.end]
                probe = self.text[position:position + 24]
                probe = probe.split("\n")[0].strip()
                offset = tok.start
                if probe:
                    found = raw.find(probe[:12])
                    if found >= 0:
                        offset = tok.start + found
                    else:
                        # The raw node may hold entities; retry on a coarser prefix.
                        found = raw.lower().find(probe[:4].lower())
                        if found >= 0:
                            offset = tok.start + found
                return idx, offset
        return None


def _open_stack_at(tokens: Iterable[Token], cut: int) -> list[str]:
    stack: list[str] = []
    for tok in tokens:
        if tok.start >= cut:
            break
        if tok.kind == "open" and not tok.is_void:
            stack.append(tok.name)
        elif tok.kind == "close":
            for i in range(len(stack) - 1, -1, -1):
                if stack[i] == tok.name:
                    del stack[i:]
                    break
    return stack


_TRAILING_EMPTY_RE = re.compile(
    r"(?:\s|&nbsp;|<br\s*/?>|<div[^>]*>\s*(?:<br\s*/?>|&nbsp;)?\s*</div>|<p[^>]*>\s*(?:<br\s*/?>|&nbsp;)?\s*</p>)+$",
    re.IGNORECASE,
)


_LEADING_BREAKS_RE = re.compile(r"^(?:\s|<br\s*/?>)+", re.IGNORECASE)


def _strip_trailing_empty(fragment: str) -> str:
    previous = None
    while previous != fragment:
        previous = fragment
        fragment = _TRAILING_EMPTY_RE.sub("", fragment)
    return fragment


def _cut_html(html: str, tokens: list[Token], cut: int) -> tuple[str, str]:
    """(before, after) at ``cut`` with the open elements closed in ``before``
    and their stray closers trimmed from ``after``."""
    stack = _open_stack_at(tokens, cut)
    before = _strip_trailing_empty(html[:cut]) + "".join(f"</{name}>" for name in reversed(stack))
    after = _LEADING_BREAKS_RE.sub("", html[cut:]).strip()
    for name in stack:
        closer = f"</{name}>"
        stripped = after.rstrip()
        if stripped.lower().endswith(closer):
            after = stripped[: -len(closer)].rstrip()
    return before, after


def _extend_back_over_separators(html: str, tokens: list[Token], index: int) -> int:
    """Move a cut index back over whitespace, <br>, <hr> and Outlook's empty
    ``appendonsend`` div so the separator goes with the quote."""
    i = index
    while i > 0:
        prev = tokens[i - 1]
        if _is_whitespace_text(html, prev):
            i -= 1
            continue
        if prev.kind == "open" and prev.name in ("br", "hr"):
            i -= 1
            continue
        if prev.kind == "close" and prev.name == "div" and i >= 2:
            opener = tokens[i - 2]
            if opener.kind == "open" and opener.name == "div" and "appendonsend" in _attr(opener, "id").lower():
                i -= 2
                continue
        break
    return i


def _enclosing_block_start(html: str, tokens: list[Token], text_index: int, until_index: int, needle: str) -> int:
    """Start offset of the block element that holds only the attribution text
    (``needle``), else the text token itself."""
    tok = tokens[text_index]
    j = text_index - 1
    while j >= 0 and tokens[j].kind in ("open", "close") and tokens[j].name in ("span", "font", "b", "i", "em", "strong", "u"):
        if tokens[j].kind == "close":
            break
        j -= 1
    if j >= 0 and tokens[j].kind == "open" and tokens[j].name in ("div", "p", "td", "li"):
        visible = _VisibleText(html, tokens, j, until_index).text
        collapsed = re.sub(r"\s+", " ", visible).strip()
        if len(collapsed) <= len(needle) + 40 and collapsed.lower().endswith(needle.lower()[-40:]):
            return tokens[j].start
    return tok.start


def _find_html_cut(html: str, tokens: list[Token]) -> tuple[int, str, str] | None:
    """(offset, confidence, method) of the earliest quote boundary, or None."""
    candidates: list[tuple[int, str, str]] = []
    seen_methods: set[str] = set()

    def add(offset: int, confidence: str, method: str) -> None:
        if method in seen_methods:
            return
        seen_methods.add(method)
        candidates.append((offset, confidence, method))

    for i, tok in enumerate(tokens):
        if tok.kind == "open":
            classes = _classes(tok)
            ident = _attr(tok, "id").lower()
            if tok.name == "div" and classes & {"gmail_quote", "x_gmail_quote", "gmail_quote_container", "x_gmail_quote_container"}:
                j = _extend_back_over_separators(html, tokens, i)
                add(tokens[j].start, CONFIDENCE_HIGH, "gmail_quote")
            elif tok.name == "div" and "divrplyfwdmsg" in ident:
                j = _extend_back_over_separators(html, tokens, i)
                add(tokens[j].start, CONFIDENCE_HIGH, "outlook_reply_header")
            elif tok.name == "blockquote":
                window = _VisibleText(html, tokens, 0, i)
                tail = window.text[-ATTRIBUTION_WINDOW:]
                tail_collapsed = re.sub(r"\s+", " ", tail)
                m = _ATTRIBUTION_TAIL_RE.search(tail_collapsed)
                if m:
                    # Map the collapsed match start back to a position in the raw window text.
                    needle = m.group(0).strip()
                    target = _locate_collapsed(window.text, tail_collapsed, m.start(), len(window.text) - len(tail))
                    hit = window.token_at(target) if target is not None else None
                    if hit:
                        idx, _offset = hit
                        start = _enclosing_block_start(html, tokens, idx, i, needle[:60])
                        k = next((n for n, t in enumerate(tokens) if t.start >= start), idx)
                        k = _extend_back_over_separators(html, tokens, k)
                        add(tokens[k].start, CONFIDENCE_HIGH, "attribution_blockquote")
                        continue
                if _attr(tok, "type").lower() == "cite" or classes & {"gmail_quote", "x_gmail_quote"}:
                    j = _extend_back_over_separators(html, tokens, i)
                    add(tokens[j].start, CONFIDENCE_HIGH, "blockquote_cite")
        elif tok.kind == "text":
            raw = html[tok.start:tok.end]
            m = _ORIGINAL_MESSAGE_INLINE_RE.search(html_lib.unescape(raw))
            if m:
                found = raw.find("--")
                start_index = i
                if found >= 0 and not raw[:found].strip():
                    start_index = _extend_back_over_separators(html, tokens, i)
                    add(tokens[start_index].start, CONFIDENCE_HIGH, "original_message")
                else:
                    add(tok.start + max(found, 0), CONFIDENCE_HIGH, "original_message")

    header = _find_header_block(html, tokens)
    if header is not None:
        add(header, CONFIDENCE_HIGH, "header_block")

    if not candidates:
        return None
    return min(candidates, key=lambda c: c[0])


def _locate_collapsed(text: str, collapsed: str, collapsed_pos: int, base: int) -> int | None:
    """Translate a position in a whitespace-collapsed window back to the raw window."""
    # Walk both strings in step: every run of whitespace in ``text`` is one space in ``collapsed``.
    i = base
    j = 0
    n = len(text)
    while i < n and j < collapsed_pos:
        if text[i].isspace():
            while i < n and text[i].isspace():
                i += 1
            j += 1
        else:
            i += 1
            j += 1
    return i if i <= n else None


def _find_header_block(html: str, tokens: list[Token]) -> int | None:
    """A 'From: … Sent: … To: … Subject:' block in the visible text (Outlook
    without the divRplyFwdMsg id, forwarded headers in plain divs)."""
    window = _VisibleText(html, tokens)
    m = _HEADER_BLOCK_TEXT_RE.search(window.text)
    if m is None:
        return None
    # Must start at a line start (or the very beginning), not inside a sentence.
    line_start = window.text.rfind("\n", 0, m.start()) + 1
    if window.text[line_start:m.start()].strip():
        return None
    hit = window.token_at(m.start())
    if hit is None:
        return None
    idx, offset = hit
    start = _enclosing_block_start(html, tokens, idx, idx + 1, "From:")
    k = next((n for n, t in enumerate(tokens) if t.start >= min(start, offset)), idx)
    k = _extend_back_over_separators(html, tokens, k)
    return tokens[k].start


# ----------------------------------------------------------- text splitting ---


def _normalise_text(text: str | None) -> str:
    if not text:
        return ""
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("﻿", "")


def _find_text_cut(text: str) -> tuple[int, str, str] | None:
    """(char offset, confidence, method) of the first quote marker in ``text``."""
    candidates: list[tuple[int, str, str]] = []
    m = _ATTRIBUTION_LINE_RE.search(text)
    if m:
        candidates.append((m.start(), CONFIDENCE_HIGH, "attribution"))
    m = _ORIGINAL_MESSAGE_RE.search(text)
    if m:
        candidates.append((m.start(), CONFIDENCE_HIGH, "original_message"))
    m = _HEADER_FROM_RE.search(text)
    while m:
        after = text[m.start(): m.start() + 800]
        sent = _HEADER_SENT_RE.search(after)
        subject = _HEADER_SUBJECT_RE.search(after)
        if sent and subject and sent.start() < subject.start():
            candidates.append((m.start(), CONFIDENCE_HIGH, "header_block"))
            break
        m = _HEADER_FROM_RE.search(text, m.end())
    for line_match in re.finditer(r"^.*$", text, re.MULTILINE):
        if _QUOTE_LINE_RE.match(line_match.group(0)):
            candidates.append((line_match.start(), CONFIDENCE_MEDIUM, "quote_lines"))
            break
    if not candidates:
        return None
    offset, confidence, method = min(candidates, key=lambda c: c[0])
    # Pull a separator line or wrapped attribution sitting just above into the quote.
    offset = _extend_text_cut_back(text, offset)
    return offset, confidence, method


def _extend_text_cut_back(text: str, offset: int) -> int:
    lines_before = text[:offset].split("\n")
    # lines_before[-1] is the (empty) remainder of the cut line's own start.
    i = len(lines_before) - 1
    moved = offset
    # Skip blank lines, then absorb a separator or attribution line directly above.
    j = i - 1
    while j >= 0 and not lines_before[j].strip():
        j -= 1
    if j >= 0:
        line = lines_before[j]
        if _SEPARATOR_LINE_RE.match(line):
            moved = sum(len(l) + 1 for l in lines_before[:j])
        else:
            # An attribution wrapped over up to three lines ending right above the quote.
            block_start = max(0, j - 2)
            for k in range(j, block_start - 1, -1):
                chunk = "\n".join(lines_before[k: j + 1])
                if _ATTRIBUTION_LINE_RE.fullmatch(chunk) or _ATTRIBUTION_LINE_RE.match(chunk):
                    moved = sum(len(l) + 1 for l in lines_before[:k])
                    break
    return min(offset, moved)


# ------------------------------------------------------------- signature ---


def _signature_like(line: str) -> bool:
    stripped = line.strip()
    return len(stripped) <= MAX_SIGNATURE_LINE_CHARS and len(stripped.split()) <= MAX_SIGNATURE_LINE_WORDS


def find_signature_start(
    lines: list[str], max_lines: int = MAX_SIGNATURE_LINES, strict_lines: bool = True
) -> int | None:
    """Index of the first signature line in ``lines`` or None.

    A ``--`` line or a "Sent from my …" line marks the signature; a sign-off
    with at most ``max_lines`` lines after it (up to that marker, or the end)
    extends the signature upwards. With ``strict_lines`` those lines must look
    like signature lines (short, few words); our own templates turn that off
    because their footer carries a full sentence. Something must remain above.
    """
    last = len(lines)
    while last > 0 and not lines[last - 1].strip():
        last -= 1
    if last == 0:
        return None
    body = lines[:last]
    start: int | None = None
    for i, line in enumerate(body):
        if _DASH_SIG_RE.match(line) and len(body) - i - 1 <= MAX_DASH_SIGNATURE_LINES:
            start = i
            break
    if start is None:
        for i in range(len(body) - 1, -1, -1):
            if _DEVICE_SIG_RE.match(body[i]) and len(body) - i - 1 <= MAX_DEVICE_SIGNATURE_LINES:
                start = i
                break
    limit = start if start is not None else len(body)
    for i in range(limit - 1, -1, -1):
        if not _SIGNOFF_RE.match(body[i]):
            continue
        following = [l for l in body[i + 1:limit] if l.strip()]
        if len(following) > max_lines or limit - i - 1 > max_lines * 2 + 1:
            continue
        if strict_lines and not all(_signature_like(l) for l in following):
            continue
        start = i
        break
    if start is None or not any(l.strip() for l in body[:start]):
        return None
    return start


def _split_signature_text(
    text: str, max_lines: int = MAX_SIGNATURE_LINES, strict_lines: bool = True
) -> tuple[str, str | None]:
    lines = text.split("\n")
    start = find_signature_start(lines, max_lines, strict_lines)
    if start is None:
        return text.rstrip(), None
    return "\n".join(lines[:start]).rstrip(), "\n".join(lines[start:]).strip() or None


def _normalise_for_search(value: str) -> str:
    value = re.sub(r"[*_`]+", "", value)
    return re.sub(r"\s+", " ", value).strip().lower()


def _cut_html_at_signature(html: str, signature_text: str) -> str | None:
    """Remove the signature from ``html`` by locating its first line. None if
    it cannot be found (the caller then keeps the signature everywhere)."""
    first_line = next((l for l in signature_text.split("\n") if l.strip()), "")
    needle = _normalise_for_search(first_line)[:40]
    if len(needle) < 2:
        return None
    tokens = tokenize(html)
    window = _VisibleText(html, tokens)
    haystack = _normalise_for_search(window.text)
    # The normalisation collapses whitespace the same way, but positions differ:
    # search in the raw visible text with a whitespace-tolerant regex instead.
    pattern = re.compile(r"[*_`]*" + r"\s*".join(re.escape(ch) for ch in needle.replace(" ", "")), re.IGNORECASE)
    if needle not in haystack:
        return None
    last = None
    for m in pattern.finditer(window.text):
        last = m
    if last is None:
        return None
    hit = window.token_at(last.start())
    if hit is None:
        return None
    idx, offset = hit
    start = _enclosing_block_start(html, tokens, idx, idx + 1, first_line.strip()[:60])
    cut = min(start, offset)
    before, _after = _cut_html(html, tokens, cut)
    if not _VisibleText(before, tokenize(before)).text.strip():
        return None
    return before


# --------------------------------------------------------------- sanitise ---

_STRIP_BLOCK_RE = re.compile(
    r"<(script|style|head|title|iframe|object|embed|noscript|svg|math)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_STRIP_TAG_RE = re.compile(
    r"</?(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|option|"
    r"html|body|!doctype|frame|frameset|applet)\b[^>]*>",
    re.IGNORECASE,
)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_EVENT_ATTR_RE = re.compile(r"""\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
_JS_URL_RE = re.compile(r"""(href|src|action|xlink:href)\s*=\s*(["']?)\s*(?:javascript|vbscript|data:text/html)[^"'>\s]*""", re.IGNORECASE)
_IMG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_SRC_RE = re.compile(r"""\s(src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.IGNORECASE)
_PIXEL_DIM_RE = re.compile(r"""\b(?:width|height)\s*=\s*["']?\s*[01]\s*(?:px)?\s*["']?""", re.IGNORECASE)
_PIXEL_STYLE_RE = re.compile(r"""(?:width|height)\s*:\s*[01](?:px)?\b""", re.IGNORECASE)
_HIDDEN_STYLE_RE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.IGNORECASE)


def _sanitise_img(tag: str, allowed_prefixes: tuple[str, ...]) -> str:
    style = re.search(r"""\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')""", tag, re.IGNORECASE)
    style_value = (style.group(1) or style.group(2) or "") if style else ""
    if len(_PIXEL_DIM_RE.findall(tag)) >= 1 and (len(_PIXEL_DIM_RE.findall(tag)) >= 2 or _PIXEL_STYLE_RE.search(style_value)):
        return ""
    if len(_PIXEL_STYLE_RE.findall(style_value)) >= 2 or _HIDDEN_STYLE_RE.search(style_value):
        return ""

    def _replace(m: re.Match) -> str:
        value = m.group(2) if m.group(2) is not None else m.group(3) if m.group(3) is not None else m.group(4) or ""
        lowered = value.strip().lower()
        if lowered.startswith("data:image/") or lowered.startswith("cid:"):
            return m.group(0)
        if any(lowered.startswith(p.lower()) for p in allowed_prefixes if p):
            return m.group(0)
        return f' data-src="{html_lib.escape(value.strip(), quote=True)}"'

    return _SRC_RE.sub(_replace, tag)


def sanitise_html(
    html: str | None,
    block_remote_images: bool = True,
    allowed_image_prefixes: tuple[str, ...] = (),
) -> str | None:
    """Scripts, styles, frames, forms and handlers out; tracking pixels dropped;
    remote images parked in ``data-src`` unless their URL has an allowed prefix."""
    if not html:
        return None
    out = _COMMENT_RE.sub("", html)
    out = _STRIP_BLOCK_RE.sub("", out)
    out = _STRIP_TAG_RE.sub("", out)
    out = _EVENT_ATTR_RE.sub("", out)
    out = _JS_URL_RE.sub(r"\1=\2#", out)
    if block_remote_images:
        out = _IMG_RE.sub(lambda m: _sanitise_img(m.group(0), allowed_image_prefixes), out)
    out = out.strip()
    return out or None


# ------------------------------------------------------------ text helpers ---


def html_to_text(html: str | None) -> str:
    if not html:
        return ""
    h = html2text.HTML2Text()
    h.body_width = 0
    h.ignore_images = True
    h.ignore_emphasis = True
    h.ignore_tables = False
    h.single_line_break = True
    try:
        text = h.handle(html)
    except Exception:  # noqa: BLE001
        text = re.sub(r"<[^>]+>", " ", html)
    text = text.replace("\xa0", " ")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def visible_text(html: str | None) -> str:
    """Tag-free text (for emptiness checks and counts)."""
    if not html:
        return ""
    return _VisibleText(html, tokenize(html)).text


def count_lines(text: str | None) -> int:
    return sum(1 for line in _normalise_text(text).split("\n") if line.strip())


def strip_reply_prefixes(subject: str | None) -> str:
    return _RE_PREFIX_RE.sub("", subject or "").strip()


# ----------------------------------------------------------------- entry ---


def split_message(
    body_html: str | None,
    body_text: str | None,
    allowed_image_prefixes: tuple[str, ...] = (),
    max_signature_lines: int = MAX_SIGNATURE_LINES,
    drop_leading_lines: tuple[str, ...] = (),
    strict_signature_lines: bool = True,
) -> dict:
    """Split one message. See the module docstring for the rules.

    ``max_signature_lines`` relaxes the sign-off rule (our own templates end
    with a signature plus a company footer); ``drop_leading_lines`` removes a
    leading text line equal to one of the given values (a template's wordmark).

    Returns ``{"new_html", "new_text", "quoted_html", "quoted_text",
    "signature_text", "confidence", "method", "split_version"}``.
    ``quoted_text`` is informational (not stored).
    """
    html = sanitise_html(body_html, allowed_image_prefixes=allowed_image_prefixes)
    text = _normalise_text(body_text)
    if not text and html:
        text = html_to_text(html)

    new_html: str | None = html
    quoted_html: str | None = None
    new_text = text
    quoted_text: str | None = None
    confidence = CONFIDENCE_NONE
    method: str | None = None

    text_cut = _find_text_cut(text) if text else None
    html_cut = None
    tokens: list[Token] = []
    if html:
        tokens = tokenize(html)
        html_cut = _find_html_cut(html, tokens)
        if html_cut is None and text_cut is not None:
            html_cut = _locate_text_cut_in_html(html, tokens, text[text_cut[0]:])

    if html and html_cut is not None:
        before, after = _cut_html(html, tokens, html_cut[0])
        if visible_text(before).strip() and after.strip():
            new_html, quoted_html = before, after
            confidence, method = html_cut[1], html_cut[2]
            if text_cut is not None and text[: text_cut[0]].strip():
                new_text, quoted_text = text[: text_cut[0]].rstrip(), text[text_cut[0]:].strip() or None
            else:
                new_text = html_to_text(new_html)
                quoted_text = html_to_text(quoted_html) or None
        elif text_cut is not None and text[: text_cut[0]].strip():
            # The HTML would be emptied by the cut; keep it whole but trim the text.
            new_text, quoted_text = text[: text_cut[0]].rstrip(), text[text_cut[0]:].strip() or None
            confidence, method = CONFIDENCE_MEDIUM, text_cut[2]
    elif text_cut is not None and text[: text_cut[0]].strip():
        new_text, quoted_text = text[: text_cut[0]].rstrip(), text[text_cut[0]:].strip() or None
        confidence, method = (CONFIDENCE_MEDIUM if html else text_cut[1]), text_cut[2]

    if drop_leading_lines and new_text:
        wanted = {w.strip().lower() for w in drop_leading_lines if w and w.strip()}
        lines = new_text.lstrip("\n").split("\n")
        while lines and lines[0].strip().lower() in wanted:
            lines.pop(0)
        new_text = "\n".join(lines).lstrip("\n")

    signature_text: str | None = None
    trimmed_text, signature = _split_signature_text(new_text, max_signature_lines, strict_signature_lines)
    if signature and trimmed_text.strip():
        if new_html:
            cut_html = _cut_html_at_signature(new_html, signature)
            if cut_html is not None:
                new_html = cut_html
                new_text, signature_text = trimmed_text, signature
        else:
            new_text, signature_text = trimmed_text, signature

    return {
        "new_html": new_html,
        "new_text": new_text.strip() if new_text else (new_text or ""),
        "quoted_html": quoted_html,
        "quoted_text": quoted_text,
        "signature_text": signature_text,
        "confidence": confidence,
        "method": method,
        "split_version": SPLIT_VERSION,
    }


def _locate_text_cut_in_html(html: str, tokens: list[Token], quoted_text: str) -> tuple[int, str, str] | None:
    """When only the text version shows a quote, find its first line in the
    HTML's visible text and cut there (medium confidence)."""
    first_line = next((l for l in quoted_text.split("\n") if l.strip()), "")
    first_line = re.sub(r"^[>\s]+", "", first_line)
    needle = _normalise_for_search(first_line)
    if len(needle) < 8:
        return None
    window = _VisibleText(html, tokens)
    haystack_norm = _normalise_for_search(window.text)
    probe = needle[:40]
    if probe not in haystack_norm:
        return None
    pattern = re.compile(r"\s*".join(re.escape(ch) for ch in probe.replace(" ", "")), re.IGNORECASE)
    m = pattern.search(window.text)
    if m is None:
        return None
    hit = window.token_at(m.start())
    if hit is None:
        return None
    idx, offset = hit
    start = _enclosing_block_start(html, tokens, idx, idx + 1, first_line.strip()[:60])
    k = next((n for n, t in enumerate(tokens) if t.start >= min(start, offset)), idx)
    k = _extend_back_over_separators(html, tokens, k)
    return tokens[k].start, CONFIDENCE_MEDIUM, "text_located"


__all__ = [
    "SPLIT_VERSION",
    "split_message",
    "sanitise_html",
    "html_to_text",
    "visible_text",
    "count_lines",
    "strip_reply_prefixes",
    "find_signature_start",
    "tokenize",
]
