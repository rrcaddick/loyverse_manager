# Work / Today agent — handoff

Branch `feat/booking`. Backend for the redesigned home (docs/research/01: *Today* is the home,
*Work* is one list with a rail of kinds). Files I own:

| Path | What |
| --- | --- |
| `src/services/work.py` | `snapshot`, `list_work`, `counts`, `merge_up_next`, `needs_you`; one row builder per kind |
| `src/services/today.py` | `today(d, for_manager=)`, `system_status(with_errors=)`, `loyverse_last_run`, `next_visit_day`, `seven_day_strip` |
| `src/services/reminders.py` | stale rule (`flag_stale`, `STALE_AFTER_DAYS`, `STALE_PROFORMA_DAYS`, `LIVE_DUE_SQL`), `bulk_dismiss`, `stale_reminder_ids`, `reschedule_lapse`; `build_queue`/`due_reminder_count` now exclude stale |
| `web/api/work.py` | `GET /work`, `GET /work/counts`, `POST /work/reminders/dismiss`, `POST /work/holds/:id/extend` |
| `web/api/today.py` | `GET /today` (manager allowed) |
| `web/api/ops.py` | `GET /ops/status` gained `system` |
| `web/api/users.py`, `src/models/user.py` | `PUT /users/me/preferences`; `preferences` in the public user dict |
| `web/api/queue.py` | unchanged; still serves the old ten-section queue |
| `scripts/recompute_reminders.py` | prints due-now and stale counts |
| `tests/ops/test_work.py`, `tests/ops/test_today.py` | 29 tests (TEST rows, cleaned up); `PYTHONPATH=. .venv/bin/python -m pytest tests/ops -q` |

All endpoints are under `/api/v1`, admin-only unless marked. Errors follow §6
(`{"error": {"code", "message", "fields"?}}`), non-GET needs `X-CSRF-Token`.

## For the lead (needs edits in files I do not own)

1. **`web/api/__init__.py`**: add `"web.api.work"` and `"web.api.today"` to `API_MODULES`. Until then the
   endpoints are unreachable (the tests register the blueprints themselves).
2. **`docs/booking-system.md` §6**: add the rows below for work, today, users/me/preferences and the
   `system` block on `/ops/status`; §8 can point at this file.
3. **`docker/entrypoint.sh`**: the stale rule only runs inside `recompute_reminders`, so the daily cron
   line from `docs/handoff/ops.md` matters more now (`30 6 * * * python -m scripts.recompute_reminders`).
4. **Conversations agent**: the `reply` view reads `email_threads` directly (status `open`,
   `last_direction = inbound`, `has_automated_only = 0`, `not_booking = 0`, `booking_id NOT NULL`) and uses
   `counterpart_name/email` and `last_inbound_at`. While that table is empty it falls back to the
   per-message rule (newest non-automated message on the booking is inbound). The `open_conversation`
   action carries `thrid` (string) — point it at your thread route. A "Done" secondary can be added to
   reply rows once a thread-done endpoint exists (`_reply_rows` in `work.py`).
5. **Frontend**: the theme list is yours; the API accepts any slug. Defaults are
   `{theme: "graphite", mode: "system", text_size: "large"}`.

## Stale rule (`reminders.flag_stale`, run by `recompute_reminders`)

A reminder that is **due now** (`status = 'due' AND due_on <= today`) is flagged `stale = 1` when

- its `due_on` is more than **30 days** in the past (`STALE_AFTER_DAYS`), or
- the booking's `proforma_sent_at` is more than **60 days** ago (`STALE_PROFORMA_DAYS`) and the booking
  has no payment.

The flag is recomputed both ways on every run (a payment, an extended hold or a moved date brings the row
back). A reminder that is not yet due is never stale. Dismissing clears the flag; `reschedule_lapse`
(the hold extension) clears it and revives a dismissed `lapse` row. "Live" everywhere means
`status = 'due' AND stale = 0 AND due_on <= today` (`LIVE_DUE_SQL`): `due_reminder_count`, the legacy
`reminders_due` section, the Work `reminders` and `holds` views and the sidebar count all use it.

Real data after one run (2026-10-08): 160 reminders apply, **19 due now, 20 stale** (all twenty are
"Still interested?" rows 85–260 days overdue from the sheet import; the old queue showed 39).

One consequence worth a decision: clause 2 also hides an imminent *deposit reminder* or *hold* for a
booking whose proforma went out more than 60 days ago. They sit in the Stale view until dismissed or
the hold is extended. If that is unwanted, limit clause 2 to `kind = 'still_interested'` in
`flag_stale` (one line).

## `GET /work?view=&page=&page_size=` → 200

