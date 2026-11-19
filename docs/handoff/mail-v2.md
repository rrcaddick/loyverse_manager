# Mail v2 — conversations, quote splitting, work views

Backend for the redesigned inbox (`docs/research/03-conversations-inbox.md`). It
sits on top of the first build (`docs/handoff/mail.md`, still valid for the
per-message endpoints the current UI uses) and adds a conversation layer:
one row per Gmail thread, work queues over conversations, clean message bodies
with the quoted history and signature split off at ingest, notes on threads,
and a stream that merges mail, notes and booking events.

Owner of (in addition to the mail.md list): `src/services/quote_split.py`,
`src/services/conversations.py`, `src/models/email_thread.py`,
`scripts/backfill_conversations.py`, `tests/mail/test_quote_split.py`,
`tests/mail/test_threads.py`, `tests/mail/test_conversations_db.py`.

```
PYTHONPATH=. .venv/bin/python -m pytest tests/mail -q      # 95 tests; the 4 DB tests skip without MySQL
.venv/bin/python -m scripts.backfill_conversations         # idempotent; --force re-splits everything
```

## What changed, in one screen

- **`quote_split.split_message(body_html, body_text)`** — pure. Returns
  `new_html`, `new_text`, `quoted_html`, `quoted_text` (not stored),
  `signature_text`, `confidence` (`high` | `medium` | `none`), `method`,
  `split_version`. Rules: Gmail `div.gmail_quote` (and Outlook-web's
  `x_gmail_quote`), Outlook `#divRplyFwdMsg` with its `<hr>`/`appendonsend`
  preamble, `<blockquote type="cite">` (Apple Mail), any `blockquote` preceded
  by "On … wrote:" / "Op … geskryf:" / "Am … schrieb:", `-----Original
  Message-----`, a `From: … Sent: … To: … Subject:` header block; in text the
  same attributions, `>` lines, and a `________` separator or Gmail's
  "---------- Forwarded message ---------" line directly above the quote.
  Signature: `--`, "Sent from my iPhone/Samsung/Galaxy/Huawei/…", or a
  sign-off (Kind regards, Regards, Thanks, Thank you, Many thanks, Groete,
  Vriendelike groete, Dankie, …) with at most four short lines after it;
  a sign-off above a device line is chained into one signature. The
  signature is only split when it can be removed from **both** the text and
  the HTML, so the two never disagree. A split that would leave nothing new
  (bottom-posted or quote-only mail) fails open: everything is new,
  `confidence = "none"`. HTML out of the splitter is sanitised again:
  scripts/styles/frames/forms/handlers gone, 1×1 and hidden images dropped,
  remote `<img src>` moved to `data-src` (our own `PUBLIC_BASE_URL` images
  keep `src`).
