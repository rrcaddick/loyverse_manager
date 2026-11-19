# Mail agent handoff

Owner of: `src/clients/gmail.py`, `src/models/email_message.py`,
`src/services/mail_ingest.py`, `src/services/mail_send.py`,
`src/services/extraction.py`, `web/api/inbox.py`, `scripts/sync_mail.py`,
`scripts/import_mail.py`, `tests/mail/` (59 tests, no DB or network needed:
`.venv/bin/python -m pytest tests/mail`).

## Safety guarantees

- **IMAP is read-only by construction.** `GmailImap.select()` always passes
  `readonly=True` (asking for a writable folder raises), bodies are fetched with
  `BODY.PEEK[]`, and the client has no flag/move/delete/expunge methods.
- **Outbound rewrite.** `mail_send.apply_dev_rewrite` runs on every send: when
  `ENV != "prod"` all To/Cc become `DEV_MAIL_RECIPIENT` and the subject gets
  `[DEV → original@address, …] `. Covered by `tests/mail/test_send.py`.
  The stored row records the *actual* recipients/subject used.
- **Nothing sends automatically.** The sync only reads, matches and flags;
  bounce-backs and composes are buttons.

## Data layout under `DATA_DIR`

```
attachments/<gmail_msgid>/<safe filename>   email_attachments.file_path is relative to DATA_DIR
locks/sync_mail.lock                        flock used by scripts/sync_mail.py
```
Inline images under 10 KB are not stored; files over 25 MB are skipped and
listed in `attachments_meta` with `"skipped": true`. HTML bodies are sanitised
(no script/style/iframe/form/event handlers/javascript: URLs) and capped at
1 MB, but are **still untrusted** — render them in a sandboxed iframe.

## Cron / scheduler (lead: docker/ + compose)

```
* * * * *  cd /app && python -m scripts.sync_mail          # incremental, ~8 s, exit 0 ok / 1 errors / 2 crash
```
`sync_mail` skips silently (exit 0) when a previous run still holds the lock.
`POST /api/v1/inbox/sync` and the ops `sync_mail` action call the same
`mail_ingest.sync_mailbox()`.

One-off after the sheet import (lead runs it):
```
python -m scripts.import_mail --dry-run          # full sync + print the linking plan, no writes
python -m scripts.import_mail [--since YYYY-MM-DD] [--review-days 14]
python -m scripts.import_mail --skip-sync        # linking pass only
```
It links each current booking (status not cancelled/lapsed, visit_date ≥ today)
to its most recent thread (contact email / mobile / fuzzy name ≥ 0.85),
`match_method = "import"`, sets `bookings.email_thread_id`, then flags
pending reviews. Idempotent; writes an `import_runs` row (kind `mail`).

## Live sync (read-only, 2026-10-08)

First full sync since `GMAIL_IMPORT_SINCE=2026-06-01`: **657 messages**
(INBOX 372 inbound, Sent Mail 285 outbound), 269 attachments / 28 MB, 0 parse
errors, 125 s. 28 flagged auto-generated (Google/bank/notification senders),
**109 pending review** (inbound, unmatched, within 14 days — real enquiries;
no bookings existed yet so nothing matched). Incremental runs take ~8 s.
Three test emails were sent to the dev recipient (compose, two bounce-backs);
their rows and the `bounce_backs` marks were removed from the dev DB again.
Gmail threading was verified: a bounce-back sent as `Re: <original subject>` with
`In-Reply-To`/`References` came back from the Sent folder with the customer's
`X-GM-THRID`; the earlier attempt with the template's own subject did not thread.

## API (`/api/v1/inbox`, all `@require_role("admin")`)