`view` ∈ `up_next` (default) `reply new_requests confirm_money send_tickets reminders holds arrivals stale`
(422 otherwise); `page` ≥ 1, `page_size` 1..200 (default 50; 400 when not integers).

```json
{
  "view": "holds", "items": [row, ...], "total": 1, "page": 1, "page_size": 50,
  "today": "2026-10-08",
  "counts": {"up_next": 10, "reply": 16, "new_requests": 4, "confirm_money": 25, "send_tickets": 13,
             "reminders": 19, "holds": 1, "arrivals": 0, "stale": 20, "total": 78}
}
```

`counts` is the same object `GET /work/counts` returns (`{"counts": {...}, "today"}`). `total` is the
sum of the seven live views (stale excluded) — that is the sidebar badge. `up_next` is the length of
the up_next list (≤ 10). Zeros are returned; hiding a rail entry at zero is the UI's job.

### Row (identical in every view)

```json
{
  "kind": "hold",                       // reply | new_request | money | ticket | reminder | hold | arrival
  "id": "hold:124",                     // kind-prefixed, string; reminder rows in the stale view are "reminder:N" too
  "booking": {"id": 124, "reference": "FY1737", "group_name": "…", "visit_date": "2026-10-16",
              "status": "proforma_sent", "people_booked": 24},     // null for an unmatched bank credit
  "title": "…",                         // the group; for money rows the bank description
  "context": "Hold expires in 1 d · deposit R1 680 outstanding · visit Fri 16 Oct",   // one grey line
  "amount": 1680.0,                     // number | null
  "age_days": 0,                        // days it has waited for a person; never negative
  "group": null,                        // reminder rows: "Deposit reminder" | "Still interested?" | "Final details" | "Hold expiring"
  "primary":   {"verb": "Extend", "action": "extend_hold", "booking_id": 124, "hold_expires_on": "2026-10-09"},
  "secondary": [{"verb": "Open", "action": "open_booking", "booking_id": 124},
                {"verb": "Dismiss", "action": "dismiss_reminders", "ids": [128]}],
  "sort_key": "07:2026-10-09:00000124"  // opaque; rows arrive sorted
}
```

`primary` is the one filled button. `verb` is the label, `action` the call, every other key its payload.
`secondary` may be empty (new requests whose primary already opens the booking and that have no thread);
the first entry is the ghost button, the rest go under `…`.

### Action vocabulary

