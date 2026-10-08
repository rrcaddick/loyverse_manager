# Booking system — build contract

This document is the single source of truth for the group-booking rebuild on
`feat/booking`. Every agent working on the branch codes against it. If you
need something that is not here, add it here first, then build it.

## 1. Goal

Replace the Gmail + Google Sheet + Excel macro workflow for group bookings with
one application: enquiry form → proforma → deposit (matched from the bank) →
invoice → vehicle ticket → visit day (Loyverse count, final invoice, gate
payment) → close. Email is the channel for all finance documents; WhatsApp is
only for the vehicle ticket (already built). Nothing sends automatically: every
outbound message is a button click, and every send is logged on the booking.

Users: `admin` (Ray, Linda) sees everything; `manager` (Marcelino) sees the
calendar and the day view (arrivals, gate payments) only.

## 2. Stack

- Backend: Flask JSON API under `/api/v1`, PyMySQL, plain SQL in models.
  WeasyPrint for PDFs. Gmail over IMAP (imapclient) and SMTP (smtplib).
  FNB transaction-history API (port of `~/repos/python/fnb/fnb_client.py`).
  Anthropic SDK for the "create booking from this email" extraction.
- Frontend: `frontend/` — Vite + React 19 + TypeScript, Tailwind v4, shadcn/ui
  (Radix), TanStack Query + Table, react-hook-form + zod, Lucide, sonner.
  Built into `web/static/app/` and served by Flask as an SPA.
- Scheduler: supercronic (existing) gains: mail sync every minute, bank poll
  every 5 minutes, reminders recompute daily, nightly DB backup.

## 3. Conventions

- Python ≥3.12, 4-space, double quotes, 88 cols, type hints on new code.
- Dates: `src.utils.date.get_today()`; never `date.today()`; never at module scope.
- Money: `Decimal` in Python, `DECIMAL(12,2)` in MySQL, numbers with 2dp in JSON.
- Logging: `setup_logger(name)`.
- SQL lives in `src/models/*`; decisions in `src/services/*`; HTTP in
  `src/clients/*`; routes in `web/api/*` do validation + orchestration only.
- `src/models/base.py` provides `query(sql, params) -> list[dict]`,
  `query_one`, `execute(sql, params) -> lastrowid/rowcount`, `transaction()`.
- Every state change on a booking writes a `booking_events` row.
- Secrets only in `config/settings.py` (from `.env`). Document new vars in
  `.env.example`.
- Outbound mail safety: when `ENV != "prod"`, `MailSender` rewrites every
  recipient to `DEV_MAIL_RECIPIENT` and prefixes the subject with
  `[DEV → original@address]`. Never bypass this.

## 4. Data model (migration `migrations/007-booking-system.sql`, owned by lead)

All tables `utf8mb4_unicode_ci`, InnoDB, `created_at`/`updated_at` TIMESTAMPs.

### users
`id, email (unique), full_name, role ENUM('admin','manager'), password_hash,
must_change_password TINYINT(1), is_active TINYINT(1), last_login_at`.

### app_settings
`setting_key VARCHAR(64) PK, value JSON, updated_by, updated_at`. The settings
service (`src/services/settings.py`, lead) merges stored values over typed
defaults and exposes `get_settings() -> Settings` (dataclass) and
`update_settings(section, data, user_id)`. Sections and defaults:

```
season:     start "2026-10-31", end "2027-04-30",
            closed_weekdays [0,1] (Mon,Tue), avoid_weekdays [2],
            no_discount_start "12-13", no_discount_end "01-11"   (MM-DD)
pricing:    public_weekend_price 115.00, peak_price 130.00, vat_rate 15
deposit:    min_people 40, percent 30
documents:  next_number 1703, proforma_prefix "FY", invoice_prefix "INV",
            company_name "The Farmyard Park (Pty) Ltd",
            address "Protea Road, Klapmuts, 7625", company_reg "2020/752714/07",
            vat_no "4780 308 575", bank_name "FNB", bank_account_name "The Farmyard Park",
            bank_account_type "Current Account", bank_account_number "62871182764",
            pop_email "<bookings mailbox>"
reminders:  still_interested_days 7, deposit_reminder_days_before 14,
            final_details_days_before 3, lapse_days_before 7
capacity:   daily_warning_people 1000
email:      sender_name "The Farmyard Park", signature_name "Linda Caddick",
            signature_title "Director", signature_company "The Farmyard Park (Pty) Ltd",
            phone "081 461 4246", website "www.farmyardpark.co.za",
            bounce_back_enabled true, review_window_days 14
form:       group_types [school, creche, church, nonprofit, family, corporate, pensioners, other]
            (code → label + default tier code), max_questions 5
```