- **Every message is split at ingest** (`mail_ingest.build_row`,
  `split_version = 1`) and when we send (`mail_send.send_email`, which uses
  `own_template=True`: looser signature cap so the company footer goes with
  the signature, and the text version's leading wordmark line is dropped).
  `email_messages.snippet` is now the new text, not the whole body.
- **`email_threads`** is derived from `email_messages` by
  `conversations.refresh_thread(thrid)` after every insert/claim/send/link/
  unlink; `scripts/backfill_conversations.py` builds it from scratch.
  Operator state (`status`, `done_at/by`, `not_booking`) survives refreshes;
  a counting inbound message newer than `done_at` reopens the thread.
- **Linking is thread-wide.** `conversations.attach` links every message
  and the thread row and sets `bookings.email_thread_id` when empty; the
  automatic matcher (`apply_match`) now also pulls a matched message's
  unlinked siblings into the booking (`match_method = thread`). The legacy
  per-message attach/detach keep working and refresh the thread too.
- **Legacy flags stay in step:** done → pending reviews become `resolved`;
  not-booking → inbound rows `not_booking`; attach → `resolved`; detach →
  inbound back to `pending`. `GET /inbox/messages` and the old counts are
  unchanged.
- **`web/api/inbox.py`** now registers its blueprint with no prefix and
  writes `/inbox/...` on every rule, so `GET /bookings/:id/conversation` is
  served from the same module (nothing in `web/app.py` changed).

## `email_threads` semantics

| column | meaning |
| --- | --- |
| `booking_id` | newest linked message's booking, else a booking whose `email_thread_id` is this thread; kept when a refresh finds no linked message |
| `status` / `done_at` / `done_by` | `open` or `done`; "Done" leaves every queue |
| `not_booking` | triage flag; setting it also marks the thread done. A later inbound reopens the thread but keeps the flag |
| `subject` | first message's subject with `Re:`/`Fwd:` stripped |
| `counterpart_name/email` | first inbound sender that is not us (non-automated preferred); outbound-only threads use the first recipient, and the booking contact name when the address matches |
| `message_count`, `last_message_at`, `last_snippet` | over all messages; the snippet is the newest message's **new** text, `"You: "` prefixed when ours |
| `last_direction` | direction of the newest **counting** message: not automated, not a failed send. When every message is automated, the newest one |
| `last_inbound_at` / `last_outbound_at` | newest non-automated inbound / newest successful outbound |
| `has_automated_only` | every message is automated (bank alerts, notifications); never enters a queue |

Views (`src/models/email_thread.py:_VIEW_WHERE`):

| view | predicate |
| --- | --- |
| `needs_reply` | open, `last_direction = inbound`, not automated-only |
| `unmatched` | open, no booking, `not_booking = 0`, not automated-only (any reply state) |
| `waiting` | open, `last_direction = outbound`, not automated-only |
| `done` | `status = done` |
| `all` | everything; `chip` narrows to threads containing an `inbound` (non-automated) / `sent` / `failed` / `automated` message |

`unread` in the API = `last_inbound_at` newer than `last_outbound_at` (or no
outbound) on an open thread.

## Backfill results (local DB, 2026-10-08)

`scripts/backfill_conversations.py --force`: **664 messages split** — 473 with
quoted history, 472 with a signature, 0 errors, 0 left unsplit; **184
threads** built, 0 orphans removed. On the real bodies the splitter is
`high` confidence on 474, `medium` on 8 and finds nothing on 181 (first
messages of a thread, or quote-only/bottom-posted mail where failing open is
right).

Counts per view: **needs_reply 54 · unmatched 121 · waiting 121 · done 0 ·
all 184** (54 threads linked to bookings, 9 automated-only).

Two caveats in those numbers: 121 waiting + 54 needs reply + 9 automated = 184
is a coincidence with unmatched = 121 (184 − 54 linked − 9 automated). And the
first rows of Unmatched are the Sent-folder copies of earlier agents' `[DEV →
test@example.com]` test sends whose TEST bookings were deleted (outbound-only,
no booking); mark them "not a booking" or delete the rows. Deleting a message
and running `refresh_thread`/the backfill removes the thread row.

## API (`/api/v1`, all `@require_role("admin")`, `thrid` is always a string)

Errors follow the contract (`{"error": {code, message, fields?}}`): 404
`not_found` (unknown thread/booking), 422 `validation_error` (bad body,
document not on this booking, no address to reply to), 409 `conflict`
(detach on an unattached thread), 502 when a send failed (the row is still
returned).

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/inbox/conversations` | `view=needs_reply\|unmatched\|waiting\|done\|all` (default `needs_reply`), `q`, `chip=inbound\|sent\|failed\|automated`, `page`, `page_size` | `{items: [Thread], total, page, page_size, view, chip, counts}` |
| GET | `/inbox/conversations/:thrid` | | `{thread: Thread, booking, items: [StreamItem]}` |
| GET | `/inbox/conversations/:thrid/suggestions` | | `{items: [...]}` — same shape as `/messages/:id/suggestions`, scored on the latest inbound message |
| POST | `/inbox/conversations/:thrid/done` | | `{thread, counts}` |
| POST | `/inbox/conversations/:thrid/reopen` | | `{thread, counts}` |
| POST | `/inbox/conversations/:thrid/not-booking` | `{value?: bool}` (default true) | `{thread, counts}` |
| POST | `/inbox/conversations/:thrid/attach` | `{booking_id}` | `{thread, counts}`; links all messages, sets `bookings.email_thread_id` if empty, writes one `email_received` event |
| POST | `/inbox/conversations/:thrid/detach` | | `{thread, counts}`; 409 if not attached |
| POST | `/inbox/conversations/:thrid/notes` | `{body}` | 201 `{item: NoteItem}`; on a linked thread also a `booking_events` note (mirror, deduped in streams) |
| POST | `/inbox/conversations/:thrid/reply` | `{body_html, body_text?, subject?, cc?: [str], attach_document_ids?: [int], mark_done?: bool}` | 201 `{item: MessageItem, thread, counts}`; 502 with the same body when SMTP failed (`item.send_status = "failed"`). Kind `reply`, threaded onto the latest sendable message (`In-Reply-To`/`References`), subject defaults to `Re: <latest subject>`, To = latest inbound sender (else the counterpart), documents must belong to the thread's booking |
| GET | `/bookings/:id/conversation` | | `{booking: {id, reference, group_name, status, visit_date, contact_name, contact_email, email_thread_id}, threads: [Thread], items: [StreamItem]}` — every thread on the booking merged |
| GET | `/inbox/messages/:id/original` | | `{id, gmail_thrid, subject, body_html (sanitised, remote images in data-src), body_text, split_version}` |
| GET | `/inbox/templates` | | `{items: [{key, label, subject, body_html, body_text}]}` |

