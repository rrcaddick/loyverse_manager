# Ops agent handoff

Branch `feat/booking`. Everything below is in files I own (docs/booking-system.md §11);
anything that needs a change in another owner's file is listed under **For the lead**.

Files:

| Path | What |
| --- | --- |
| `src/services/public_form.py` | form validation, Turnstile, per-IP rate limit, submission log, `*_compat` bridge to `booking.py` |
| `src/services/reminders.py` | `compute_due_dates`, `recompute_reminders`, `mark_sent`, `dismiss_reminder`, `build_queue`, `due_reminder_count` |
| `web/api/public.py` | `GET /public/form-config`, `POST /public/booking-request` |
| `web/api/queue.py` | `GET /queue`, `POST /reminders/:id/dismiss` |
| `web/api/ops.py` | `POST /ops/run`, `GET /ops/status`, `GET /ops/logs` |
| `scripts/import_sheet.py` | old booking-sheet import (`--dry-run`) |
| `scripts/create_user.py`, `scripts/recompute_reminders.py`, `scripts/backup_db.sh` | CLI tools |
| `tests/ops/` | 103 tests: form validation, sheet parsing, reminder dates (pure); queue + recompute against the DB (`TEST ` rows, cleaned up) |

Run the tests with `.venv/bin/python -m pytest tests/ops -q`. The DB tests skip when MySQL is unreachable.

All endpoints are under `/api/v1`. Dates are `YYYY-MM-DD`, datetimes ISO-8601 with seconds, money is a
number with 2 dp. Errors follow §6: `{"error": {"code", "message", "fields"?}}`.

## Public form (no session, no CSRF)

### `GET /public/form-config` → 200

```json
{
  "intro": "Tell us about your group ...",
  "group_types": [{"code": "school", "label": "School"}, ...],
  "min_date": "2026-10-31",          // max(today + 1, season.start)
  "max_date": "2027-04-30",          // season.end
  "closed_weekdays": [0, 1],         // Python weekday numbers (Mon=0)
  "avoid_weekdays": [2],
  "closed_days": ["2026-12-24", "2026-12-31", "2027-03-26"],   // season_days kind=closed within [min_date, max_date]
  "peak_days": ["2026-12-25", "2026-12-26", "2027-01-01", "2027-01-02", "2027-01-03"],
  "max_questions": 5,
  "min_group_size": 10,
  "turnstile_site_key": "0x4AAA..." | null,   // null = do not render the widget
  "park": {"name": "The Farmyard Park", "phone": "081 461 4246", "website": "www.farmyardpark.co.za", "email": "thefarmyardpark@gmail.com"}
}
```

`Cache-Control: no-store` so settings changes show up immediately.

### `POST /public/booking-request`

Request body (JSON):

| field | rule |
| --- | --- |
| `group_name`, `contact_name` | required, ≤ 255 |
| `group_type` | required, a `code` from `form-config.group_types` |
| `area` | optional, ≤ 255 |
| `contact_email` | required, valid address; stored lower-cased |
| `contact_mobile` | required; parsed with region ZA, stored as E.164 digits (`27821234567`); `+44...` accepted |
| `visit_date` | required ISO; > today, within the season, not a closed weekday, not a closed season day |
| `alternative_date` | optional ISO, same rules, must differ from `visit_date` |
| `adults`, `children` | ints ≥ 0 (missing = 0); `adults + children ≥ min_group_size` (error lands on `adults`) |
| `vehicles`, `gazebos` | optional ints ≥ 0 |
| `arrival_time` | optional ≤ 20 chars free text |
| `customer_notes` | optional ≤ 2000 |
| `questions` | list of ≤ `max_questions` strings, each ≤ 500; blanks dropped; a single string is accepted |
| `policy_accepted` | must be `true` (or `"true"`, `"1"`, `"yes"`, `"on"`) |
| `website` | honeypot, must be empty |
| `turnstile_token` (or `cf-turnstile-response`) | the widget token; required when `turnstile_site_key` is set |

Order of checks and responses:

