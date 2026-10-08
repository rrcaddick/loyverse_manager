# Bookings agent — handoff

The booking core: pricing rules, the status machine, the `bookings` service and
models, arrivals from Loyverse, ticket delivery, the `GroupBooking` read adapter,
and the `/bookings`, `/calendar`, `/days` API including every send action.
Built against `docs/booking-system.md` §4–§7 and the documents agent's handoff
(`docs/handoff/documents.md`).

## Files owned

| Path | What |
| --- | --- |
| `src/utils/holidays.py` | SA public holidays for any year (`public_holidays(year)`, `is_public_holiday(d)`, `holiday_name(d)`); Easter computed, Sunday → Monday observance |
| `src/services/pricing.py` | `day_type`, `is_closed`, `is_avoid`, `is_peak`, `in_no_discount_window`, `default_tier_for`, `effective_tier`, `default_price`, `deposit_for`, `hold_expiry_for`, `load_season_days` |
| `src/models/booking.py` | SQL for `bookings`: `insert`, `update_fields`, `get`, `get_by_reference`, `get_by_barcode`, `list_bookings` (filters + paging + sort), `list_by_date_range`, `list_for_date`, `counts_by_status`, `serialize`, `delete` (tests only) |
| `src/models/booking_event.py` | `add`, `list_for_booking` (joins actor name) |
| `src/models/booking_question.py` | `add`, `answer`, `get`, `list_for_booking` |
| `src/models/payment.py` | `insert`, `get`, `list_for_booking`, `latest_for_booking`, `sum_for_booking`, `delete` |
| `src/services/booking.py` | all the rules — see "Service API" |
| `src/services/arrivals.py` | `fetch_loyverse_arrivals(booking) -> int`, `ArrivalsError`, pure `count_arrivals`, `sast_day_bounds_utc` |
| `src/services/tickets.py` | `ticket_pdf_bytes(row)`, `ticket_jpeg_bytes`, `ticket_filename`, `ticket_image_url(barcode)`, `send_ticket_whatsapp(booking_id, actor)`, `TicketError` |
| `src/models/group_booking.py` | **rewritten** as a read-only adapter over `bookings` (`from_row`, `get_by_barcode`, `get_by_id`, `get_by_date` → confirmed/completed only). `create`/`update`/`delete`/`save` are gone |
| `scripts/add_inventory.py` | one comment only; behaviour unchanged (now syncs confirmed bookings only via the adapter) |
| `web/api/bookings.py` | `bp = make_blueprint("bookings", "/bookings")` |
| `web/api/calendar.py` | `bp = make_blueprint("calendar", "")` → `/calendar`, `/days/<date>` |
| `tests/bookings/` | 110 pytest tests (holidays, pricing, deposit, validation, transitions, calendar roll-up, arrivals counting, DB round trip) |

Run: `PYTHONPATH=. .venv/bin/python -m pytest tests/bookings -q` (the package is not pip-installed into
`.venv`, so `PYTHONPATH=.` is needed). `test_booking_db.py` skips when MySQL is unreachable; it
creates `TEST pytest …` bookings and deletes them.

## Service API (`src/services/booking.py`)

All functions take/return plain dict rows with native types (Decimal, date). Errors:
`BookingError(message, fields)` (→ 422), `BookingNotFound` (→ 404), `InvalidTransition` (→ 409).

```python
create_booking(data: dict, source: "form|email|import|manual", actor: int | None, doc_number: int | None = None) -> row
update_booking(booking_id, data, actor) -> row          # recalculates price/deposit unless overridden
set_status(booking_id, status, actor, reason=None) -> row
record_payment(booking_id, kind, amount, paid_on, reference, note, actor, bank_transaction_id=None) -> payment dict
delete_payment(booking_id, payment_id, actor)            # refuses payments with bank_transaction_id (unmatch instead)
booking_finance(row, paid_total=None, settings=None) -> dict of Decimals (see "finance" below)
add_event(booking_id, kind, summary, data=None, actor=None, conn=None) -> id
stamp(booking_id, "<column>_at")                         # sets a *_at column to now (SAST)
add_question(booking_id, question, actor) / answer_question(booking_id, qid, answer, actor)
add_note(booking_id, text, actor)                        # a "note" event; internal_notes column is untouched
record_arrivals(booking_id, count, "loyverse|manual", actor) -> row   # confirmed + count>0 → completed
calendar_days(from_date, to_date) -> list[day]           # see "Calendar day shape"
day_detail(d) -> dict                                    # see "Day view shape"
get_booking_detail(booking_id, settings=None) -> dict    # see "Booking detail shape"
latest_document(booking_id, kind=None) -> raw documents row | None
latest_message_id_header(row) -> str | None              # for threading
mark_reminder_sent(booking_id, kind)                     # booking_reminders due → sent
check_transition(current, new, visit_date, today) / allowed_transitions(...)
validate_booking_data(data, partial=..., settings=...) -> cleaned dict
normalise_mobile("082 123 4567") -> "27821234567"; normalise_email(...) -> lowercased
```