### price_tiers
`id, code (unique), label, day_type ENUM('weekday','weekend'), price DECIMAL(12,2),
min_group_size INT, notes, sort_order, is_active`. Seeded from the 2026/27 price
policy (see §9).

### season_days
`day DATE PK, kind ENUM('closed','peak','open'), label`. Seeded: closed
2026-12-24, 2026-12-31, 2027-03-26; peak 2026-12-25, 2026-12-26, 2027-01-01..03.

### bookings
```
id, reference VARCHAR(16) UNIQUE   -- "FY1703", assigned on creation
doc_number INT UNIQUE               -- 1703; proforma FY1703, invoice INV1703
status ENUM('enquiry','proforma_sent','confirmed','completed','cancelled','lapsed','no_show')
group_name, group_type VARCHAR(32), area, contact_name, contact_email, contact_mobile (E164 digits, no +)
visit_date DATE, alternative_date DATE NULL, arrival_time VARCHAR(20) NULL
people_booked INT (visitors; the public field is `visitors`), vehicles INT, gazebos INT
(adults/children columns remain but are unused: a booking counts visitors only; school parents
pay at the gate through Loyverse and are not part of the booking)
price_tier_code VARCHAR(32) NULL, price_per_person DECIMAL(12,2),
price_overridden TINYINT(1), price_override_reason VARCHAR(255) NULL
deposit_due DECIMAL(12,2), deposit_overridden TINYINT(1), deposit_waived TINYINT(1),
deposit_override_reason VARCHAR(255) NULL
arrived_count INT NULL, arrived_source ENUM('loyverse','manual') NULL, arrived_at DATETIME NULL
barcode VARCHAR(64) UNIQUE          -- EAN-13, src/services/barcode.py
source ENUM('form','email','import','manual')
enquiry_date DATE, hold_expires_on DATE NULL
customer_notes TEXT NULL, internal_notes TEXT NULL
email_thread_id BIGINT NULL         -- Gmail X-GM-THRID of the primary thread
proforma_sent_at, invoice_sent_at, final_invoice_sent_at, ticket_sent_at (WhatsApp),
ticket_emailed_at, confirmed_at, completed_at, cancelled_at, lapsed_at  (DATETIME NULL)
legacy_sheet_row JSON NULL, created_by INT NULL
```
Computed in the service, never stored: `total_amount = people_booked × price`,
`paid_total = Σ payments`, `balance_due`, `final_amount = arrived_count × price`.

### booking_questions
`id, booking_id, question TEXT, answer TEXT NULL, answered_at, answered_by, sort_order`.

### booking_events
`id, booking_id, kind VARCHAR(40), summary VARCHAR(255), data JSON NULL,
actor_user_id INT NULL, created_at`. Kinds: created, updated, status_changed,
override, note, document_issued, email_sent, email_received, email_failed,
payment_recorded, payment_matched, payment_deleted, payment_unmatched, ticket_sent,
arrivals_recorded, reminder_dismissed.

### documents
`id, booking_id, kind ENUM('proforma','invoice','final_invoice'), number VARCHAR(20),
version INT, file_path VARCHAR(255), total DECIMAL, paid DECIMAL, due DECIMAL,
snapshot JSON, issued_at, issued_by, email_message_id INT NULL`.
Files live under `data/documents/<booking_id>/<number>-v<version>.pdf`
(`DATA_DIR` setting, a docker volume).

