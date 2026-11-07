# Migration and the inbound pipeline (functionality round, 26 Oct 2026)

The product is bookings and enquiries, not a mail client. This note is the
contract for the one-off season migration and for how the live app treats
incoming mail, as agreed with the owner on 26 October. Code: `src/services/
matching.py` (shared evidence rules), `migration.py` (one-off), `inbound.py`
(live), `enquiries.py`, `payment_search.py`, `pop.py`; models `enquiry.py`,
`booking_contact.py`, `mail_skipped.py`, `pop.py`; migration `011`.

## 1. The migration (one-off, per environment)

`python -m scripts.migrate_season` is a **dry run** that writes
`data/migration/report-<stamp>.md` and `.json`. `--apply` stores and links.

1. **Bookings** from the sheet from `--from-visit` (default 1 Sep), normalised
   (whitespace, name case, phone to `27XXXXXXXXX`).
2. **Each booking's mail**, by server-side Gmail search in All Mail, in order:
   - the reference `FY####`/`INV####` in subject, body or attachment file name
     (`filename:`) — one query usually finds the proforma thread and with it
     the customer's address;
   - every known address (`from:` / `to:` / `cc:`);
   - the mobile in every written form, OR'd in one query
     (`matching.phone_variants`), verified locally by digit comparison;
   - the distinctive words of the group name (generic words dropped:
     primary, school, church, grade, gr, kids, …);
   - the contact's surname.
   Every hit is fetched as a **whole conversation** (sent mail included) and
   scored: reference 100, email 90, mobile 80, group 60, half the group words
   35, surname 30, first name 10. **Attach at 65**; 40–64 is a review line
   in the report; a group name alone never attaches.
3. **One hop of cc expansion**: people on attached conversations (not us,
   not robots, not `info@`-style boxes, at most 6) are searched too and
   become the booking's contacts (`booking_contacts`, `shared=1` when an
   address turns up on more than one booking).
4. **Seasons**: attached conversations are clustered by last activity; a gap
   of more than 60 days starts a new cluster; the newest cluster wins; a
   cluster that ends before 1 Jan 2026 is a previous season (rejected
   whole); one that straddles the floor is continuous and kept whole.
5. **Bank**: credits already polled whose description carries the reference,
   or a group word with an amount that fits the deposit or total.
6. **Enquiries** (`--with-enquiries`): inbox mail since `--enquiries-from`
   (1 Jun) in no booking's conversation, where the customer wrote last or
   was never answered, minus automated mail. Stored and wrapped as enquiries.

The report lists, per booking, every query with its hit count, each
conversation with score, reasons, dates, participants and the attach /
review / older-season verdict, the contacts learned and the bank candidates.

## 2. Live inbound (`src/services/inbound.py`)

Every inbound INBOX message gets one outcome (`email_messages.inbound_outcome`):

| outcome | what happened |
| --- | --- |
| `booking` | attached to a booking: by thread, reference (any status), a known address or mobile of an open booking, or a corroborated group name. Sender learned as a contact. POP inspection runs. |
| `allocate` | the people on it have several open bookings and thread / reference / group words / a visit date in the text could not settle it: `candidate_booking_ids` set, a Work row offers "Assign". |
| `enquiry` | continues an open enquiry (same thread or same sender). |
| `started_by_us` | a reply in a conversation we opened: left in Gmail. |
| `pending_form` | cold: the bounce-back with the form link went out unless one went to that sender inside `form_window_hours`; the sweep follows up. |
| `not_booking` | the thread was marked not a booking earlier. |

Open bookings = `requested`, `enquiry`, `proforma_sent`, `confirmed`, plus
`completed` within `active_days_after_visit` of the visit.