### Accepted booking fields (POST / PATCH)

`group_name*`, `group_type` (code from `settings.form.group_types`), `area`, `contact_name*`,
`contact_email` (lowercased, validated), `contact_mobile` (any ZA format → E.164 digits, no `+`),
`visit_date*` (YYYY-MM-DD), `alternative_date`, `arrival_time`, `adults`, `children`,
`people_booked` (defaults to adults+children; must be ≥1 unless source is `import`), `vehicles`,
`gazebos`, `price_tier_code` (must exist in `price_tiers`), `price_per_person`, `price_overridden`,
`price_override_reason`, `deposit_due`, `deposit_overridden`, `deposit_waived`,
`deposit_override_reason`, `hold_expires_on`, `customer_notes`, `internal_notes`, `enquiry_date`,
`email_thread_id`. Create-only: `questions: [str]`, `status`, `doc_number`, `legacy_sheet_row: {}`,
`arrived_count` (+`arrived_source`, `arrived_at`), and any `*_at` stamp (for imports). Unknown keys are
ignored. `*` = required on create.

### Pricing and overrides

- Tier: `price_tier_code` if given, else the group type's weekday/weekend tier (`day_type` = weekend
  on Sat/Sun/public holiday). The **stored** `price_tier_code` is the *effective* tier: `peak` on
  peak days, `public_weekend` inside the no-discount window.
- Price: `peak_price` on peak days; `public_weekend_price` in the window unless the tier is
  public/peak; otherwise the tier's table price; unknown/no tier → public price.
- An explicit `price_per_person` that differs from the computed price sets `price_overridden=1`
  (reason from `price_override_reason`); equal to the default → not an override. `price_overridden:
  false` clears it and recomputes. Same pattern for `deposit_due`/`deposit_overridden`.
  `deposit_waived: true` → `deposit_due = 0`.
- Recalculation on PATCH: tier re-derived when `visit_date`/`group_type` change (or a tier is given);
  price recomputed unless overridden; deposit recomputed unless overridden/waived. `hold_expires_on`
  moves with `visit_date` unless sent explicitly.
- Deposit: `max(min_people × price, round_half_up(people × percent/100) × price)` capped at total.
- `doc_number`: `next_document_number()` unless given (imports); a given number must be unused and
  bumps the counter past itself. Reference = `documents.proforma_prefix + doc_number`.

### Status machine

```
enquiry        → proforma_sent, confirmed, cancelled, lapsed
proforma_sent  → confirmed, cancelled, lapsed
confirmed      → completed, cancelled, no_show (only when visit_date < today)
cancelled      → enquiry (reopen; clears cancelled_at/lapsed_at)
lapsed         → enquiry
completed, no_show → (none)
```
`set_status` stamps `proforma_sent_at / confirmed_at / completed_at / cancelled_at / lapsed_at` and writes a
`status_changed` event `{from, to, reason}`. Auto transitions: `record_payment` → confirmed when
`paid_total ≥ deposit_due` (and > 0) from enquiry/proforma_sent; `record_arrivals` (count > 0) →
completed from confirmed; `send-proforma` → proforma_sent from enquiry; `send-expiry` → lapsed.

### Events written