### payments
`id, booking_id, kind ENUM('eft','cash','card','other'), amount DECIMAL(12,2),
paid_on DATE, reference VARCHAR(120), bank_transaction_id INT NULL UNIQUE,
note, recorded_by, created_at`.

### bank_transactions
`id, fingerprint VARCHAR(64) UNIQUE, account_number, entry_id, booking_date,
value_date, description, end_to_end_id, amount DECIMAL(12,2), credit_debit,
balance_after DECIMAL(14,2), raw JSON, first_seen_at,
match_status ENUM('unmatched','suggested','matched','ignored'),
matched_booking_id INT NULL, matched_at, matched_by, match_method VARCHAR(30),
suggestions JSON NULL, ignore_reason`.

### bank_poll_log
`id, started_at, finished_at, window_from, window_to, entries, new_entries, status, error`.

### email_messages
```
id, gmail_msgid BIGINT UNIQUE, gmail_thrid BIGINT, gmail_uid INT, folder VARCHAR(40)
message_id_header VARCHAR(255), in_reply_to VARCHAR(255), references_header TEXT
direction ENUM('inbound','outbound'), kind VARCHAR(40) NULL   -- outbound kinds, see §7
from_name, from_email, to_emails JSON, cc_emails JSON, subject, sent_at DATETIME
snippet VARCHAR(255), body_text MEDIUMTEXT, body_html MEDIUMTEXT, has_attachments
booking_id INT NULL, match_method VARCHAR(30) NULL
review_status ENUM('none','pending','resolved','not_booking') DEFAULT 'none'
resolved_by, resolved_at, is_auto_generated TINYINT(1), bounce_back_sent_at
send_status ENUM('sent','failed') NULL, send_error TEXT NULL, sent_by INT NULL
attachments_meta JSON NULL
```
### email_attachments
`id, email_message_id, filename, content_type, size_bytes, file_path`.
### bounce_backs
`sender_email PK, last_sent_at`.
### mail_sync_state
`folder PK, uidvalidity, last_uid, last_synced_at`.
### booking_reminders
`id, booking_id, kind ENUM('still_interested','deposit_reminder','final_details','lapse'),
due_on DATE, status ENUM('due','sent','dismissed'), dismissed_by, dismissed_at,
UNIQUE(booking_id, kind)`.
### form_submissions
`id, booking_id, payload JSON, ip, user_agent, turnstile_ok, created_at`.
### import_runs
`id, kind, started_at, finished_at, summary JSON, status`.

`group_bookings` (legacy) is migrated into `bookings` by the migration and no
longer written. `GroupBooking` becomes a read adapter over `bookings` so the
existing ticket PDF, WhatsApp send and morning sync keep working. The morning
sync takes **confirmed** bookings only.

## 5. Status machine and rules

```
enquiry ──send proforma──▶ proforma_sent ──deposit matched/recorded or waived+confirm──▶ confirmed
   │                             │                                                      │
   ├──cancel──▶ cancelled        ├──hold expires──▶ lapsed (button, suggested by queue)  ├──visit day: arrivals recorded──▶ completed
   └──(any)                      └──cancel──▶ cancelled                                 └──no arrivals after date──▶ no_show
```
- `confirm` happens when `paid_total ≥ deposit_due`, or deposit waived + admin
  clicks Confirm. Admin can also Confirm manually with a reason.
- Reopen: cancelled/lapsed → enquiry (admin).
- `hold_expires_on = visit_date − reminders.lapse_days_before`, editable.
- Day type: `weekend` if Sat/Sun or SA public holiday (`src/utils/holidays.py`),
  else `weekday`. In the no-discount window group tiers are unavailable: price
  defaults to `public_weekend_price`, peak days to `peak_price`.
- Deposit: `max(min_people × price, round(people × percent/100) × price)`,
  capped at `total_amount`; 0 when waived. Overrides are explicit flags with a
  reason and are preserved on recalculation.
- Price and deposit recalculate when people/date/tier change **unless** overridden.
- Document numbers: `doc_number` is taken from `documents.next_number` at booking
  creation inside a transaction and the setting is incremented. Imported rows
  keep their sheet number when present.

## 6. API (`/api/v1`, JSON)