| `action` | payload | what the UI does |
| --- | --- | --- |
| `open_booking` | `booking_id` | open the booking beside the list |
| `open_conversation` | `thrid` (string), `booking_id`; fallback rows add `message_id` | open the mail thread (conversations agent's route) |
| `open_transaction` | `tx_id` | open the bank transaction (Bank page) with the match dialog |
| `open_day` | `date`, `booking_id` | open the day view (`GET /days/:date`) to record arrivals |
| `booking_action` | `booking_id`, `name`, extra body keys (`kind`) | `POST /bookings/:booking_id/actions/<name>` with the extra keys as JSON (`send-ticket-email`, `send-ticket-whatsapp`, `send-reminder {kind}`, `send-expiry`) |
| `match_transaction` | `tx_id`, `booking_id` | `POST /payments/bank-transactions/:tx_id/match {booking_id}` |
| `ignore_transaction` | `tx_id`, optional `reason` | `POST /payments/bank-transactions/:tx_id/ignore {reason?}` |
| `dismiss_reminders` | `ids: [int]` | `POST /work/reminders/dismiss {ids}` |
| `extend_hold` | `booking_id`, `hold_expires_on` (current, may be null) | ask for a date, then `POST /work/holds/:booking_id/extend {hold_expires_on}` |
| `set_status` | `booking_id`, `status` | `POST /bookings/:booking_id/status {status}` (only `no_show` today) |

Verbs are fixed per kind so the same label means the same thing everywhere:

| view | selection and order | primary | secondary |
| --- | --- | --- | --- |
| `reply` | `email_threads` open, last message inbound, not automated, linked (fallback: per-message); oldest inbound first | **Reply** `open_conversation` | Open |
| `new_requests` | status `enquiry`, `proforma_sent_at` null; oldest enquiry first | **Send proforma** `open_booking` | Reply (when `email_thread_id`) |
| `confirm_money` | credits `suggested` (any date) + `unmatched` with `booking_date ≥ today − 30`; suggested first, then oldest | suggested: **Confirm** `match_transaction` (top suggestion); unmatched: **Match** `open_transaction` | suggested: Open, Ignore; unmatched: Not a booking (`ignore_transaction` reason "Not a booking") |
| `send_tickets` | confirmed, no `ticket_sent_at`/`ticket_emailed_at`, visit ≥ today; by visit date | **Send ticket** (`send-ticket-email` with an email, else `send-ticket-whatsapp`); **Add contact** `open_booking` with neither | WhatsApp (when both channels), Open |
| `reminders` | live, kind ≠ `lapse`; contiguous by kind (deposit, still interested, final details), then `due_on` | **Send reminder** `booking_action send-reminder {kind}`; **Add email** `open_booking` without an email | Open, Dismiss |
| `holds` | enquiry/proforma_sent, unpaid, `COALESCE(hold_expires_on, visit − lapse_days) ≤ today + 3`, visit ≥ today, lapse reminder not dismissed/stale; past first (most overdue), then soonest | **Extend** `extend_hold` | Send expiry (with an email), Open, Dismiss (when a lapse reminder row exists) |
| `arrivals` | confirmed, visit ≤ today, `arrived_count` null; most recent visit first | **Record** `open_day` | Open, No show `set_status` (only after the visit date) |
| `stale` | `status = due AND stale = 1`, any kind; by kind then due_on | **Dismiss** `dismiss_reminders` | Open, Extend (lapse rows) |
| `up_next` | the ten most urgent live rows | as the row's kind | |

Context lines: reply `"Therlo K · waiting 86 d"`, request `"Form request · Arlene · 2 questions · waiting 4 d"`,
money `"Suggested FY1705 · equals the deposit · 4 more"` / `"Unmatched credit · Fri 3 Oct"`, ticket
`"Visit Sat 17 Oct · in 9 d · 3 vehicles · WhatsApp only"`, reminder `"Due 6 d ago · visit Fri 16 Oct ·
deposit R1 680 outstanding · no email on booking"`, hold `"Hold expired 2 d ago · deposit R3 800
outstanding · visit Sat 7 Nov"`, arrival `"Visited today · 95 booked"`; stale rows end in `"· stale"`.
Money is `R3 800` / `R3 290.50`; dates `Sat 31 Oct`; relative `3 d ago` / `today` / `in 2 d`.

### Urgency (`up_next`) and `age_days`

`sort_key` starts with a two-digit tier: 1 holds already past (most overdue first) · 2 arrivals (most
recent visit first) · 3 replies (waiting longest) · 4 money (suggested first, then oldest) · 5 new
requests (oldest) · 6 tickets (by visit date) · 7 reminders and holds not yet past (by due date). `up_next`
is the live rows sorted by that key, first ten. `age_days`: reply = days since the last inbound; request =
since the enquiry date; money = since the bank booking date; reminder = days overdue; hold = days past
the hold (0 while upcoming); arrival = days since the visit; ticket = 0 (tickets are scheduled, not
aged — an imported booking confirmed in January is not "276 days overdue").

### How counts are computed

`work.snapshot()` runs every view's query once (about ten small indexed queries, Python slicing for
pages) and every number — `counts`, `total`, `up_next`, Today's *Needs you* — comes from that one pass,
so the sidebar, the rail and the tile never disagree. `GET /work/counts` is the same call without items.

## `POST /work/reminders/dismiss` → 200

Body `{"ids": [12, "reminder:13"]}` (prefix tolerated) or `{"all_stale": true}` (every stale row).
Unknown ids and rows that are not `due` are skipped, never errors; each dismissal writes a
`booking_events` row `reminder_dismissed`.

```json
{"dismissed": 2, "ids": [12, 13], "skipped": [], "counts": {...}}
```

422 `validation_error` when `ids` is not a list of integers. (`POST /reminders/:id/dismiss` still works.)

## `POST /work/holds/:booking_id/extend {hold_expires_on}` → 200

Validates the date (422: missing, malformed, before today, after the visit), 404 unknown booking,
409 `invalid_state` unless the booking is enquiry/proforma_sent. Then `booking.update_booking` (writes the
`updated` event) and `reminders.reschedule_lapse` (moves the `lapse` reminder, clears stale, revives a
dismissed one). Returns `{"booking": <booking detail>, "counts": {...}}`.

## `GET /today?date=YYYY-MM-DD` → 200 (manager allowed)

Default: today (SAST). 422 on a bad date.

