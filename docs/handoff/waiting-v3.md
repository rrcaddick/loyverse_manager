# Waiting v3 — per-person waiting, unanswered marks, automated filter (backend)

Implements `docs/handoff/waiting-v3-contract.md` on `feat/booking`. Owner's
decision (2026-10-09): "waiting on us" is decided per **person**, never per
thread; unanswered messages are counted and marked individually; automated
mail is filtered in three layers and "Not a booking" teaches a learned
sender list.

Files owned by this build:

| Path | What |
| --- | --- |
| `src/services/waiting.py` | the party model: snapshot, `party_summary`, `waiting_parties`, `mark_done`, `reopen`, `party_stream`, marks |
| `src/models/ignored_sender.py` | `mail_ignored_senders` (migration 010): `normalise`, `matches`, `add`, `delete` |
| `src/services/mail_ingest.py` | `automated_layer`, `classify_automated`, `match_booking_direct`; drop path in `_sync_folder`; richer header capture |
| `src/services/conversations.py` | `needs_reply` view → parties, `counts.needs_reply` = parties, `unanswered` marks on streams, `not_booking` (learns), auto-reopen keeps the mark |
| `src/models/email_thread.py` | `set_status(keep_mark)`, `set_status_many`, `set_not_booking_many`, `all_rows`, `get_many`, `list_for_counterpart` |
| `src/models/email_message.py` | `messages_for_waiting`, `messages_for_threads`, `inbound_for_reclassify`, `set_auto_generated` |
| `src/services/work.py` | `reply` view rows are parties |
| `web/api/inbox.py` | party endpoints, ignored-sender endpoints, not-booking body |
| `scripts/reapply_waiting.py` | re-run the filter over stored mail, print the party counts |
| `tests/mail/test_waiting.py`, `tests/mail/test_classification.py`, `tests/mail/test_conversations_db.py`, `tests/ops/test_work.py` | 139 tests in `tests/mail` + `tests/ops/test_work.py` + `tests/ops/test_today.py` |

```
PYTHONPATH=. .venv/bin/python -m pytest tests/mail tests/ops/test_work.py tests/ops/test_today.py -q
.venv/bin/python -m scripts.reapply_waiting --dry-run     # preview; without the flag it marks and refreshes
```

## The party computation (`src/services/waiting.py`)