Errors: `{"error": {"code": "validation_error", "message": "...", "fields": {"visit_date": "..."}}}`
with 400/401/403/404/409/422/500. Lists: `{"items": [...], "total": n, "page": p, "page_size": s}`.
Auth is the Flask session cookie. All non-GET requests must send `X-CSRF-Token`
(value from `GET /auth/session`). Public/bridge endpoints are exempt.

Helpers in `web/api/__init__.py` (lead): `api_bp`, `ok(data, status=200)`,
`fail(code, message, status, fields=None)`, `require_role(*roles)`,
`current_user()`, `parse_json(schema)`; `ApiError` exception → JSON.

| Area | Endpoints | Owner |
| --- | --- | --- |
| auth | `GET /auth/session`, `POST /auth/login {email,password}`, `POST /auth/logout`, `POST /auth/change-password` | lead |
| users | `GET /users`, `POST /users`, `PATCH /users/:id`, `POST /users/:id/reset-password` → temp password | lead |
| settings | `GET /settings`, `PUT /settings/:section`, `GET/PUT /settings/price-tiers`, `GET/PUT /settings/season-days` | lead |
| bookings | `GET /bookings?status&from&to&q&page&page_size&sort`, `GET /bookings/counts`, `POST /bookings`, `GET /bookings/:id`, `PATCH /bookings/:id`, `POST /bookings/:id/status {status, reason}`, `POST /bookings/:id/notes {text}`, `POST /bookings/:id/questions {question}`, `POST /bookings/:id/questions/:qid {answer}`, `POST /bookings/:id/payments`, `DELETE /bookings/:id/payments/:pid`, `GET /bookings/:id/arrivals` (Loyverse fetch), `POST /bookings/:id/arrivals {count, source}`, `GET /bookings/:id/events`, `GET /bookings/:id/emails` | bookings agent |
| booking actions | `POST /bookings/:id/actions/<action>` where action ∈ `send-acknowledgement, issue-proforma, send-proforma, send-invoice, send-final-invoice, send-ticket-email, send-ticket-whatsapp, send-payment-confirmation, send-reminder {kind}, send-expiry, send-answers, confirm {reason}`; `POST /bookings/:id/emails/reply {subject?, body_html, attach_document_ids[]}` | bookings agent (orchestrates services from documents + mail agents) |
| documents | `GET /documents/:id/pdf`, `GET /bookings/:id/documents`, `POST /bookings/:id/documents/preview {kind}` → PDF bytes | documents agent |
| calendar | `GET /calendar?from&to` → `{days:[{date, day_type, is_closed, is_avoid, is_peak, label, total_people, confirmed_people, tentative_people, capacity_warning, bookings:[{id,reference,group_name,status,people_booked,group_type}]}]}`; `GET /days/:date` (manager-allowed) → bookings with arrivals/payments summary | bookings agent |
| inbox | `GET /inbox/messages?view=review|all|unmatched&q&page`, `GET /inbox/messages/:id`, `GET /inbox/threads/:thrid`, `GET /inbox/messages/:id/suggestions`, `POST /inbox/messages/:id/attach {booking_id, whole_thread}`, `POST /inbox/messages/:id/detach`, `POST /inbox/messages/:id/resolve {status}`, `POST /inbox/messages/:id/extract` → draft booking fields, `POST /inbox/messages/:id/bounce-back`, `GET /inbox/attachments/:id` (download), `POST /inbox/sync`, `POST /inbox/compose {to, subject, body_html, booking_id?}` | mail agent |
| payments | `GET /payments/bank-transactions?status&from&to&q&page`, `GET /payments/bank-transactions/:id`, `POST /payments/bank-transactions/:id/match {booking_id}`, `POST /payments/bank-transactions/:id/unmatch`, `POST /payments/bank-transactions/:id/ignore {reason}`, `POST /payments/sync`, `GET /payments/summary` | payments agent |
| queue | `GET /queue` → sections (§8), `POST /reminders/:id/dismiss` | ops agent |
| ops | `POST /ops/run {name}` (existing scripts), `GET /ops/status` (last mail sync, last bank poll, scheduler health) | ops agent |
| public | `GET /public/form-config`, `POST /public/booking-request` | ops agent |
| legacy | `/group-bookings/ticket/image/<barcode>` (public, JWT), `/open_tickets/*`, `/api/stock/*`, `/api/groups` unchanged | do not touch |