`counts` everywhere is `{needs_reply, unmatched, waiting, done, all}`.
`POST /inbox/sync` now also returns `conversation_counts`, and
`POST /inbox/compose` accepts an optional `body_text`.

### Thread (list item and `thread` in every response)

```json
{
  "thrid": "1878302343153220866",
  "booking": {"id": 124, "reference": "FY1703", "group_name": "Mount Olive", "status": "confirmed",
              "visit_date": "2026-11-12", "contact_name": "Jen Morris"},   // or null; the extra keys are present on thread rows
  "counterpart_name": "Jen Morris", "counterpart_email": "jen@example.com",
  "subject": "Group visit", "last_snippet": "You: Thank you, the 12th is booked…",
  "last_message_at": "2026-10-07T11:02:00", "last_inbound_at": "2026-10-07T09:35:20", "last_outbound_at": "2026-10-07T11:02:00",
  "last_direction": "outbound", "message_count": 3,
  "status": "open", "not_booking": false, "unread": false,
  "has_attachments": true, "has_automated_only": false,
  "done_at": null, "done_by": null, "created_at": "…", "updated_at": "…"
}
```
Timestamps are naive **Africa/Johannesburg** ISO strings, as before.

### Stream items (`items[]`, oldest first; `key` is unique across types)

Message — `type` is `"inbound"` or `"outbound"`:
```json
{
  "type": "inbound", "key": "msg-352", "id": 352, "at": "2026-10-07T09:35:20",
  "gmail_thrid": "1878302343153220866",
  "from_name": "Jen Morris", "from_email": "jen@example.com",
  "to_emails": ["thefarmyardpark@gmail.com"], "cc_emails": [],
  "subject": "Re: Group visit", "kind": null, "snippet": "Good day, I would like…",
  "body_new_html": "<div dir=\"ltr\">Good day…</div>",      // null only for text-only mail → render body_new_text
  "body_new_text": "Good day, I would like…",
  "body_quoted_html": "<div class=\"gmail_quote\">…</div>",  // null when nothing was split off
  "has_quoted": true, "quoted_lines": 23,
  "signature_text": "Kind regards,\nJen Morris\nGrade 3", "has_signature": true,
  "has_original_html": true, "split_version": 1,
  "attachments": [{"id": 9, "filename": "list.pdf", "size_bytes": 23111, "content_type": "application/pdf", "url": "/api/v1/inbox/attachments/9"}],
  "has_attachments": true,
  "send_status": null, "send_error": null, "sent_by": null, "sent_by_name": null,   // outbound: "sent" | "failed", the user who sent it
  "is_auto_generated": false,
  "booking": {"id": 124, "reference": "FY1703", "group_name": "Mount Olive"},
  "match_method": "thread", "review_status": "none", "message_id_header": "<…>"
}
```
For rows not yet split (`split_version = 0`, only possible before the backfill
or from a container still on the old image) `body_new_*` carry the original
bodies and `has_quoted` is false. Outbound `kind` is `proforma`, `invoice`,
`reply`, `bounce_back`, … (null for mail sent from Gmail itself).

Note:
```json
{"type": "note", "key": "note-5", "id": 5, "at": "2026-10-07T10:00:00", "body": "Phoned, pays Friday",
 "author_user_id": 1, "author_name": "Linda Caddick", "source": "thread", "gmail_thrid": "1878302343153220866", "booking_id": null}
```
`source` is `"thread"` (email_thread_notes) or `"booking"` (a `booking_events`
note added on the booking page; `key` is then `bnote-<event id>`).