- **party_key**: `b:<booking_id>` when the thread row has a booking (else the
  newest linked message's booking), otherwise `e:<lower-cased counterpart address>`.
  A thread with neither has no party and never waits.
- **party_addresses**: booking party = the booking's `contact_email` + every
  thread's `counterpart_email` + every non-automated inbound sender on those
  threads ("all its contacts"); address party = the address. Our own address
  is never a party address.
- **last_handled(party)** = max of
  - the newest successful outbound (`send_status` null or `sent`) whose To or
    Cc holds any party address — including outbound rows the Sent sync has
    not threaded yet,
  - for booking parties, the newest successful outbound with `booking_id = the booking`,
  - the newest successful outbound inside any of the party's threads,
  - the newest `done_at` over the party's threads.
- **unanswered message** = inbound, not automated, not from us, with
  `sent_at > last_handled` and `sent_at > done_at` of its own thread.
  `unanswered_count(party)` = how many; the party **waits** when it is > 0.
- **Done** on a party stamps `done_at = now` (status `done`) on all its threads
  and resolves pending legacy reviews. **Reopen** clears the mark on all of them.
  A new inbound on a done thread reopens it (`status = open`) but **keeps
  `done_at`** (`conversations.refresh_thread` → `et.set_status(..., keep_mark=True)`),
  so only mail after the mark counts. Frontend: use `status` for the Done
  badge, not `done_at`.
- Everything is computed per request from one snapshot: `et.all_rows()` (every
  thread with its booking columns), `em.messages_for_waiting()` (light rows:
  id, thread, direction, from, to, cc, sent_at, booking, send_status,
  automated), one `bookings` lookup. 243 threads / 1 542 messages take 0.12 s;
  the per-party work is O(messages) via indexes on address, booking and
  thread. Nothing is cached across requests; the API builds the snapshot once
  per request and passes it (`snap=`) into `conversations.*`.

## Endpoints (`/api/v1`, admin only, non-GET needs `X-CSRF-Token`)

Errors are the usual `{"error": {code, message, fields?}}`: 404 `not_found`
(unknown booking; an address with no thread), 422 `validation_error` (bad
`party_key`, bad `scope`, bad pattern, `thrid` not in the party), 502 when a
reply's SMTP failed (the row is still returned).

### `GET /inbox/conversations?view=needs_reply&q&page&page_size` → parties

```json
{
  "view": "needs_reply", "chip": null, "page": 1, "page_size": 25, "total": 23,
  "counts": {"needs_reply": 23, "unmatched": 19, "waiting": 0, "done": 194, "all": 243},
  "items": [
    {
      "party_key": "e:relations.fr@nid.org.za",
      "booking": null,
      "counterpart_name": "Chriszelda Veldsman", "counterpart_email": "relations.fr@nid.org.za",
      "unanswered_count": 1, "oldest_unanswered_at": "2026-06-17T09:32:40",
      "last_message_at": "2026-06-17T09:32:40", "last_snippet": "Dear Valued Sponsor, Thank you …",
      "subject": "NID Dusk & Dawn Trail Run", "thread_count": 1,
      "primary_thrid": "1868228535287741693", "has_attachments": true
    },
    {
      "party_key": "b:2459",
      "booking": {"id": 2459, "reference": "FY1739", "group_name": "…", "status": "confirmed",
                  "visit_date": "2026-11-07", "contact_name": "…"},
      "counterpart_name": "…", "counterpart_email": "…@gmail.com",
      "unanswered_count": 1, "oldest_unanswered_at": "2026-10-06T14:02:11", "...": "…"
    }
  ]
}
```

Ordered by `oldest_unanswered_at` ascending. `q` matches counterpart name /
email, subject, last snippet, booking reference / group name (Python, over
the waiting parties). `chip` is ignored for this view. `counts.needs_reply`
is the number of waiting parties everywhere `counts` appears
(`conversations.counts()`); the other four counts are unchanged thread counts.

Every **other view** keeps thread items (mail-v2 shape) and each gains
`"party_key": "e:…" | "b:…" | null` and `"unanswered_count": n` — **the
thread's own** unanswered messages (the party's total is on the party item).

### `GET /inbox/parties/<party_key>`

```json
{
  "party_key": "b:2459",
  "booking": {"id": 2459, "reference": "FY1739", "group_name": "…", "status": "confirmed", "visit_date": "2026-11-07",
              "contact_name": "…", "contact_email": "…", "email_thread_id": "1878…"},   // null for e: parties
  "counterpart_name": "…", "counterpart_email": "…",
  "unanswered_count": 1,
  "threads": [ {Thread…, "party_key": "b:2459", "unanswered_count": 0}, {Thread…, "unanswered_count": 1} ],
  "items": [ {"type": "outbound", …, "unanswered": false}, {"type": "inbound", …, "unanswered": true}, {"type": "event", …} ]
}
```