## 7. Services and interfaces (so agents can build in parallel)

```python
# src/services/settings.py (lead)
get_settings() -> Settings            # dataclass with .season .pricing .deposit .documents .reminders .capacity .email .form
update_settings(section: str, data: dict, user_id: int | None) -> Settings
next_document_number() -> int         # atomic increment

# src/services/pricing.py (bookings agent)
day_type(d: date, s: Settings) -> Literal["weekday","weekend"]
is_closed(d, s) / is_avoid(d, s) / is_peak(d, s) / in_no_discount_window(d, s)
default_price(tier_code: str | None, d: date, s: Settings) -> Decimal
deposit_for(people: int, price: Decimal, s: Settings) -> Decimal

# src/services/booking.py (bookings agent)
create_booking(data: dict, source: str, actor: int | None) -> Booking   # assigns reference/doc_number/barcode, computes price/deposit
update_booking(booking_id, data, actor) -> Booking
set_status(booking_id, status, actor, reason=None) -> Booking
record_payment(booking_id, kind, amount, paid_on, reference, note, actor, bank_transaction_id=None) -> Payment   # auto-confirms when deposit covered
booking_finance(booking) -> dict      # total_amount, deposit_due, paid_total, balance_due, final_amount
add_event(booking_id, kind, summary, data=None, actor=None)
calendar_days(from_date, to_date) -> list[dict]

# src/services/documents.py (documents agent)
issue_document(booking_id, kind, actor) -> Document        # renders PDF, stores file, writes event
render_document_pdf(booking, kind, settings) -> bytes       # no side effects (preview)

# src/services/email_templates.py (documents agent)
@dataclass RenderedEmail: subject: str; html: str; text: str
render_email(kind: str, booking: Booking | None, settings: Settings, **ctx) -> RenderedEmail
#   kinds: acknowledgement, proforma, invoice, final_invoice, ticket, payment_confirmation,
#          still_interested, deposit_reminder, final_details, expiry, answers, bounce_back, reply(custom body)

# src/services/mail_send.py (mail agent)
send_email(*, to: list[str], rendered: RenderedEmail, attachments: list[tuple[str, bytes, str]] = (),
           booking_id: int | None, kind: str, actor: int | None, thread_message_id: str | None = None) -> EmailMessage
#   builds MIME (text+html alt, attachments), threads via In-Reply-To/References, sends over Gmail SMTP,
#   stores an outbound email_messages row + booking event; applies the dev recipient rewrite.

# src/services/mail_ingest.py (mail agent)
sync_mailbox(full: bool = False) -> dict                   # IMAP incremental sync of INBOX + Sent, then match_unlinked()
match_message(msg) -> tuple[int | None, str | None]         # (booking_id, method): reference > thread > email > phone
suggest_bookings(msg) -> list[dict]

# src/services/extraction.py (mail agent)
extract_booking_fields(text: str) -> dict                   # Anthropic; returns the form's field names; empty dict if no key

# src/services/bank.py (payments agent)
poll_transactions() -> dict                                  # FNB window poll, fingerprint upsert, then match_new()
match_transaction(tx) -> MatchResult                         # strong (reference), suggested (amount+name), none
confirm_match(tx_id, booking_id, actor) -> Payment           # creates payment via booking.record_payment

# src/services/arrivals.py (bookings agent)
fetch_loyverse_arrivals(booking) -> int                     # receipts on visit_date whose line sku == barcode

# src/services/reminders.py (ops agent)
recompute_reminders() -> int                                 # fills booking_reminders from settings + booking state
build_queue() -> dict                                        # §8

# src/services/tickets.py (bookings agent) — wraps existing pdf.generate_ticket_pdf and the Chatwoot send
```

Outbound email kinds and what they carry:

| kind | when | attachments |
| --- | --- | --- |
| acknowledgement | after a form submission is reviewed, or on demand | none |
| proforma | proforma issued | proforma PDF |
| invoice | deposit received | invoice PDF (shows deposit, balance) |
| final_invoice | after arrivals recorded | final invoice PDF |
| ticket | vehicle ticket by email | ticket PDF |
| payment_confirmation | payment recorded/matched | none (or invoice) |
| still_interested | follow-up on unpaid proforma | proforma PDF |
| deposit_reminder | deposit due before visit | proforma PDF |
| final_details | days before visit | ticket PDF if not yet emailed |
| expiry | hold lapsed | none |
| answers | reply to the customer's questions | none |
| bounce_back | unknown sender, form link | none |
| reply | free-text reply from the thread view | optional documents |

Wording: professional, warm, concise; British English; "The Farmyard Park";
signature from settings.email. All HTML emails share one responsive layout
(`web/templates/emails/base.html`, table-based, inline CSS via css_inline),
logo at top, document summary card, clear call to action, footer with
address, VAT no and the bookings address.

## 8. Action queue (`GET /queue`)

Sections, each `{key, title, count, items:[...]}`:
`needs_reply` (bookings whose latest message is inbound and newer than the last
outbound), `unmatched_emails` (review_status pending), `new_requests`
(status enquiry, no proforma), `payments_to_confirm` (bank transactions
suggested), `unmatched_credits` (unmatched credits in the last 30 days),
`reminders_due` (grouped by kind), `tickets_to_send` (confirmed, no ticket),
`visits_this_week`, `arrivals_to_record` (confirmed, visit_date ≤ today, no
arrivals), `lapsing` (hold_expires_on ≤ today + 3, unpaid).

## 9. Seeds (migration)

Price tiers 2026/27 (code, label, day_type, price, min size):
`school_weekday` Schools & children's groups weekday 70 (incl. teachers);
`adult_small_weekday` Approved adult groups under 40 weekday 95;
`adult_large_weekday` Approved adult groups 40+ weekday 90;
`pensioners_weekday` Pensioner groups weekday 90;
`church_weekend` Church & approved groups 40+ weekend 95 (min 40);
`nonprofit_kids_weekend` Non-profit kids & youth 40+ weekend 95 (min 40);
`nonprofit_adults_weekend` Non-profit adults & families 40+ weekend 100 (min 40);
`public_weekend` Public weekend 115; `peak` Peak days 130.
Group type → default tier: school→school_weekday / nonprofit_kids_weekend,
creche→school_weekday / nonprofit_kids_weekend, church→adult_large_weekday /
church_weekend, nonprofit→adult_large_weekday / nonprofit_adults_weekend,
family→adult_small_weekday / nonprofit_adults_weekend, corporate→
adult_small_weekday / public_weekend, pensioners→pensioners_weekday /
public_weekend, other→adult_small_weekday / public_weekend (weekday / weekend).

Users seeded by `scripts/create_user.py`, not the migration.

## 10. Frontend

Routes (role in brackets): `/login`, `/change-password`, `/` queue [admin],
`/calendar` [admin, manager], `/day/:date` [admin, manager], `/bookings`
[admin], `/bookings/:id` [admin], `/inbox` [admin], `/inbox/:messageId` [admin],
`/payments` [admin], `/settings/*` [admin], `/users` [admin], `/ops` [admin],
`/request` + `/request/sent` [public].

Design system (lead, `frontend/src/styles/tokens.css` + shadcn theme): ink and
paper neutrals derived from the monochrome logo, one accent (deep oak green)
for primary and confirmed, amber for tentative/pending, red for danger, light
and dark themes from one token set, Inter for UI, tabular numerals for money
and counts, 4px spacing grid, 8px radius, no drop-shadow soup. Calendar heat
scale: a single-hue sequential ramp with the dataviz skill's validator.

## 11. File ownership during the parallel build