Errors follow the contract (`{"error": {code, message, fields?}}`).

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/messages` | `view=review\|all\|unmatched\|booking`, `booking_id`, `q`, `page`, `page_size` | `{items: [ListItem], total, page, page_size, counts: {review, unmatched}}` |
| GET | `/messages/:id` | | `FullMessage` + `attachments[]`, `thread` (summary), `bounce_back` (`{sender_email, last_sent_at}` or null) |
| GET | `/threads/:thrid` | thrid is the numeric Gmail thread id (string in JSON) | `{gmail_thrid, booking, messages: [FullMessage+attachments], summary}` |
| GET | `/messages/:id/suggestions` | | `{items: [{booking_id, reference, group_name, contact_name, visit_date, status, score 0–1, reasons[]}]}` (max 5) |
| POST | `/messages/:id/attach` | `{booking_id, whole_thread?: bool}` | `{linked_ids[], message}`; writes `email_received` event (method manual), sets `bookings.email_thread_id` if null, pending → resolved |
| POST | `/messages/:id/detach` | | `{message}`; 409 if not attached; inbound goes back to `pending` |
| POST | `/messages/:id/resolve` | `{status: resolved\|not_booking\|pending}` | `{message, counts}` |
| POST | `/messages/:id/extract` | | `{fields, message_id}`; 503 `not_configured` without `ANTHROPIC_API_KEY`, 502 `extraction_failed` |
| POST | `/messages/:id/bounce-back` | | `{sent: FullMessage, message}`; 422 if disabled in settings / not inbound; 502 when SMTP failed |
| GET | `/attachments/:id` | `?inline=1` to display instead of download | file with `Content-Disposition`, `Content-Type`, `Cache-Control: private, no-store` |
| POST | `/sync` | | sync summary (below) + `counts`; 502 when any folder failed |
| POST | `/compose` | `{to: str\|[str], subject, body_html, booking_id?, cc?}` | `{message}` 201; kind `reply` with booking (threads onto it) else `custom` |

`extract` fields: `group_name, group_type (school|creche|church|nonprofit|family|
corporate|pensioners|other|null), area, contact_name, contact_email,
contact_mobile, visit_date (ISO|null), alternative_date, adults, children,
people_booked, vehicles, gazebos, arrival_time, questions[], notes`. The sender's
address/name fill `contact_email`/`contact_name` when the model left them null.
Model `claude-opus-5-5`, effort low, JSON schema enforced via structured outputs,
server-side refusal fallback enabled (falls back to a plain request if the beta
is rejected). Input capped at 6000 chars. One real call took 4–7 s.

### ListItem (the frontend builds against this)

```json
{
  "id": 352, "direction": "inbound", "kind": null,
  "from_name": "Jennifer Morris", "from_email": "jen@example.com",
  "to_emails": ["bookings@farmyardpark.co.za"], "cc_emails": [],
  "subject": "Re: price list", "snippet": "Good day I would like to secure…",
  "sent_at": "2026-10-07T09:35:20", "has_attachments": false,
  "booking": null,                       // or {"id", "reference", "group_name"}
  "match_method": null,                  // reference | thread | email | phone | manual | import | sent
  "review_status": "pending",            // none | pending | resolved | not_booking
  "is_auto_generated": false,
  "gmail_thrid": "1878302343153220866",  // string: exceeds JS integer range
  "send_status": null,                   // outbound only: sent | failed
  "bounce_back_sent_at": null
}
```
`sent_at` is naive **Africa/Johannesburg** local time. `kind` is set on outbound
rows we sent (`proforma`, `reply`, `bounce_back`, …) and null for synced mail.

### FullMessage = ListItem +

`gmail_msgid` (string), `folder`, `message_id_header`, `in_reply_to`,
`references_header`, `body_text`, `body_html` (sanitised or null), `send_error`,
`sent_by`, `attachments_meta` (`[{filename, size, content_type, skipped?}]`),
`resolved_by`, `resolved_at`, `created_at`, and from the endpoint
`attachments: [{id, filename, size_bytes, content_type, url}]`.

### Sync summary

```json
{"ok": true, "mode": "incremental", "started_at": "…", "duration_s": 8.4,
 "fetched": 1, "inserted": 0, "updated": 0, "claimed": 1, "matched": 0, "pending": 0,
 "rematched": 0, "errors": [],
 "folders": {"INBOX": {"mode": "incremental", "uidvalidity": 1, "from_uid": 13604, "to_fetch": 0,
                       "fetched": 0, "inserted": 0, "updated": 0, "claimed": 0, "matched": 0,
                       "pending": 0, "errors": 0, "attachments": 0, "last_uid": 13604},
             "[Gmail]/Sent Mail": {…}}}
```
`claimed` = a Sent-folder copy of a message we sent over SMTP was merged into
the existing outbound row (matched on `message_id_header`). `rematched` = older
unmatched inbound mail that now matched because a booking was created since.
`mail_sync_state.last_error` holds the last folder failure; `all_sync_state()`
is there for `/ops/status`.

## Services other agents use

```python
from src.services.mail_send import send_email, compose, send_bounce_back, RenderedEmail, MailSendError
row = send_email(to=[...], rendered=rendered, attachments=[(filename, bytes, content_type)],
                 booking_id=id, kind="proforma", actor=user_id, thread_message_id=None, cc=())