Event (booking_events of a linked booking, except notes):
```json
{"type": "event", "key": "event-90", "id": 90, "at": "2026-10-07T09:14:00", "kind": "payment_matched",
 "summary": "Bank credit of R1500.00 on 2026-10-07 matched (reference)", "data": {"bank_transaction_id": 4, "amount": 1500.0},
 "actor_user_id": null, "actor_name": null, "booking_id": 124,
 "link": {"kind": "payment", "id": 8, "bank_transaction_id": 4, "booking_id": 124}}
```
`link.kind` is `document` (`id` = documents.id → `GET /documents/:id/pdf`),
`payment` (`id` may be null when only the bank transaction is known), `message`
(an email in another thread), or `booking`. `email_sent/received/failed`
events for messages already in the stream are dropped (the card shows them),
as are booking-note mirrors of thread notes.

### Rendering notes for the frontend

Render `body_new_html` and `body_quoted_html` in the existing sandboxed
iframe. Remote images sit in `data-src`; "Load images" means copying
`data-src` to `src` inside the iframe. `has_quoted`/`quoted_lines` drive
"Show quoted history (23 lines)"; `signature_text` is plain text (`pre-wrap`).
"View original" is `GET /inbox/messages/:id/original`. Every `thrid` and
`gmail_thrid` is a string.

## Templates setting (lead: please add to `DEFAULTS`)

`conversations.templates()` reads the `app_settings` row `templates` (via
`query_one`, so it works before the key exists) and merges it by `key` over
`conversations.DEFAULT_TEMPLATES` (`price_list`, `availability`,
`deposit_terms`, `form_link`). Suggested section for `src/services/settings.py`:

```python
"templates": {
    "items": [
        {"key": "price_list", "label": "Price list", "subject": None, "body_html": "<p>…{website}…</p>"},
        ...
    ]
},
```
Placeholders filled at read time: `{form_url}`, `{website}`, `{phone}`,
`{signature_name}`, `{deposit_percent}`, `{min_people}`, `{public_base_url}`.
A stored item needs `key` and `body_html`; `label` and `subject` are optional.
A bare list is accepted as well as `{"items": [...]}`.

## Requests for the lead / other agents

- **Rebuild the images.** The running `worker` and `web` containers are on the
  old code: their minute sync inserts rows without splits or thread rows (the
  backfill picks those up — run it once after the rebuild, it is idempotent).
- `docs/booking-system.md` §6: add the conversation endpoints and the
  `email_threads` / `email_thread_notes` tables (§4) from this note.
- **Documents/templates agent:** the text rendering of our emails starts with
  the wordmark line ("THE FARMYARD PARK"); the splitter drops it, but a text
  version without it would be cleaner for other consumers.
- Five `[DEV → test@example.com]` outbound-only threads from earlier test
  sends sit in Unmatched (see above); delete their `email_messages` rows and
  re-run the backfill, or mark them not-a-booking in the UI.
- Unrelated test failures seen while running the whole tree
  (`tests/bookings`, `tests/documents`, `tests/templates`): `allowed_transitions`
  for confirmed bookings, statement numbering `FY1703-S` vs `INV1703`,
  subjects no longer carrying the group name — all in other owners' files,
  not touched here.

## Known gaps

- A brand-new compose with no booking and no thread (`POST /inbox/compose`)
  has no `gmail_thrid` until the Sent-folder sync claims it (≈1 minute), so it
  is not a conversation until then. Replies from a conversation and document
  sends on a booking are placed in their thread immediately.
- A document email starts its own Gmail thread (different subject), so a
  booking can have several threads; `GET /bookings/:id/conversation` merges
  them and `email_threads.booking_id` links each. `bookings.email_thread_id`
  still names only the primary one.
- Text-only mail has `body_new_html = null`; the UI renders `body_new_text`.
- `quoted_lines` is computed per request (html2text over the quoted part);
  fine for thread sizes here.
- The splitter keeps Gmail forwards (`---------- Forwarded message`) in the
  quoted part; a customer who forwards something to us sees the "Show quoted
  history" control rather than the forward inline.
- No CSRF/role tests for the new endpoints (the guard is the lead's); they
  were exercised through Flask's test client with the auth patched, including
  one real reply send (dev-rewritten, to `DEV_MAIL_RECIPIENT`) on a synthetic
  TEST thread whose rows — and the Sent copy the worker synced back — were
  removed again.