```json
{
  "date": "2026-11-07", "label": "Saturday 7 November", "weekday": 5, "day_type": "weekend",
  "is_closed": false, "is_peak": false, "day_label": null,          // season_days label / public holiday name
  "tiles": {
    "groups": {"total": 5, "arrived": 0},
    "people": {"total": 368, "confirmed": 167},
    "owed_at_gate": {"total": 26665.0, "paid": 8500.0},              // admin only
    "needs_you": {"count": 78, "oldest_days": 111}                    // admin only; = Work total, max age
  },
  "groups": [{"id": 130, "reference": "FY1678", "group_name": "…", "status": "confirmed", "people_booked": 100,
              "arrived_count": null, "ticket_sent": false, "paid_total": 4500.0, "balance_due": 5000.0,
              "contact_name": "…", "contact_mobile": "27…", "vehicles": 0, "gazebos": 0, "arrival_time": null}],
  "next_visit_day": {"date": "2026-10-16", "groups": 1, "people": 24},   // only when today is closed or has no groups, else null
  "seven_day_strip": [{"date": "2026-10-08", "groups": 0, "people": 0, "confirmed_people": 0, "is_closed": true}, ... 7 days],
  "up_next": [row, row, row, row, row],                               // admin only; first five of Work up_next
  "work_counts": {...},                                               // admin only; same as /work/counts
  "system": {
    "mail": {"last_synced_at": "2026-10-08T20:45:04", "ok": true},
    "bank": {"last_poll_at": "2026-10-08T20:45:03", "ok": true},
    "loyverse_sync": {"scheduled": false, "last_run": null, "status": "off"}
  }
}
```

Tile maths (reusing `booking.day_detail`, so it equals `/days/:date`): `groups.total` = active bookings
that day (enquiry, proforma_sent, confirmed, completed), `arrived` = those with `arrived_count > 0`;
`people.total` = Σ people over active, `confirmed` = Σ over confirmed/completed; `owed_at_gate.total` =
Σ `balance_due` (against the final amount once arrivals exist, else the total), `paid` = Σ payments.
Manager calls lose `owed_at_gate`, `needs_you`, `up_next` and `work_counts` (the manager cannot open
Work); per-group `paid_total`/`balance_due` stay, as on the day view.

`system`: `mail.ok` = every folder synced without error within 15 min; `bank.ok` = last poll succeeded
within 30 min; `loyverse_sync.scheduled` = `scheduled` in `COMPOSE_PROFILES`; `last_run` = the last
`add_inventory` run parsed from the tail (64 KB) of `logs/inventory_updates.log`,
`{"at", "outcome": success|no_event|failed|running, "message"}` or null; `status` = `off` when not
scheduled, else `unknown` (no run found) / `ok` / `failed` / `running`.

## `GET /ops/status` → `system`

Everything from `docs/handoff/ops.md` plus `"system"`: the block above with a `last_error` on each of
`mail` (first folder error), `bank` (last poll error) and `loyverse_sync` (the failure message).

## `PUT /users/me/preferences {theme?, mode?, text_size?}` → 200 (any signed-in role)

`theme`: slug `^[a-z0-9][a-z0-9_-]{0,31}$` (lower-cased, trimmed; the frontend owns the list); `mode` ∈
`light|dark|system`; `text_size` ∈ `default|large|xlarge`. Keys sent are merged over the stored JSON in
`users.preferences`; keys left out keep their value; unknown keys are ignored; an empty change is 422.
Returns `{"user": <public user>}`. Every public user dict (`/auth/session`, `/users`) now carries
`"preferences": {"theme": "graphite", "mode": "system", "text_size": "large"}` with defaults filled in.
The `users.theme` column is untouched.

## Real data, 2026-10-08 (counts only)

Work: reply 16 · new requests 4 · confirm money 25 (4 suggested + 21 unmatched credits ≤ 30 d) · send
tickets 13 (all WhatsApp-only: the sheet import has no emails) · reminders 19 (18 still interested,
1 deposit) · holds 1 (FY1737, expires tomorrow) · arrivals 0 · stale 20 · **total 78** (the old queue
said 146 across 8 sections). Up next is ten replies (nothing in tiers 1–2; the oldest has waited 86 d).
Today (Thu 8 Oct, closed): no groups; next visit day Fri 16 Oct, 1 group, 24 people; Needs you 78,
oldest 111 d (an imported enquiry). Sat 7 Nov: 5 groups, 368 people (167 confirmed), owed R26 665,
paid R8 500.

## Known gaps

- `confirm_money` suggestions are whatever the payments agent stored; the chip is the top suggestion's
  booking and "n more" counts the rest.
- No per-kind headings are returned for the reminders view; rows are contiguous by `group` and the UI
  inserts the heading when `group` changes.
- `loyverse_last_run` is null locally (the log has no `add_inventory` lines yet); the parser is unit
  tested against synthetic log lines.
- `snapshot()` is recomputed per request (no cache); fine at this size, revisit if `/work/counts` is
  polled aggressively.
- Tests run `recompute_reminders` (the daily job, idempotent) against the shared database; the stale
  flags on real rows are therefore the same ones the cron would set.