`created` (data: source, status, price, deposit, tier), `updated` (`{"changes": {field: {from, to}}}`),
`override` (price/deposit override set or cleared, with reasons), `status_changed`, `note`
(`{"text"}`), `payment_recorded`, **`payment_deleted`** (new kind, not in §4's list), `arrivals_recorded`,
`ticket_sent` (WhatsApp). Questions added/answered write `updated` events. `document_issued` and
`email_sent/failed` come from the documents and mail services.

## Endpoints (`/api/v1`, admin unless marked)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/bookings?status&from&to&q&page&page_size&sort` | — | `{items:[list item], total, page, page_size}` |
| GET | `/bookings/counts` | — | `{counts: {enquiry: n, ...}}` |
| POST | `/bookings` | booking fields (+`source`, default `manual`) | 201 detail |
| GET | `/bookings/:id` **(manager ok)** | — | detail |
| PATCH | `/bookings/:id` | any booking fields | detail |
| POST | `/bookings/:id/status` | `{status, reason?}` | detail (409 `invalid_transition`) |
| POST | `/bookings/:id/notes` | `{text}` | detail |
| POST | `/bookings/:id/questions` | `{question}` | detail |
| POST | `/bookings/:id/questions/:qid` | `{answer}` | detail |
| POST | `/bookings/:id/payments` **(manager: cash/card only)** | `{kind: eft\|cash\|card\|other, amount, paid_on?, reference?, note?, bank_transaction_id?}` | detail |
| DELETE | `/bookings/:id/payments/:pid` | — | detail (422 if bank-linked) |
| GET | `/bookings/:id/arrivals` **(manager ok)** | — | `{booking_id, visit_date, count, source:"loyverse", recorded_count, recorded_source}` (502 `loyverse_unavailable`) |
| POST | `/bookings/:id/arrivals` **(manager ok)** | `{count, source?: loyverse\|manual}` | detail |
| GET | `/bookings/:id/events` | — | `{items:[event]}` |
| GET | `/bookings/:id/emails` | — | `{items:[email]}` |
| POST | `/bookings/:id/actions/<action>` | per action | detail + `action`, `action_result` |
| POST | `/bookings/:id/emails/reply` | `{body_html, subject?, attach_document_ids?: [int]}` | detail + `action: "reply"`, `action_result` |
| GET | `/calendar?from&to` **(manager ok)** | — | `{from, to, days:[day]}` (default: 1st of this month, 42 days; max 400) |
| GET | `/days/:date` **(manager ok)** | — | day view |

`status` accepts a comma list and the aliases `active` (enquiry, proforma_sent, confirmed, completed),
`tentative`, `firm`. `q` searches reference, group_name, contact_name, contact_email, contact_mobile,
area. `sort` ∈ `visit_date, created_at, updated_at, enquiry_date, reference, group_name, status,
people_booked, hold_expires_on`, prefix `-` for descending; default `-visit_date`.

Validation errors are `422 {"error": {"code": "validation_error", "message", "fields": {field: msg}}}`.
Phone numbers are normalised to `27821234567`; emails lowercased.

### List item shape
Every `bookings` column (Decimals as floats, dates as `YYYY-MM-DD`, datetimes as ISO seconds,
`price_overridden/deposit_overridden/deposit_waived` as booleans) plus `paid_total`, `total_amount`,
`balance_due`, `deposit_covered`, `status_label`.

### Booking detail shape (every detail/action response)

```jsonc
{
  // all bookings columns, serialised as above ...
  "id": 91, "reference": "FY1781", "doc_number": 1781, "status": "confirmed",
  "group_name": "...", "group_type": "school", "area": null,
  "contact_name": "...", "contact_email": "jane@example.com", "contact_mobile": "27821234567",
  "visit_date": "2026-11-12", "alternative_date": null, "arrival_time": null,
  "adults": 5, "children": 50, "people_booked": 55, "vehicles": 0, "gazebos": 0,
  "price_tier_code": "school_weekday", "price_per_person": 70.0,
  "price_overridden": false, "price_override_reason": null,
  "deposit_due": 2800.0, "deposit_overridden": false, "deposit_waived": false, "deposit_override_reason": null,
  "arrived_count": null, "arrived_source": null, "arrived_at": null,
  "barcode": "2009864589605", "source": "manual", "enquiry_date": "2026-10-08", "hold_expires_on": "2026-11-05",
  "customer_notes": null, "internal_notes": null, "email_thread_id": null,
  "proforma_sent_at": "2026-10-08T16:30:51", "invoice_sent_at": null, "final_invoice_sent_at": null,
  "ticket_sent_at": null, "ticket_emailed_at": null,
  "confirmed_at": null, "completed_at": null, "cancelled_at": null, "lapsed_at": null,
  "legacy_sheet_row": null, "created_by": 1, "created_at": "...", "updated_at": "...",

  // added by the service
  "status_label": "Confirmed",
  "allowed_transitions": ["completed", "cancelled"],       // valid targets for POST /status today
  "day_type": "weekday", "is_peak": false, "in_no_discount_window": false,
  "finance": {
    "price_per_person": 70.0, "people_booked": 55, "total_amount": 3850.0,
    "vat_amount": 502.17, "vat_rate": 15.0,
    "deposit_due": 2800.0, "deposit_waived": false, "paid_total": 2800.0,
    "deposit_outstanding": 0.0, "deposit_covered": true,
    "balance_due": 1050.0,                                  // against final_amount once arrivals exist
    "arrived_count": null, "final_amount": null, "final_vat_amount": null
  },
  "questions": [{"id", "booking_id", "question", "answer", "answered_at", "answered_by", "answered_by_name", "sort_order", "created_at"}],
  "payments":  [{"id", "booking_id", "kind", "amount", "paid_on", "reference", "bank_transaction_id", "note", "recorded_by", "recorded_by_name", "created_at"}],
  "events":    [{"id", "booking_id", "kind", "summary", "data", "actor_user_id", "actor_name", "created_at"}],   // oldest first
  "documents": [{"id", "booking_id", "kind", "number", "version", "file_path", "total", "paid", "due", "issued_at", "issued_by", "email_message_id", "label", "filename"}],  // newest first (documents service)
  "emails":    [{"id", "direction", "kind", "subject", "from_name", "from_email", "to_emails", "sent_at", "snippet", "has_attachments", "send_status", "send_error", "gmail_thrid", "message_id_header"}],  // oldest first
  "reminders": [{"id", "booking_id", "kind", "due_on", "status", "dismissed_by", "dismissed_at", "created_at", "updated_at"}]
}
```
Action responses add `"action": "<name>"` and `"action_result"` (e.g. `{email_message_id, kind, to,
subject}`, plus `document` for document actions, `reminder_kind`, or the WhatsApp
`{success, conversation_id, message_id, to}`).

### Calendar day shape (`GET /calendar`)

```jsonc
{"date": "2026-11-12", "weekday": 3, "day_type": "weekday",
 "is_closed": false, "is_avoid": false, "is_peak": false, "in_no_discount_window": false,
 "label": null,                      // season_days label, else the public holiday name
 "total_people": 1100, "confirmed_people": 200, "tentative_people": 900, "booking_count": 2,
 "capacity_warning": true,          // total_people ≥ settings.capacity.daily_warning_people
 "bookings": [{"id", "reference", "group_name", "status", "people_booked", "group_type", "contact_name", "arrival_time", "vehicles"}]}
```
Every day in the range is present. Only active statuses are counted/listed (enquiry, proforma_sent =
tentative; confirmed, completed = confirmed).

### Day view shape (`GET /days/:date`)

```jsonc
{"date", "weekday", "day_type", "is_closed", "is_avoid", "is_peak", "label", "public_holiday", "capacity_warning",
 "totals": {"bookings", "total_people", "confirmed_people", "tentative_people", "arrived_total", "paid_total", "balance_due_total"},
 "bookings": [{ ...list item fields..., "finance": {...as detail...}, "payments": [...] }]}
```
Statuses shown: enquiry, proforma_sent, confirmed, completed, no_show (cancelled/lapsed hidden).

## Actions (`POST /bookings/:id/actions/<action>`)

Every action re-reads the booking, runs its precondition, then returns the full detail. Email goes
to `contact_email` (422 without one), rendered by `email_templates.render_email(kind, raw_row,
settings, payments=…, logo_url=PUBLIC_BASE_URL/static/brand/logo-black-600.png, …)` and sent by
`mail_send.send_email(…, thread_message_id=latest Message-ID on the booking)`. A `send_status:
"failed"` result or a raised error becomes `502 send_failed`. Missing sibling modules → `503
not_available`. Attached documents get `documents.email_message_id` set to the sent email.

| action | precondition | effect |
| --- | --- | --- |
| `send-acknowledgement` | status active | email `acknowledgement` (ctx `form_url`) |
| `issue-proforma` | — | new proforma version; result `document` |
| `send-proforma` | status active | reuses the latest proforma unless the booking's total/people/price differ from its snapshot (then issues a new version); attaches it; stamps `proforma_sent_at`; enquiry → proforma_sent |
| `send-invoice` | `paid_total > 0` (409) | issues `invoice`, attaches, stamps `invoice_sent_at` |
| `send-final-invoice` | `arrived_count` set (409) | issues `final_invoice`, attaches, stamps `final_invoice_sent_at` |
| `send-ticket-email` | confirmed/completed (409) | email `ticket` + vehicle ticket PDF, stamps `ticket_emailed_at` |
| `send-ticket-whatsapp` | confirmed/completed; `contact_mobile` (422) | Chatwoot template with the public image URL; stamps `ticket_sent_at`; event `ticket_sent`; 502 on Chatwoot/config failure |
| `send-payment-confirmation` `{attach_invoice?}` | ≥1 payment (409) | ctx `payment` = latest; attaches latest invoice when asked |
| `send-reminder` `{kind}` | `still_interested`/`deposit_reminder`: tentative; `final_details`: confirmed/completed | first two attach the latest proforma (ctx `document`, `hold_expires_on`, `days_left`); `final_details` attaches the ticket when `ticket_emailed_at` is null and then stamps it; marks the `booking_reminders` row of that kind `sent` |
| `send-expiry` `{reason?}` | tentative (409) | email `expiry`; status → lapsed; marks `lapse` reminder sent |
| `send-answers` | ≥1 answered question (409) | ctx `questions` = answered ones |
| `confirm` `{reason?}` | tentative (409); reason required unless deposit covered or waived (422) | status → confirmed |
| `emails/reply` | `body_html`; document ids must belong to the booking (404) | kind `reply`, attaches the documents, threads onto the booking |

## Loyverse arrivals

`GET /bookings/:id/arrivals` fetches receipts for the SAST visit day (`created_at_min/max` in UTC),
sums `line_items.quantity` where `sku == barcode` (the morning sync sets the SKU), subtracting
refunds; if no SKU line matched it falls back to `item_name == group_name`. It only *reports* the
count; `POST …/arrivals {count, source: "loyverse"}` records it. No API key / HTTP failure → 502.

## Integration notes for other agents

- **Public form / mail agent**: `create_booking(data, "form", None)` and `create_booking(data,
  "email", actor)`; pass `questions: [..]` and the raw phone/email — normalisation happens here.
- **Import**: `create_booking(row, "import", None, doc_number=sheet_number)` with `status`,
  `*_at` stamps, `legacy_sheet_row`, `price_per_person` (becomes an override when it differs from
  today's tier price), `arrived_count`. `people_booked` may be 0 for imports.
- **Payments agent**: `record_payment(..., bank_transaction_id=tx.id)` auto-confirms when the
  deposit is covered; a duplicate tx id raises `BookingError`. `delete_payment` refuses bank-linked
  payments — unmatching is yours.
- **Ops/reminders**: `send-reminder`/`send-expiry` call `mark_reminder_sent`; `no_show` is a manual
  `POST /status` (only after the visit date) — the queue should suggest it.
- **Frontend**: `allowed_transitions` drives the status menu; action preconditions above drive
  button enablement; all money is 2-dp floats.

## What I need from the lead

1. `GET /calendar` is `@allow_manager` (the brief listed only `/days/:date`, but §10 gives managers
   the `/calendar` route). Remove the decorator if that was deliberate.
2. Add `payment_deleted` to the event kinds in §4, and `GET /bookings/counts` to §6.
3. mypy on these modules is noisy because `serialize_row` is typed `dict | None`; an overload in
   `src/models/base.py` (`row: dict -> dict`) would silence most of it.
4. One transient `(1213) Deadlock found` was seen inside `documents.issue_document` while another
   agent's DB tests ran concurrently; it surfaced as a clean 502. A single retry on 1213 in that
   transaction would make the button self-heal.
5. `group_bookings` (legacy table) is no longer read or written anywhere; it can be dropped in a
   later migration once the import is confirmed.

## Known gaps

- `send-ticket-whatsapp` was not exercised against Chatwoot locally (the image URL must be public);
  the code path mirrors the old `web/routes/groups.py` send and is unit-checked only.
- Notes live only in `booking_events` (`kind = note`); `internal_notes` is a free-text column edited
  via PATCH.
- Deleting a payment never reverts a confirmation; change status manually if needed.
- A `doc_number` is consumed even if the insert then fails (gap in the sequence, harmless).
- Barcode uniqueness is checked against `bookings` only (the legacy rows were migrated in).
- `*_at` stamps are naive SAST datetimes written from Python; `created_at/updated_at` come from
  MySQL (`NOW()`), which also runs in SAST locally — check the container's TZ in production.