Booking parties reuse `conversations.booking_conversation` (every thread
merged with the booking's events and notes, same item shapes as mail-v2);
address parties merge their threads' messages and thread notes. Message
items (`inbound`/`outbound`) carry `unanswered`; notes and events do not.
`threads` are oldest activity first; the newest is the `primary_thrid`.
`party_key` is accepted in any case (`e:Jo@X` → `e:jo@x`).

### `POST /inbox/parties/<party_key>/done` and `/reopen`

```json
{"party": {party item, "unanswered_count": 0}, "threads": [Thread…], "counts": {…}}
```

### `POST /inbox/parties/<party_key>/reply`

Body as the thread reply — `{body_html, body_text?, subject?, cc?: [str],
attach_document_ids?: [int], mark_done?: bool}` — plus optional `thrid`
(must be one of the party's threads, else 422). Replies on the newest thread
by default; 422 when the party has no thread (a booking without mail).
Returns 201 (502 when SMTP failed):

```json
{"item": {MessageItem, "type": "outbound", "send_status": "sent"}, "thread": Thread,
 "party": {party item after the send}, "counts": {…}}
```

### `GET /inbox/conversations/<thrid>`

Unchanged plus: `thread.party_key`, `thread.unanswered_count` (own), top-level
`party_key` and `unanswered_count` (same values), and `unanswered` on every
message item.

### `GET /bookings/<id>/conversation`

The party stream for `b:<id>`: mail-v2 shape plus `"party_key": "b:<id>"`,
`"unanswered_count": n` (the party's), `threads[].party_key /
unanswered_count`, and `items[].unanswered` on message items.

### `POST /inbox/conversations/<thrid>/not-booking`

Body `{value?: bool, learn?: bool, scope?: "address" | "domain", reason?: str}`.

- `value: false` → undoes the flag on this thread only:
  `{"thread": Thread, "rule": null, "threads_closed": 0, "counts": {…}}`.
- otherwise every thread from the sender is closed — `not_booking = 1`,
  `status = done`, inbound rows `review_status = not_booking` — and with
  `learn: true` the sender joins `mail_ignored_senders`:

```json
{"thread": Thread, "sender": "sales@vendor.co.za", "scope": "domain",
 "rule": {"id": 3, "pattern": "@vendor.co.za", "kind": "domain", "reason": "Not a booking (thread 1878…)",
          "created_by": 1, "created_at": "2026-10-09T13:20:11"},     // null when learn is false
 "threads_closed": 2, "counts": {…}}
```

Scope: explicit `scope` wins; otherwise **address** when the sender's host is a
public mailbox (gmail.com, googlemail, yahoo.*, hotmail.*, outlook.*, live.*,
icloud.com, me.com, ymail, msn, aol, protonmail/proton.me, webmail.co.za,
mweb.co.za, telkomsa.net, vodamail.co.za, iafrica.com, lantic.net,
absamail.co.za, polka.co.za — `conversations.is_public_mailbox`) and
**domain** otherwise. With domain scope every *unlinked* thread from that
host or a subdomain is closed too; threads attached to a booking are left
alone (the clicked thread is always flagged). Learning twice returns the
existing rule.

### Ignored senders

```
GET    /inbox/ignored-senders                       → {"items": [{"id", "pattern", "kind", "reason", "created_by", "created_at"}]}
POST   /inbox/ignored-senders {pattern, reason?}    → 201 {"item": {...}}   pattern "name@host" (address) or "@host" (domain)
DELETE /inbox/ignored-senders/<id>                  → {"deleted": id}       404 when unknown
```

Patterns are lower-cased; a bare `host` is accepted as a domain; anything
else is 422 with `fields.pattern`. A domain rule covers the host and every
subdomain (`ignored_sender.matches`). Posting an existing pattern returns it
(201, same id).

### Work and Today

`GET /work?view=reply` rows are parties (ordered oldest unanswered first,
tier 3 in `up_next`):

```json
{"kind": "reply", "id": "reply:b:2459",
 "booking": {"id": 2459, "reference": "FY1739", "group_name": "…", "visit_date": "2026-11-07", "status": "confirmed", "people_booked": 60},
 "title": "Hillcrest Primary", "context": "Mrs Daniels · 1 message waiting · oldest 6 Oct",
 "amount": null, "age_days": 3, "group": null,
 "primary": {"verb": "Reply", "action": "open_conversation", "party_key": "b:2459", "thrid": "1878…", "booking_id": 2459},
 "secondary": [{"verb": "Open", "action": "open_booking", "booking_id": 2459}],
 "sort_key": "03:2026-10-06T14:02:11:b:2459"}
```

Address parties have `booking: null`, `title` = the person, context
`"2 messages waiting · oldest 4 Jun"`, no `booking_id` in the primary and no
secondary. `age_days` = days since the oldest unanswered message.
`counts.reply` = parties; `counts.total`, `up_next` and Today's
`tiles.needs_you` follow from the same snapshot (no change in `today.py`).
`POST /inbox/sync` summaries (and each folder's stats) gain `dropped` and
`automated`.

## Automated filter (`mail_ingest.automated_layer` / `classify_automated`)

Outbound rows are never classified. For inbound mail, in order:

1. **Headers (certain)** — `Auto-Submitted` other than `no`; `Precedence`
   bulk/list/junk; `List-Id`; `List-Unsubscribe`; `X-Failed-Recipients`
   (bounce); a bulk provider in `X-Mailer`, `Return-Path`, the joined
   `Received` chain **or the sender's domain** (stored rows keep no headers;
   the domain is the same fingerprint); any provider header
   (`X-Mailgun-*`, `X-SES-*`, `X-MC-*`, `X-SG-*`, `X-Sendgrid-*`, `X-Mandrill-*`,
   `X-Mailchimp-*`, `X-Campaign*`, `X-Brevo*`, `X-SIB-*`, `X-Everlytic*`).
   Providers: mailchimp, mcsv.net, mcdlv.net, mandrill, sendgrid, sendinblue,
   brevo, mailgun, amazonses, ses.amazonaws, articulationmail, everlytic,
   constantcontact, campaignmonitor, createsend, klaviyo, hubspot, sparkpost,
   postmarkapp, mailjet, mailerlite, activecampaign, exacttarget, marketo,
   pardot, touchbasepro, graphicmail, yoco (`BULK_PROVIDER_RE`).
   `parse_message` now captures `X-Mailer`, the provider headers and all
   `Received` lines (joined with ` || `, 4 000 chars) into `parsed.headers`.
2. **Sender shape (certain)** — a whole token of the local part (split on
   `.`, `_`, `+`, `-`) in `no-reply, noreply, no_reply, donotreply,
   do-not-reply, receipts, notifications, notification, ibreply,
   mailer-daemon, postmaster, billing, invoices, statements, alerts,
   newsletter`, or the pre-existing substring rule `AUTO_SENDER_RE`
   (notification, messaging-service, marketing, alert, …). `billing-team@`
   and `invoices+ar@` match; `abilling@`, `accounts@`, `bursar@`, `finance.office@` do not.
3. **Subject shape (hint)** — starts with "Receipt from", "Notice of
   payment", "Statement" (also "Your/Monthly/Account/Tax/e-Statement"), or
   carries "Invoice INV-<digits>", "Newsletter", "Unsubscribe" — **only when
   the subject has no Re:/Fwd: prefix**: a person forwarding a receipt or
   replying to an invoice is a person writing to us (real example: a
   customer's "Fwd: Notice of Payment" with their proof of payment).

Decision: layers 1–2 and a learned **ignored sender** are certain → the
message is **dropped** (counted in `dropped`, logged at INFO with the reason,
never stored) unless `match_booking_direct` finds a booking by reference
(FY/INV number in subject or body), contact email or ZA mobile — the thread
step of the normal matcher is deliberately skipped — in which case it is
stored and marked automated (the reason says `kept for booking N (method)`).
Layer 3 → stored, `is_auto_generated = 1`, excluded from every queue, visible
under All mail › Automated. The existing own-address-in-INBOX rule still
stores such copies as outbound + automated. A message already stored (resync
after a UIDVALIDITY change) is never dropped. The ignored list is loaded once
per folder sync.

## `scripts/reapply_waiting.py` and the numbers (local DB, 2026-10-09)

The script scans inbound rows not yet automated, applies layers 1–3 (layer 1
only as the sender-domain proxy) and the ignored list, marks
`is_auto_generated` (never deletes), refreshes the touched threads and prints
the party counts next to the old per-thread count. Run for real after a dry
run:

```
reclassify: scanned 867 inbound rows, marked 3 automated {'headers': 2, 'sender': 1}
    1053 [headers] hello@m.articulationmail.com  |  About Your Weebly Website        (sender domain via articulationmail)
    1681 [headers] receipts@messaging.yoco.co.za  |  Receipt from Hose 24 (Pty) Ltd … (sender domain via yoco)
    1755 [sender]  ibreply@absa.co.za             |  Notice of payment: The Farmyard Park (sender ibreply@absa.co.za (ibreply))
waiting: 23 parties (5 bookings, 18 addresses), 26 unanswered messages;
         old per-thread needs_reply = 46; Work reply rows = 23
```

Before the reclassify the old thread view said **49** (now 46: the three
threads became automated-only). The 46 collapse to **23 parties** because:
24 of the old threads are still waiting (they fold into 23 parties — one
address and four bookings own two or three of them), and 22 are not: every
one is on a booking party that was written to after that thread's last
inbound — either the Sent folder has mail to one of the booking's addresses
in another thread, or another thread of the same booking carries a newer
reply/done mark. Only **5 booking parties** wait (one message each); the old
Work `reply` view said 16 because it looked thread by thread and only at
linked threads. Work `counts.reply` / Today's `needs_you` now count 23
reply rows (total 87 with the other kinds on 2026-10-09, oldest 114 d).
Three `TEST V3` threads from the parallel frontend build were present when
these numbers were re-checked and are excluded from them.

## Tests

- `tests/mail/test_waiting.py`: pure `compute` scenarios (address party across
  threads, a Cc counts as written to, failed send / automated inbound ignored,
  done mark per thread, party assignment edge cases, ordering and search),
  DB tests (party done / reopen / reopen-by-inbound keeping the mark, booking
  and thread streams with marks, not-booking learning with address vs domain
  scope) and API tests (needs_reply parties, thread items annotated, party
  stream, reply with `mail_send.compose` replaced by an insert — nothing is
  sent — done, reopen, not-booking with learning, ignored-sender CRUD).
- `tests/mail/test_classification.py`: realistic raw messages — Yoco receipt,
  ABSA notice (dropped unless it names a booking), Mailchimp newsletter
  (headers), a school bursar asking for an invoice (kept), subject hints vs
  replies/forwards, ignored senders, local-part tokens.
- `tests/mail/test_conversations_db.py`: auto-reopen now keeps `done_at`.
- `tests/ops/test_work.py`: reply rows are parties (`reply:b:<id>`, context,
  payload); an unattached sender is a row with `booking: null`; a Cc to the
  contact clears the booking party. The threads-table-empty fallback is gone.

All rows the tests create are TEST bookings, thread ids ≥ 9.3e18, msgids ≥
9.4e18, `.test` addresses and test ignored-sender patterns, removed afterwards.

## Decisions worth a glance (lead)

- **Work `reply` includes address parties** (unattached senders) — the
  contract says rows are parties and `counts.reply = parties`; the old view
  was linked threads only. One line in `work._reply_rows` restricts it to
  bookings if that is unwanted (`if not p.get("booking"): continue`).
- Layer 3 skips subjects with a Re:/Fwd: prefix (see above); the sender
  domain acts as layer 1 (so `hello@m.articulationmail.com` is caught without headers).
- The thread-level `done` / `reopen` endpoints still act on one thread;
  the party endpoints act on all of the party's threads.
- `email_threads.status = 'done'` with a non-null `done_at` on an *open*
  thread is now normal after an auto-reopen.
- `docs/booking-system.md` §6 does not yet list the party / ignored-sender
  endpoints or the `mail_ignored_senders` table (not edited here).
- The legacy ten-section queue (`reminders._needs_reply`) and the old
  per-thread predicate `et._VIEW_WHERE["needs_reply"]` are untouched; the
  latter is only used by the reapply script for the comparison number.
- The docker worker still runs the old image: its minute sync stores
  everything (no dropping) and reopens threads clearing `done_at` until it
  is rebuilt.