**The automated filter** (`classify_automated`) has two grades. *Certain*
(Auto-Submitted, delivery failures, bulk-mail providers, no-reply /
mailer-daemon senders) is skipped outright. *Likely* (Precedence bulk/list,
List-Id/Unsubscribe, receipt-style senders) gets a second look
(`looks_like_booking`): a personal sender name plus the words of a visit
means human. Bank payment notices are never "certain". Skipped mail is **not
stored and not moved**: its headers go to `mail_skipped`; Today shows the
count; `POST /inbound/skipped/<id>/rescue` fetches it and runs it with the
filter bypassed. A message that names a booking is stored even when
automated (bank notifications → POP detector).

**The sweep** (`inbound.sweep`, worker timer `sweep_interval_hours`):
pending-form mail past its window is re-matched by mobile / group name
against open bookings and requests, joins an open enquiry, or becomes a new
enquiry (one per conversation); mail carrying the hand-applied
`label_process` label is processed with the filter bypassed; then labels.

**Labels** (`apply_labels`): processed mail gets `Farmyard/Bookings` or
`Farmyard/Enquiries` through the one read-write IMAP session
(`GmailImapWriter`: add/remove labels only). `archive_enabled` (default
off) also removes it from the inbox. Automated and operational mail is never
labelled: the inbox keeps the business's mail.

**Worker**: `scripts/inbound_worker.py` (compose service `inbound`): IMAP
IDLE on INBOX, a sync on every change, a safety poll every 5 minutes, the
sweep on its interval. `scripts/sync_mail.py` still works for cron.

## 3. Requests and bookings

The public form creates a booking with status **`requested`** (not on the
calendar). `POST /bookings/<id>/accept {fields…, send_proforma?}` applies
edits, moves it to `enquiry` (calendar) and sends the proforma in the same
step; `POST /bookings/<id>/decline {reason}` → `declined`. Transitions:
`requested → enquiry | proforma_sent | declined | cancelled`,
`declined → requested | enquiry`. Bookings list bucket `requests`.

A form submitted through a convert link carries `enquiry_token`; the
request attaches to that enquiry whatever address was typed.

`GET/POST/DELETE /bookings/<id>/contacts` manage the people of a booking.

## 4. Enquiries (`/api/v1/enquiries`)

One per conversation. `reply`, `resolve`, `reopen`, `not-booking` (per
thread; nothing learned about the sender; the Enquiries label is removed),
`convert` (sends `convert_enquiry` with the form link tied by token),
`create-request {booking fields}` (Linda fills it in; `prefill` offers the
extraction), `attach {booking_id}`. Work shows open enquiries with Reply /
Convert.

## 5. Money

No global allocation queue. `bank.match_new` still auto-allocates credits
that name a booking. From the booking:
`GET /bookings/<id>/payment-search?reference=&amount=&tolerance=&from=&to=`
(defaults: the booking's reference and group words, the expected deposit /
balance / total, since a week before the enquiry) and
`POST …/payment-search/allocate {tx_id}`.

**Proof of payment** (`pop.inspect_message`, on every message attached to a
booking): genuine attachments (not inline, PDFs, images ≥ 12 KB) are stored
as documents (`kind pop|attachment`, `title`, `attachment_id`); a readable
bank PDF is parsed (bank, amount, reference, date) and allocated when
exactly one credit matches amount and reference; otherwise, and for images
or "I paid…" wording, a `pop_candidates` row waits in Work ("Verify
payment") with the search pre-filled. `GET /bookings/<id>/pops`,
`POST …/pops/<id>/allocate {tx_id}`, `…/dismiss`.

## 6. Settings › inbound

`active_days_after_visit` 14 · `form_window_hours` 24 · `sweep_interval_hours`
24 · `bounce_back_enabled` · `labels_enabled` · `archive_enabled` (off) ·
`label_bookings` · `label_enquiries` · `label_process` · `skipped_days` 7.

## 7. What this replaces (UI round to follow)

Mail page, per-thread/per-person queues, the ignored-sender list and the
Bank page are superseded; their APIs still answer so the current UI keeps
working until the screens are rebuilt. The documents keep the owner's
Excel layout (template work in the UI round).