| status | code | when |
| --- | --- | --- |
| 429 | `rate_limited` | more than 5 submissions from this IP in the last hour (`form_submissions`, counts failed-Turnstile attempts too) |
| 400 | `validation_error` | body is not a JSON object |
| 422 | `validation_error` | `fields: {field: message}` — messages are customer-facing, e.g. `"We are closed on Mondays and Tuesdays"`, `"The park is closed on 24 December 2026 (Christmas Eve)"`, `"The season opens on 31 October 2026"`, `"Group bookings are for 10 or more people"`; a filled honeypot is `fields.website` |
| 400 | `turnstile_failed` | Turnstile rejected the token or could not be reached (fails closed). The attempt is logged in `form_submissions` with `booking_id NULL`. With `TURNSTILE_SECRET_KEY` empty the check is skipped. |
| 201 | — | `{"reference": "FY1728", "group_name": "...", "visit_date": "2026-11-05", "contact_email": "..."}` |

On 201 the booking is created through `booking.create_booking(clean, source="form", actor=None)` with
`people_booked = adults + children`, `enquiry_date = today`, `questions` inside the data (the service stores
them), and a `form_submissions` row (payload minus token/honeypot, ip, user agent, `turnstile_ok=1`).
Nothing is emailed. The frontend's "sent" page should show the reference and that the team will reply by email.

## Queue (admin)

### `GET /queue` → 200

```json
{"sections": [...], "total": 12, "today": "2026-10-08", "generated_at": "2026-10-08T16:21:24+02:00"}
```

Sections come back in this fixed order, every one present even when empty:
`needs_reply, unmatched_emails, new_requests, payments_to_confirm, unmatched_credits, reminders_due,
tickets_to_send, visits_this_week, arrivals_to_record, lapsing`. Each is
`{"key", "title", "count", "items": [...]}`; `count == len(items)` except `reminders_due`, where `items` are
groups and `count` is the total number of reminders.

Every item that concerns a booking carries the same `booking` object:

```json
"booking": {"id": 29, "reference": "FY1728", "group_name": "...", "contact_name": "...",
            "visit_date": "2026-11-05", "status": "enquiry", "people_booked": 100}
```

| key | title | item shape (besides `booking`) | selection / order |
| --- | --- | --- | --- |
| `needs_reply` | Needs a reply | `message: {id, subject, from_name, from_email, sent_at, snippet, has_attachments}` | bookings whose newest non-auto-generated linked email is inbound; active statuses, or any status with visit_date ≥ today − 14; oldest first |
| `unmatched_emails` | Emails to review | *(no booking)* `{id, from_name, from_email, subject, sent_at, snippet, has_attachments, gmail_thrid}` | `email_messages.review_status = 'pending'`, newest first |
| `new_requests` | New requests | `source, created_at, enquiry_date, contact_email, contact_mobile, group_type, alternative_date, questions_count, unanswered_count` | status `enquiry` and `proforma_sent_at IS NULL`, oldest first |
| `payments_to_confirm` | Payments to confirm | *(no booking)* `{id, amount, description, booking_date, value_date, first_seen_at, suggestions: [...]}` | `bank_transactions.match_status = 'suggested'`, credits, newest first; `suggestions` is the payments agent's JSON, passed through |
| `unmatched_credits` | Unmatched credits | *(no booking)* `{id, amount, description, booking_date, value_date, first_seen_at}` | unmatched credits with booking_date ≥ today − 30, newest first |
| `reminders_due` | Reminders due | groups: `{kind, title, count, items: [{reminder_id, kind, due_on, days_overdue, booking, contact_email, hold_expires_on, deposit_due}]}` | `booking_reminders.status = 'due' AND due_on ≤ today`; group order `lapse, deposit_reminder, still_interested, final_details` (empty groups omitted); titles "Hold expiring", "Deposit reminder", "Still interested?", "Final details" |
| `tickets_to_send` | Tickets to send | `contact_mobile, contact_email, vehicles, confirmed_at, days_to_visit` | confirmed, both `ticket_sent_at` and `ticket_emailed_at` NULL, visit_date ≥ today; by visit date |
| `visits_this_week` | Visits this week | `group_type, arrival_time, vehicles, gazebos, contact_mobile, arrived_count, ticket_sent, finance: {price_per_person, total_amount, deposit_due, deposit_waived, paid_total, balance_due}` | status in confirmed/proforma_sent/enquiry, visit_date in [today, today + 7]; by date, arrival time, name. `total_amount = people_booked × price`, `balance_due = total − Σ payments` |
| `arrivals_to_record` | Arrivals to record | `barcode, days_ago` | confirmed, visit_date ≤ today, `arrived_count IS NULL`; most recent visit first |
| `lapsing` | Lapsing holds | `hold_expires_on, days_left, deposit_due, proforma_sent_at, contact_email` | enquiry/proforma_sent with no payments and `COALESCE(hold_expires_on, visit_date − lapse_days_before) ≤ today + 3`, visit_date ≥ today; soonest first. `days_left` can be negative |

