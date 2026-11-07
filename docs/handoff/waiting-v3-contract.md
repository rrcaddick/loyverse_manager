# Per-person waiting, unanswered marks, automated filter — API contract (v3)

Decision (owner, 2026-10-09): "waiting on us" is decided per PERSON, never per
thread. For a sender attached to a booking the party is the booking (all its
contacts, all its threads); otherwise the party is the sender address. Copied
recipients count as written to.

## Definitions

- party_key: `b:<booking_id>` or `e:<lowercased address>`.
- last_handled(party) = max( latest outbound message to any of the party's
  addresses (to or cc) or on any of the booking's threads, latest `done_at`
  of the party's threads ).
- A message is **unanswered** when it is inbound, not automated, and
  `sent_at > last_handled(party)` — for messages inside a thread that was
  marked done, compare against that thread's `done_at` as well.
- unanswered_count(party) = number of such messages across all its threads.
- A party is **waiting** when unanswered_count > 0. Marking a party done sets
  `done_at = now` on all its threads (so everything so far is handled); a
  later inbound makes it waiting again automatically. Thread `status` stays as
  the storage of the manual mark; queues must use the party computation.

## Endpoints

- `GET /inbox/conversations?view=needs_reply&q&page&page_size` → items are
  PARTIES: `{party_key, booking|null, counterpart_name, counterpart_email,
  unanswered_count, oldest_unanswered_at, last_message_at, last_snippet,
  subject, thread_count, primary_thrid (newest thread), has_attachments}`;
  ordered by oldest_unanswered_at ascending. `counts.needs_reply` = parties.
  Other views keep thread items; each thread item gains `unanswered_count`
  and `party_key`.
- `GET /inbox/parties/<party_key>` → `{party_key, booking|null, counterpart_*,
  unanswered_count, threads: [thread_to_api…], items: [stream items…]}` —
  the merged stream of every thread of the party in time order (same item
  shapes as the thread stream); each message item gains `unanswered: bool`.
- `POST /inbox/parties/<party_key>/done` → marks all threads done.
- `POST /inbox/parties/<party_key>/reopen`.
- `POST /inbox/parties/<party_key>/reply` → same body as the thread reply;
  replies on the newest thread (or `thrid` in the body to pick one).
- `GET /inbox/conversations/<thrid>` items gain `unanswered`.
- `GET /bookings/<id>/conversation` is the party stream for `b:<id>`; items
  gain `unanswered`; response gains `unanswered_count`.
- `POST /inbox/conversations/<thrid>/not-booking {learn?: true, scope?: "address"|"domain"}`
  → marks every thread of that sender not_booking + done and, when learn is
  true, adds the sender to `mail_ignored_senders` (default scope: address;
  domain when the domain is not a public mailbox provider). Returns the rule.
- `GET /inbox/ignored-senders` → `{items: [{id, pattern, kind, reason, created_at}]}`;
  `POST /inbox/ignored-senders {pattern, reason?}` (pattern `name@host` or `@host`);
  `DELETE /inbox/ignored-senders/<id>`.
- Work `reply` view rows are parties: `context` = "2 messages waiting · oldest 4 Jun",
  `primary.action = "open_conversation"` with `party_key` (keep `thrid` = primary).
  `counts.reply` = parties. Today's `needs_you` follows.

## Automated filter (ingest)

Three layers. (1) Headers: Auto-Submitted, Precedence bulk/list/junk, List-Id,
List-Unsubscribe, X-Mailer bulk providers, Return-Path/Received from bulk
providers (mailchimp, sendgrid, mailgun, amazonses, yoco, articulationmail…).
(2) Sender shape: local parts no-reply, noreply, donotreply, receipts,
notifications, notification, ibreply, mailer-daemon, billing, invoices,
statements, alerts, newsletter. (3) Subject shape: "Receipt from", "Invoice
INV-", "Notice of payment", "Statement", "Newsletter", "Unsubscribe".
Layers 1 and 2 are certain: the message is DROPPED unless it matches a
booking (reference, email or mobile), in which case it is stored and marked
automated. Layer 3 is a hint: stored, marked automated, excluded from queues,
visible under All mail › Automated. Ignored senders (the learned list): same
treatment as layer 1/2.