| Owner | Paths |
| --- | --- |
| lead | `config/`, `migrations/`, `web/app.py`, `web/api/__init__.py`, `web/api/auth.py`, `web/api/users.py`, `web/api/settings.py`, `src/models/base.py`, `src/models/user.py`, `src/services/settings.py`, `src/services/users.py`, `frontend/` scaffold, `Dockerfile`, `compose*.yaml`, `docker/`, `docs/`, `requirements/` |
| bookings agent | `src/models/booking.py`, `src/models/booking_event.py`, `src/models/booking_question.py`, `src/models/payment.py` (model only), `src/services/pricing.py`, `src/services/booking.py`, `src/services/arrivals.py`, `src/services/tickets.py`, `src/utils/holidays.py`, `web/api/bookings.py`, `web/api/calendar.py`, `src/models/group_booking.py` (adapter), `scripts/add_inventory.py` (confirmed filter only) |
| documents agent | `src/models/document.py`, `src/services/documents.py`, `src/services/email_templates.py`, `web/templates/documents/*`, `web/templates/emails/*`, `web/api/documents.py`, `web/static/brand/*` |
| mail agent | `src/clients/gmail.py`, `src/models/email_message.py`, `src/services/mail_send.py`, `src/services/mail_ingest.py`, `src/services/extraction.py`, `web/api/inbox.py`, `scripts/sync_mail.py`, `scripts/import_mail.py` |
| payments agent | `src/clients/fnb.py`, `src/models/bank_transaction.py`, `src/services/bank.py`, `web/api/payments.py`, `scripts/poll_bank.py` |
| ops agent | `src/services/reminders.py`, `web/api/queue.py`, `web/api/ops.py`, `web/api/public.py`, `scripts/import_sheet.py`, `scripts/create_user.py`, `scripts/backup_db.sh`, `scripts/recompute_reminders.py`, `src/services/public_form.py` (validation, turnstile, rate limit) |

Do not edit another owner's files; if you need a change there, write it in
`docs/handoff/<your-name>.md` and the lead integrates. Never touch
`web/routes/open_tickets.py`, `web/routes/stock.py`, `web/routes/bridge_auth.py`,
`src/models/open_ticket.py` (the bridge session owns them on another branch).

## 15. Redesign additions (October 2026)

The redesign (`docs/redesign-spec.md`) added these surfaces; their exact JSON
shapes live in the handoff notes named here, which are authoritative.

| Area | Endpoints | Handoff |
| --- | --- | --- |
| Today and Work | `GET /today?date=` (manager-allowed, money and work stripped), `GET /work?view=`, `GET /work/counts`, `POST /work/reminders/dismiss`, `POST /work/holds/:id/extend`, `PUT /users/me/preferences` | `docs/handoff/work-today.md` |
| Conversations | `GET /inbox/conversations?view=needs_reply|unmatched|waiting|done|all`, `GET /inbox/conversations/:thrid`, `POST …/done|reopen|not-booking|attach|detach|notes|reply`, `GET …/suggestions`, `GET /bookings/:id/conversation`, `GET /inbox/messages/:id/original`, `GET /inbox/templates` | `docs/handoff/mail-v2.md` |
| Bank | `GET /payments/bank-transactions?view=needs_attention|matched|all` (suggestions carry a confidence sentence), `POST …/ignore {reason, create_rule}`, `GET/POST/DELETE /payments/ignore-rules`, unmatch reverts `confirmed → proforma_sent` | `docs/handoff/backend-v2-misc.md` |
| Bookings | `GET /bookings/counts` buckets, `?bucket=`, billing fields | `docs/handoff/backend-v2-misc.md` |
| Public form | `visitors`, `arrival_time` slots, `POST /public/booking-request` → `{id, token}`, `GET /public/requests/:id?token=`, acknowledgement toggle | `docs/handoff/backend-v2-misc.md` |
| Gate | `GET /gate` (manager-allowed) | `docs/handoff/backend-v2-misc.md` |

Schema: migrations 008 (email_threads, quote-split columns, `booking_reminders.stale`,
`users.theme`) and 009 (`users.preferences`, `bookings.billing_address`,
`bookings.customer_vat_number`, `bank_ignore_rules`). Documents: the deposit-stage
document is a **Statement** (`FY1703-S`, not a tax invoice); the final document is the
only **Tax invoice** (`INV1703`). A booking counts **visitors** only.