### `POST /reminders/:id/dismiss` → 200 `{"reminder": {id, booking_id, kind, due_on, status: "dismissed", dismissed_by, dismissed_at, ...}}`

404 `not_found` for an unknown id. Dismissing writes a `booking_events` row `reminder_dismissed`. A dismissed
reminder is not resurrected by the next recompute; it is deleted once its condition stops holding.

## Ops (admin)

### `POST /ops/run {"name"}` → 200

`name ∈ add_inventory, clear_inventory, hide_quicket_event, sync_mail, poll_bank, recompute_reminders`
(422 `validation_error` otherwise). Runs synchronously — `add_inventory` can take minutes (Selenium); the
gunicorn timeout is already 1800 s. Always 200 with:

```json
{"ok": true,  "name": "recompute_reminders", "duration_ms": 41, "summary": 12}          // return value, JSON-safe; "ok" when None
{"ok": false, "name": "sync_mail", "duration_ms": 3, "error": "Not available on this build: src.services.mail_ingest is missing"}
{"ok": false, "name": "add_inventory", "duration_ms": 1200, "error": "RuntimeError: ..."}
```

Callables, imported lazily: `scripts.add_inventory.add_inventory`, `scripts.clear_inventory.clear_inventory`,
`scripts.hide_quicket_event.hide_quicket_event`, `src.services.mail_ingest.sync_mailbox`,
`src.services.bank.poll_transactions`, `src.services.reminders.recompute_reminders`.

### `GET /ops/status` → 200

```json
{
  "server_time": "2026-10-08T16:21:24+02:00", "today": "2026-10-08",
  "mail": {"folders": [{folder, uidvalidity, last_uid, last_synced_at, last_error}], "pending_review": 0},
  "bank": {"last_poll": {id, started_at, finished_at, window_from, window_to, entries, new_entries, status, error} | null, "suggested": 0},
  "reminders": {"due_count": 3, "due_total": 9, "sent": 0, "dismissed": 1},     // due_count = due and due_on <= today
  "bookings": {"counts": {"enquiry": 5, "proforma_sent": 47, "confirmed": 13, "completed": 0, "cancelled": 0, "lapsed": 0, "no_show": 0}, "total": 65},
  "imports": {"last_run": {id, kind, started_at, finished_at, status, summary} | null},
  "scheduler": {"add_inventory_cron": "1 6 * * *", "clear_inventory_cron": "0 18 * * *", "profile_enabled": false, "timezone": "Africa/Johannesburg"},
  "jobs": ["add_inventory", "clear_inventory", "hide_quicket_event", "poll_bank", "recompute_reminders", "sync_mail"]
}
```

`scheduler.*` is read from the process environment (`ADD_INVENTORY_CRON`, `CLEAR_INVENTORY_CRON`,
`COMPOSE_PROFILES`), not from `config.settings`.

### `GET /ops/logs?lines=200` → 200 `{"path", "lines": [...], "count", "requested"}`

Last N lines of `logs/inventory_updates.log` (CSV rows: timestamp,name,level,message). `lines` is clamped to
1..2000; a non-integer is 422.

