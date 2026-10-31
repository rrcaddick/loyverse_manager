# Backend v2 — bank, documents, emails, public form, counts, gate

Handoff from the "backend misc v2" agent on `feat/booking`. Everything here
builds on `docs/redesign-spec.md` §8, §9, §11, §12 and migration
`009-preferences-billing-rules.sql`. The frontend agents build against the
shapes below; the two other backend agents (mail/inbox, work/today/ops/users)
own their own files and nothing here touches them.

Files changed or added:

| Area | Files |
| --- | --- |
| Bank | `src/services/bank.py`, `src/models/bank_transaction.py`, `web/api/payments.py` |
| Documents and emails | `src/services/documents.py`, `src/services/email_templates.py`, `web/templates/documents/*`, `web/templates/emails/*` |
| Bookings | `src/services/booking.py` (billing fields, `confirmed → proforma_sent`), `src/models/booking.py` (billing columns, `BUCKETS`, `counts_by_bucket`), `web/api/bookings.py` (`/counts`, `bucket=`) |
| Public form | `src/services/public_form.py`, `web/api/public.py` |
| Settings | `src/services/settings.py` (DEFAULTS keys only) |
| Gate | `src/services/gate.py`, `web/api/gate.py` (`web.api.gate` was already listed in `API_MODULES`) |
| Tests | `tests/payments/*`, `tests/documents/*`, `tests/ops/test_public_form.py`, `tests/ops/test_public_api.py`, `tests/bookings/test_billing_and_buckets.py`, `tests/bookings/test_transitions.py`, `tests/gate/test_gate.py` |

Run: `PYTHONPATH=. .venv/bin/python -m pytest tests/payments tests/documents tests/ops tests/bookings tests/gate -q`
(393 tests; `tests/mail` still passes with the template changes).
DB tests create `TEST …` bookings, `test-` fingerprints and `TEST-RULE…` ignore
rules and delete them. The documents suite re-renders
`data/documents/preview/{proforma,invoice,final_invoice}.pdf` and
`email-<kind>.html|txt` for all 13 kinds.

## 1. Bank (spec §8)

### Suggestions carry a sentence, not a score

`bank_transactions.suggestions[]` entries (and `GET …/bank-transactions` items)
no longer have `score`. Each entry is:

```json
{
  "booking_id": 12, "reference": "FY1698", "group_name": "Harbour of Hope Ministries",
  "contact_name": "…", "visit_date": "2026-11-07", "status": "proforma_sent",
  "total_amount": 11400.0, "deposit_due": 3800.0, "paid_total": 0.0, "balance_due": 11400.0,
  "reasons": ["Amount equals the deposit", "Name words: Harbour, Hope"],
  "confidence": "Equals the deposit",        // the sentence to print
  "confidence_key": "equals_deposit",        // equals_deposit | equals_balance | part_of_balance | exceeds_balance | name_matches
  "tone": "green",                           // green for the two "equals", grey otherwise
  "rank": 1,                                 // 1..5 in that order
  "arithmetic": "R3 800 = deposit · R0 paid · R11 400 total",   // NBSP thousands (U+00A0), as documents.money
  "preselected": true                        // exactly one entry may be true
}
```