# -> FullMessage dict; row["send_status"] in ("sent", "failed"), row["send_error"]. Raises MailSendError
#    only for caller errors (no recipient, unknown booking). Writes email_sent / email_failed events via
#    src.services.booking.add_event (falls back to a direct INSERT when the import fails).
# Threading: In-Reply-To/References from thread_message_id, else the booking's latest message id; the row
# borrows bookings.email_thread_id as gmail_thrid until the Sent sync confirms the real one.
```
Gmail only threads a reply into the customer's conversation when the normalised
subject matches too — use `mail_send.reply_subject_for(original_subject)` ("Re: …")
for replies you want to appear in the same Gmail thread. Document emails
(proforma, invoice…) will show as their own Gmail threads; the app's thread
view groups by `booking_id` regardless.

```python
from src.services.mail_ingest import sync_mailbox, match_message, suggest_bookings, add_booking_event
from src.models.email_message import (list_for_booking, latest_message_id_for_booking,
                                      bookings_needing_reply, latest_inbound_after_outbound, all_sync_state)
```

### SQL the ops agent can reuse (`needs_reply`)

`email_message.bookings_needing_reply()` — one row per booking whose newest
non-auto inbound message is newer than its last successful outbound:

```sql
SELECT b.id AS booking_id, b.reference, b.group_name, m.id AS message_id, m.subject, m.sent_at
FROM bookings b
JOIN email_messages m ON m.booking_id = b.id
WHERE b.status NOT IN ('cancelled','lapsed','completed','no_show')
  AND m.direction = 'inbound' AND m.is_auto_generated = 0
  AND m.sent_at = (SELECT MAX(i.sent_at) FROM email_messages i
                   WHERE i.booking_id = b.id AND i.direction = 'inbound' AND i.is_auto_generated = 0)
  AND m.sent_at > COALESCE((SELECT MAX(o.sent_at) FROM email_messages o
                            WHERE o.booking_id = b.id AND o.direction = 'outbound'
                              AND (o.send_status IS NULL OR o.send_status = 'sent')), '1970-01-01')
ORDER BY m.sent_at DESC;
```
`unmatched_emails` = `review_status = 'pending'` (same as `counts().review`).

## Matching rules (as built)

1. `\b(FY|INV)[\s-]?(\d{3,5})\b` in subject or body → `bookings.doc_number`.
2. Same `gmail_thrid` as an already-linked message, or `bookings.email_thread_id`.
3. Sender (inbound) / any recipient (outbound) == `contact_email`, preferring
   active + upcoming bookings, then most recent visit.
4. A ZA mobile in the body (phonenumbers, ZA region) == `contact_mobile`.

Inbound matches write an `email_received` event; a learned thread id fills a
null `bookings.email_thread_id`. Inbound, unmatched, non-auto mail newer than
`today − settings.email.review_window_days` becomes `pending`. Auto-generated =
`Auto-Submitted` ≠ no, `Precedence` bulk/list/junk, `List-Id`/`List-Unsubscribe`,
`X-Failed-Recipients`, sender local-part matching
`mailer-daemon|postmaster|noreply|no-reply|donotreply|notification|messaging-service|newsletter|marketing|alert`,
or our own address in INBOX (stored as an outbound copy).

## Requests for the lead / other agents

- **Scheduler:** add the `sync_mail` cron line above to the supercronic file.
- **Frontend:** render `body_html` in a sandboxed iframe (`sandbox=""`, CSP
  `default-src 'none'; img-src https: data:`); treat `gmail_thrid`/`gmail_msgid`
  as strings; `GET /attachments/:id?inline=1` for previews.
- **Settings service (optional):** `Settings` sets sections dynamically, so mypy
  reports `"Settings" has no attribute "email"` at call sites; two
  `# type: ignore[attr-defined]` live in my files for that.
- **Documents agent:** per the lead's note I call
  `render_email("bounce_back", None, settings, form_url=BOOKING_FORM_URL, subject="Re: …", logo_url=…)`
  and `render_email("reply", booking_row_or_None, settings, subject=…, body_html=…, logo_url=…)`
  with `logo_url = f"{PUBLIC_BASE_URL}/static/brand/logo-black-600.png"`
  (`mail_send.logo_url()`); both work with the current `email_templates.py`.
- **Bookings agent:** `add_event(booking_id, kind, summary, data=…, actor=…)` is
  called with keywords — matches the current signature.

## Known gaps

- A thread shared by two current bookings (same contact, two visits) is given to
  the earlier visit by `import_mail`; the other booking's older thread is used
  if any, else left for manual attach.
- `match_unlinked()` only revisits the review window (default 14 days, 300 rows
  per run); older unmatched mail is linked by `import_mail` or by hand.
- Suggestions scan bookings visiting from 45 days ago onward (cap 400) — fine for
  this park's volume, not indexed for anything larger.
- No CSRF/role tests for the API (the guard is the lead's); endpoints were
  exercised through Flask's test client with the auth patched.
- `send_email` stores the dev-rewritten recipients/subject; the original address
  only survives in the `[DEV → …]` prefix. Intentional outside prod.
- Attachments of a message we sent are kept in `attachments_meta` only until the
  Sent-folder copy is synced, which then writes the `email_attachments` rows and files.