## Services

```python
# src/services/reminders.py
compute_due_dates(booking, paid_total, settings["reminders"]) -> {kind: date}   # pure
recompute_reminders() -> int        # upsert due rows, drop stale non-sent rows; returns applicable count
mark_sent(booking_id, kind)         # upsert status 'sent' (send-reminder action should call this)
dismiss_reminder(reminder_id, actor) -> row | None
build_queue() -> dict
due_reminder_count(today=None) -> int

# src/services/public_form.py
validate_request(payload, settings, *, closed_days=None, today=None) -> (clean, errors)
date_problem(d, settings, closed_days, today) -> str | None       # reusable for the admin UI's date picker
verify_turnstile(token, remote_ip) -> bool
rate_limited(ip) -> bool
record_submission(booking_id, payload, ip, user_agent, turnstile_ok) -> id
create_booking_compat / add_question_compat / record_payment_compat   # call booking.py; fall back to a direct insert if it is not importable
```

Reminder rules (settings `reminders`, defaults 7 / 14 / 3 / 7), only for bookings in
enquiry/proforma_sent/confirmed with visit_date ≥ today − 1:

| kind | due_on | condition |
| --- | --- | --- |
| `still_interested` | `proforma_sent_at + still_interested_days` | proforma_sent and no payments |
| `deposit_reminder` | `visit_date − deposit_reminder_days_before` | enquiry/proforma_sent, not waived, Σ payments < deposit_due |
| `final_details` | `visit_date − final_details_days_before` | confirmed |
| `lapse` | `hold_expires_on`, else `visit_date − lapse_days_before` | enquiry/proforma_sent and no payments |

"Unpaid" means no payments at all for `still_interested`/`lapse`; `deposit_reminder` stays while the deposit is
not fully covered. Sent rows are never changed or deleted. Note `booking.py` also has
`mark_reminder_sent(booking_id, kind)`; both write the same row, so either works.

## Scripts

```bash
python -m scripts.import_sheet --dry-run              # plan for data/import/fy-bookings-2026-27.csv
python -m scripts.import_sheet                        # write; prints created/skipped/warnings, records import_runs
python -m scripts.import_sheet --file other.csv --show-past

python -m scripts.create_user --email linda@example.com --name "Linda Caddick" --role admin
python -m scripts.create_user --email m@example.com --name Marcelino --role manager [--password ...]
python -m scripts.recompute_reminders

MYSQL_HOST=... MYSQL_PORT=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DB=... DATA_DIR=/app/data \
  bash scripts/backup_db.sh          # -> $DATA_DIR/backups/farmyard-YYYY-MM-DD.sql.gz, prunes > BACKUP_KEEP_DAYS (14)
                                     # runs: $BACKUP_OFFSITE_CMD <file>   when that env var is set
```

Cron lines for the scheduler (SAST, add to `docker/entrypoint.sh` next to the inventory jobs):

```
30 6 * * *   cd /app && python -m scripts.recompute_reminders
30 2 * * *   cd /app && bash scripts/backup_db.sh
* * * * *    cd /app && python -m scripts.sync_mail          # mail agent's script
*/5 * * * *  cd /app && python -m scripts.poll_bank          # payments agent's script
```

### Sheet import: what the dry run says today (2026-10-08)

`64 to create, 5 past rows ignored, 0 skipped` — confirmed 13, proforma_sent 47, enquiry 4. Highest INV in the
sheet is 1737; the counter is bumped past it **before** the first insert (so new numbers for the 4 rows without an
INV cannot collide with historical ones later in the sheet) — the service's `create_booking(doc_number=...)` bumps
it again, harmlessly.