Sentences: **Equals the deposit** (amount = deposit ± R1), **Equals the
balance**, **Part of the balance** (amount < balance), **Exceeds the balance**,
**Name matches** (found by the payer's name only, amount fits nothing).
Candidates are ordered by sentence rank, then the visit date nearest today,
then id; cut to five. `preselected` is set on the first entry only when no other
entry shares its rank (ties pre-select nothing). The transaction serialisation
adds **`preselected_booking_id`** (int | null) derived from that flag, so the
row can show the green **Match** button straight away or "3 possible bookings —
choose".

Strong matching (reference → automatic payment) is unchanged.

### List views

`GET /api/v1/payments/bank-transactions?view=needs_attention|matched|all&status&type&from&to&q&page&page_size`

- `needs_attention`: credits with `match_status ∈ {suggested, unmatched}`,
  **suggested first, then unmatched oldest first**; never debits, never ignored.
- `matched`: `match_status = matched`, newest first.
- `all` (or no `view`): everything, newest first (the existing behaviour; this
  is the tab with the balance column).
- `status`, `type`, `from`, `to`, `q` still work and combine with `view`.
- 400 `validation_error` for an unknown view.

Each item also carries `ignore` (see below) and `preselected_booking_id`.

### Ignore with a reason, optionally a rule

`POST /api/v1/payments/bank-transactions/:id/ignore`

```json
{"reason": "own_transfer" | "card_settlement" | "interest" | "other",
 "note": "optional, ≤ 200",
 "create_rule": true,            // optional; only for the first three reasons
 "pattern": "FNB APP TRANSFER FROM"}   // optional override of the derived prefix
→ 200 {"transaction": tx, "rule": null | {"rule": {id, pattern, reason, note, created_by, created_at},
                                          "created": bool, "applied": n}}
```

- 422 when `reason` is not one of the four, when `create_rule` is sent with
  `other`, or when the pattern is under 4 characters; 409 when the row is
  matched (unmatch first).
- Stored as `bank_transactions.ignore_reason = "<reason>"` or `"<reason>: <note>"`.
  The serialised row exposes it parsed:
  `"ignore": {"reason": "card_settlement", "label": "Card settlement", "note": "…"} | null`
  (legacy free text reads as `other` with the text as the note).
- `create_rule` derives the description's significant prefix
  (`bank.derive_rule_pattern`): words up to and including FROM/TO/REF/FOR, a
  token cut at its first digit, at most five words. Real examples:
  `FNB APP TRANSFER FROM`, `INTERNET TRF FROM`, `ADDPAY-PSP`, `NETCASH`,
  `BIS/INT`, `Microsoft ISO`. The rule is stored in `bank_ignore_rules`
  (unique on pattern), and **every queued credit (unmatched/suggested) whose
  description already starts with it is ignored at once** (`applied`).
- Every poll (`match_new`) applies all rules to unmatched/suggested credits
  before matching: a matching entry becomes `ignored` with
  `ignore_reason = "<rule reason>: rule: <pattern>"` and is counted under
  `matching.ignored` in the poll result.

`GET /api/v1/payments/ignore-rules` → `{"items": [rule…], "total": n}` (rule
has `created_by_name` too). `POST /api/v1/payments/ignore-rules
{pattern, reason, note?}` → 201 (200 when the pattern already exists).
`DELETE /api/v1/payments/ignore-rules/:id` → `{"deleted": rule}`; rows the
rule already ignored stay ignored (unmatch them individually).

### Unmatch reverts the booking

`POST /api/v1/payments/bank-transactions/:id/unmatch` →
`{"transaction": tx, "booking_reverted": null | {id, reference, from: "confirmed", to: "proforma_sent", deposit_due, paid_total}}`.

After the payment is deleted, a booking that is `confirmed`, whose deposit is
not waived and whose remaining Σ payments < deposit goes back to
`proforma_sent` through `booking.set_status(…, reason="Payment unmatched")`:
a `status_changed` event, `confirmed_at` cleared, `proforma_sent_at` kept.
Completed bookings, waived deposits and deposits still covered by another
payment are left alone. To allow this, `TRANSITIONS["confirmed"]` gained
`proforma_sent` (so the status endpoint allows it too) and the transitions
test was updated.

### Summary

`GET /api/v1/payments/summary`:

```json
{"counts": {"unmatched": n, "suggested": n, "matched": n, "ignored": n},
 "to_confirm": 4,                                   // suggested credits
 "unmatched_credits_30d": {"count": 12, "amount": 49000.0},
 "needs_attention": 16,                             // to_confirm + unmatched_credits_30d.count
 "last_poll": {…unchanged shape…} | null}
```

The toast's "Send payment confirmation" offer: after `match`, read
`payment` and the booking's `finance.deposit_covered` from
`GET /bookings/:id` (unchanged).

## 2. Documents (spec §9)

Three kinds, same `documents.kind` enum, new meaning for `invoice`:

| kind | number | heading | label / filename | notes |
| --- | --- | --- | --- | --- |
| `proforma` | `FY1703` | Proforma invoice | Proforma / `FY1703 Proforma.pdf` | "not a tax invoice. VAT may not be claimed on this document." |
| `invoice` | `FY1703-S` | **Statement of account** (subtitle "Deposit receipt and statement") | Statement / `FY1703-S Statement.pdf` | payments received, balance; "This is not a tax invoice"; bank box kept |
| `final_invoice` | `INV1703` | **Tax invoice** | Tax invoice / `INV1703 Tax invoice.pdf` | the only tax invoice; versions start at v1 (no longer v2 of the invoice); **no bank box when due ≤ 0** |

`documents.statement_suffix` ("S") and `documents.deposit_statement_label`
("Deposit receipt and statement") are settings. Event summaries read
"Statement FY1703-S issued (v1)" / "Tax invoice INV1703 issued (v1)".
Existing rows with kind `invoice` numbered `INV…` keep their number; only
their `label`/`filename` change to "Statement".

On every document: the supply line is **"Group day admission, Saturday 7
November 2026"** with the equation `67 × R95.00 = R6 365.00` beneath it, a
Qty / Unit price (inclusive) / Amount table, and totals **Total** then
**Includes VAT 15 % R830.22**. Under *Bill to*: group name, then
`billing_address` (one line per newline; a first line equal to the group name is
not repeated) or the area, then `VAT <customer_vat_number>` when present.
*Booked by* is the contact's name only (no phone, no email). The masthead has
Number and Date; a *Booking ref* row appears only when the number differs from
the reference (statement and tax invoice). `build_document_context` exposes
`doc.show_bank_box`, `doc.show_booking_ref`, `doc.is_tax_invoice`,
`doc.description`, `lines[0].equation`, `booking.billing_address_lines`.

Accountant flag (for the handover): the tax invoice is issued once, after the
visit, for the counted visitors; the deposit document is a receipt and
statement, so no credit note is needed.

## 3. Emails (spec §9)

Subjects are amount-first and under 60 characters; group and date move to the
preheader ("Hillside Community Church · Saturday 7 November 2026 · …"):

| kind | subject |
| --- | --- |
| proforma | `Proforma FY1703 – R3 800 deposit by 31 Oct` (no hold: `… deposit secures 7 Nov`; waived: `… R6 365 payable on the day`) |
| invoice (statement) | `Statement FY1703-S – R2 565 balance on 7 Nov` / `… paid in full` |
| final_invoice | `Tax invoice INV1703 – R1 995 due` / `… paid in full` / `… R570 credit` |
| payment_confirmation | `Payment received: R3 800.00 – FY1703` |
| deposit_reminder | `Deposit R3 800 due by 31 Oct – FY1703` |
| still_interested | `Still planning to visit on 7 Nov? – FY1703` |
| acknowledgement | `Request received FY1703 – Sat 7 Nov` |
| ticket | `Vehicle ticket FY1703 – Sat 7 Nov` |
| final_details | `Your visit on Sat 7 Nov – FY1703` |
| expiry | `Booking FY1703 released – 7 Nov` |
| answers | `Your questions – FY1703` |
| bounce_back, reply | unchanged (`subject=` override still wins everywhere) |

Rand amounts in subjects use a non-breaking space (U+00A0) for thousands, like
the documents. Body changes: the amount (or the key figure) is the first, bold
card row on every money email; the proforma's instructions are a three-item
`<ol>`; one "Attached: FY1703 Proforma.pdf" line above the sign-off
(`attached=` in ctx overrides it, `attached=None` removes it; derived from the
document number or the ticket otherwise); the deposit-stage mail says "your
deposit receipt and statement", never "tax invoice"; card rows stack below
480 px (`@media` in `email.css`, with a `width="40%"` key column and wrapping
values as the inline fallback). `render_email` ctx gains `attached`.

## 4. Booking billing fields

`POST /bookings` and `PATCH /bookings/:id` accept `billing_address` (≤ 500,
newlines allowed) and `customer_vat_number` (≤ 32); blank clears. Both are
returned on the list item, the detail and `day` rows (they are columns, so any
`SELECT *` carries them). Edits write the usual `updated` event.

## 5. Bookings counts and buckets

`GET /bookings/counts` →

```json
{"counts": {"enquiry": 3, "proforma_sent": 4, "confirmed": 5, "completed": 6, "cancelled": 1, "lapsed": 2, "no_show": 1},
 "pending": 7, "confirmed": 5, "lapsed": 3, "past": 7, "all": 22}
```

`GET /bookings?bucket=pending|confirmed|lapsed|past|all` filters the list
(pending = enquiry + proforma_sent, lapsed = lapsed + cancelled, past =
completed + no_show); `status=` still works and intersects with the bucket;
422 for an unknown bucket. `booking_model.BUCKETS` / `counts_by_bucket`.

## 6. Public form (spec §11)

`GET /public/form-config` adds:

```json
"arrival_slots": ["09:00", "09:30", …, "14:00", "Not sure yet"],
"max_group_size": 900, "max_gazebos": 7, "acknowledgement_enabled": false
```

`POST /public/booking-request` field set: `visit_date`, `alternative_date`,
`visitors` (adults + children still accepted as a fallback when `visitors` is
absent), `arrival_time` (must be one of `arrival_slots`, or empty), `group_name`,
`group_type`, `area`, `vehicles`, `gazebos` (≤ 7), `questions`,
`customer_notes`, `contact_name`, `contact_email`, `contact_mobile`,
`policy_accepted: true`, honeypot `website`, Turnstile token. Messages:

- closed weekday: `We are closed on Mondays and Tuesdays. The next open day is Wednesday 4 November.`
- closed season day: `The park is closed on 24 December 2026 (Christmas Eve). The next open day is Friday 25 December.`
- `Group bookings are for 10 or more people. For smaller groups, buy day tickets on Quicket.`
- `For more than 900 people please phone us on 081 461 4246.` (`form.max_group_size`, `email.phone`)
- `Choose an arrival time from the list`, `We have 7 gazebos to hire`,
  `Agree to the booking terms to send your request` (no "please").

Response (201):

```json
{"id": 29, "token": "<jwt>", "reference": "FY1728", "group_name": "…", "visit_date": "2026-11-05",
 "contact_email": "…", "visitors": 42, "acknowledged": false, "submitted_at": "2026-10-08T16:21:24"}
```

`GET /public/requests/<id>?token=<jwt>` returns the same summary (no phone,
no prices) so `/request/sent/<id>` survives a refresh. The token is HS256
with purpose `request_receipt`, 7-day TTL, signed with `IMAGE_TOKEN_SECRET`
(falls back to `SECRET_KEY`); 403 `invalid_token` / `token_expired`, 404 for an
unknown id with a valid token for it. `Cache-Control: no-store`.

**Acknowledgement**: when `settings.form.acknowledgement_enabled` is true
(default false) the `acknowledgement` email is sent right after a successful
submission through `mail_send.send_email` (dev rewrite applies; recorded as an
outbound `email_messages` row + event); a failure is logged, never surfaced.
`acknowledged` is true when a sent acknowledgement exists for the booking, so
the confirmation page can say a copy was emailed.

## 7. Settings DEFAULTS (new keys; `PUT /settings/<section>` accepts them)

- `form.acknowledgement_enabled: false`, `form.arrival_slots: [...]`, `form.max_group_size: 900`
- `documents.statement_suffix: "S"`, `documents.deposit_statement_label: "Deposit receipt and statement"`
- `templates.items: [{key, title, body}]` with four defaults: `price_list`,
  `availability`, `deposit_terms`, `form_link` (the composer's canned snippets;
  `PUT /settings/templates {"items": [...]}` replaces the list; no shape
  validation beyond "known key" — the Settings page should keep `key` stable).

## 8. Gate (spec §1)

`GET /api/v1/gate?date=YYYY-MM-DD` (admin and manager; default today):

```json
{"date": "2026-10-08",
 "arrivals": {"is_closed": false, "day_type": "weekday", "label": null,
   "totals": {"groups": 3, "expected_people": 300, "confirmed_people": 250, "arrived_people": 120,
              "arrived_groups": 1, "balance_due_total": 4500.0},
   "bookings": [{"id", "reference", "group_name", "group_type", "status", "status_label", "people_booked",
                 "arrival_time", "vehicles", "gazebos", "arrived_count", "arrived_source", "arrived_at", "arrived": bool,
                 "barcode", "contact_name", "contact_mobile", "ticket_sent_at", "ticket_emailed_at",
                 "finance": {"total_amount", "paid_total", "balance_due", "deposit_covered"}}]},   // sorted by arrival time
 "open_tickets": [{"id", "ticket_id", "name", "device", "employee_id", "reason", "total", "item_count", "quantity",
                   "plate", "vehicle_make", "vehicle_model", "vehicle_colour", "vehicle_source",
                   "opened_at", "updated_at", "last_seen_at"}],                                  // status = open, newest change first
 "sync": {"scheduled": false, "cron": "1 6 * * *", "clear_cron": "0 18 * * *",
          "last_run_at": "2026-10-08T06:01:00", "finished_at": "2026-10-08T06:03:10",
          "status": "success" | "no_event" | "failed" | "running" | null, "summary": "Successfully processed …",
          "clear_inventory": {"last_run_at", "finished_at", "status", "summary"}, "log_rows_scanned": 1998}}
```

Arrivals reuse `booking.day_detail`; open tickets are read from
`open_tickets_current` (name/device/employee/total come from `receipt_json`
when the bridge sends them; there were no open tickets in the local DB to
verify key names, so the frontend should treat them as nullable); the sync
block scans the last 2000 lines of `logs/inventory_updates.log` for the
`add_inventory` / `clear_inventory` loggers (`scheduled` is
`COMPOSE_PROFILES` containing `scheduled`, as seen by the web container).
Money is included; the frontend hides it for managers.

## 9. Known gaps

- `templates.items`, `form.arrival_slots` and `form.acknowledgement_enabled`
  are not type-checked by `update_settings` (only key names are).
- Deleting an ignore rule does not un-ignore rows; rules apply to credits only.
- `preselected_booking_id` is computed at matching time and stored in
  `suggestions`; a change on a booking after the poll (e.g. a payment) is
  reflected on the next poll, as before.
- `web/api/bookings.py` keeps its own `DOCUMENT_LABELS` ("Invoice", "Final
  invoice") for the send actions' summaries; align it with
  `documents.KIND_LABELS` ("Statement", "Tax invoice") when that file is next
  touched (outside this agent's scope).
- `docs/booking-system.md` §4/§6/§7 still describe the old document names and
  the scored suggestions; this handoff is the current contract until the lead
  folds it in.
- The open-ticket `receipt_json` key names (`device`, `employee_id`, `total`,
  `line_items`) are best guesses from the bridge contract; adjust `gate.open_tickets`
  if the bridge uses different names.
- The acknowledgement email says "We reply within one working day" and
  "closed Mondays and Tuesdays" as fixed copy; make it read `season.closed_weekdays`
  if the closed days ever change.