Mapping: status from deposit > 0 (confirmed + an `eft` payment, `paid_on` = INVOICE UPDATED, else enquiry date,
else today, reference "Imported from booking sheet") → numeric INV (proforma_sent, `proforma_sent_at` = that date
09:00) → enquiry. `price_per_person` is always the sheet price with `price_overridden=1`, reason "Imported from
booking sheet" (so the tier recalculation never silently changes an agreed price). `contact_email` NULL.
`legacy_sheet_row` = the non-empty cells keyed by header plus `_row`. `internal_notes` = "Imported from the 2026/27
booking sheet on <date> (row N)". Sheet visits on closed weekdays (Mon 2 Nov, Tue 10 Nov, Mon 7 Dec, Tue 8 Dec,
Wed 9 Dec) import as-is; `create_booking` does not enforce the season rules.

Idempotency rule, deliberately narrower than the brief: a row **with** an INV is skipped only when that
`doc_number` exists; a row **without** one is skipped when the same (group name, visit date) exists. The sheet has
several same-name/same-day congregations with different INVs (three "New Apostolic Church" on Sat 5 Dec; two
"New Apostolic" on Sat 21 Nov), which the (name, date) rule alone would wrongly drop.

Warnings the real run will print (rows 70, 79, 109, 115: two phone numbers, first kept; rows 98, 104: no total
booked → 0). Notes: row 3 banner text is not a date; row 118 "New Apostolic Brackenfell" is a name-only scribble
(the full entry is row 125). Group-type guesses worth a glance afterwards (they fell to `other`): Bishop Lavis SS,
St. Matthew's, St Catherine of Siena, Home from Home, Timberlea Farms, Potters House.

Verified end to end against a 4-row TEST copy through the real `booking.create_booking`: statuses, stamps,
payment, override flags and the second run skipping everything. Rows are deleted afterwards.

## For the lead

1. **Dockerfile**: `apt-get install -y --no-install-recommends default-mysql-client` (on bookworm this is the
   MariaDB client; its `mysqldump` works against MySQL 8.4 — the script avoids MySQL-only flags such as
   `--set-gtid-purged`). `gzip` is already in the base image.
2. **compose.yaml**: the `scheduler` service needs the data volume mounted (it only has `logs:` today) for the
   backups to land in `DATA_DIR/backups`.
3. **.env.example**: document `BACKUP_OFFSITE_CMD` (optional, e.g. `rclone copyto`) and `BACKUP_KEEP_DAYS` (14).
4. **docker/entrypoint.sh**: the cron lines above.
5. **requirements/dev.txt**: `types-python-dateutil` for mypy (the only mypy complaint left in my files).
6. Optionally expose `ADD_INVENTORY_CRON` / `CLEAR_INVENTORY_CRON` in `config/settings.py`; `/ops/status` reads
   the environment directly for now.
7. `web/app.py` needs no change: `API_MODULES` already lists `web.api.queue`, `web.api.ops`, `web.api.public`,
   and the guard honours `@public_endpoint` (verified: anonymous POST reaches validation; `/queue` is 401
   anonymous and 403 for a manager).

## Known gaps

- `needs_reply` and `unmatched_emails` only fill once the mail agent writes `email_messages.booking_id`,
  `is_auto_generated` and `review_status`; `payments_to_confirm.suggestions` is whatever the payments agent stores.
- The honeypot answers 422 with `fields.website`; a bot can therefore tell it was caught. Switch to a fake 201 in
  `web/api/public.py` if that becomes a problem.
- Turnstile fails closed on a network error (one retry click for a real visitor). The rate limit keys on
  `request.remote_addr` after ProxyFix (`x_for=1`), so it is per client, not per nginx.
- `/ops/run` blocks the request; there is no job history table beyond the log line and `import_runs`.
- Reminders: a `deposit_waived` enquiry still gets a `lapse` reminder (it has no payments). If waived holds should
  not lapse, drop that case in `compute_due_dates`.
- `backup_db.sh` was run against the local dev database (25 tables, 872 KB gzip, offsite hook called with the
  path; a wrong password exits 2 and leaves no partial file). Not yet run inside the container image.
- `/ops/run sync_mail` performed a real incremental Gmail sync during testing (19 s, nothing new); the mail
  agent's module is importable on the branch, so `ok: false ... missing` now only applies to `poll_bank` until
  `src/services/bank.py` lands.
