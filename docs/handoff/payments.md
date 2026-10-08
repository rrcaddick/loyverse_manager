# Payments agent handoff

Owner of: `src/clients/fnb.py`, `src/models/bank_transaction.py`,
`src/services/bank.py`, `web/api/payments.py`, `scripts/poll_bank.py`,
`tests/payments/` (59 tests: `.venv/bin/python -m pytest tests/payments`; the
client and matching-rule tests need nothing, the DB tests skip without MySQL and
clean up every `TEST ` booking / `test-` fingerprint / `test-payments-` user).

`web.api.payments` is already in the lead's `API_MODULES`; `create_app()` registers
it with no further wiring. `.env.example` already documents the four FNB variables.

## What runs

```
poll_transactions()          every 5 min (cron) and POST /api/v1/payments/sync
  window   from = max(newest stored booking_date − 3 d, season.start − 120 d, 2026-07-01)
           to   = today + 1 + (poll_number mod 28) d      poll_number = COUNT(bank_poll_log)
  fetch    FNBClient.iter_transactions: token (cached to 30 s before expiry) + 1 call per page
  store    fingerprint_entries() → INSERT once per fingerprint (credits and debits, raw JSON kept)
  log      bank_poll_log row: running → success|failed (entries, new_entries, error)
  match    match_new(): every CREDIT with match_status unmatched|suggested in the last 120 days
```

The rotating `toDate` is not cosmetic: FNB serves a `(account, fromDate, toDate)`
window from a server-side cache for 30–70 minutes, so a fixed window would read
stale data for that long. `toDate` may lie in the future (future-dated entries are
returned anyway). `check_balance_chain` runs on each fetch and logs breaks; the
count is in the poll summary as `chain_breaks` (informational, see below).

Nothing in this module sends anything. An automatic strong match records the
payment through `booking.record_payment` (which confirms the booking when the
deposit is covered) and writes booking events; emails stay buttons.

## Matching rules (`bank.match_transaction` → `MatchResult(kind, booking_id, suggestions, method)`)

Numbers are parsed from `description + " " + end_to_end_id`:
prefixed `(?:FY|INV)[\s-]?(\d{3,5})` (case-insensitive) first, then any bare
standalone 4-digit number not already claimed. `total = people_booked ×
price_per_person`, `balance = total − Σ payments`, `deposit = 0 when waived`.
"Live" means status not in cancelled / lapsed / no_show. Tolerance is R1.

| Tier | Rule | Result |
| --- | --- | --- |
| 1 | exactly one prefixed number → a live booking with that `doc_number`, amount ≤ total + 1 | **strong**, `method = reference` |
| 1 | prefixed number → dead booking, or amount > total + 1 | suggested (score 30 / 35, reason says why) |
| 1 | two or more live prefixed references in one credit | suggested (70 each), never auto-matched |
| 1b | exactly one bare number → live booking **and** amount = deposit or balance ± R1 | **strong**, `method = reference_amount` |
| 1b | bare number → live booking, amount ≤ total + 1, amount does not fit | suggested (50) |
| 2 | live booking with `visit_date ≥ today − 7` whose deposit or balance = amount ± R1 | suggested (+40) |
| 2 | ≥ 2 significant words of the description (≥ 4 letters, not bank boilerplate) in `group_name + contact_name` | suggested (+15 per specific word, +5 per generic word like SCHOOL/CHURCH, max 45) |
| — | otherwise | none → stays `unmatched` |

Suggestions need score ≥ 30, are summed per booking (cap 100), sorted by score
then visit date, and cut to 5. Each is
`{booking_id, reference, group_name, contact_name, visit_date, status, total_amount,
deposit_due, paid_total, balance_due, score, reasons[]}` and is stored in
`bank_transactions.suggestions`. Operator matches use `method = manual`.

Suggested rows are re-evaluated on every poll (the spec said unmatched only):
a booking created after its deposit landed is then picked up automatically, and a
suggestion whose booking was cancelled falls back to `unmatched`. Operators park
noise with **ignore**.

## Actions (`src/services/bank.py`)

- `confirm_match(tx_id, booking_id, actor=None, method="manual") -> payment`
  — 404 unknown tx/booking, 422 debit, 409 matched elsewhere. Idempotent: an
  existing payment for the transaction is reused. Records `kind=eft, paid_on=
  booking_date, reference=description[:120], note="Matched from FNB",
  bank_transaction_id=tx_id`, sets `matched`, writes a `payment_matched` event.
- `unmatch(tx_id, actor)` — deletes the linked payment directly via
  `payment_model.delete` (the bookings service's `delete_payment` refuses
  bank-linked rows on purpose), writes `payment_deleted` + `payment_unmatched`
  events, resets the row to `unmatched`. Also un-ignores and clears suggestions.
  **The booking status is not reverted**: `confirmed` has no legal transition back
  (`TRANSITIONS` in booking.py) and no revert helper exists — see gaps.
- `ignore(tx_id, reason, actor)` — 409 when matched. Reason trimmed to 255.

## API (all `@require_role("admin")`, session + `X-CSRF-Token` on POST)

```
GET  /api/v1/payments/bank-transactions?status&from&to&q&type&page&page_size
     status ∈ unmatched|suggested|matched|ignored · from/to = booking_date (YYYY-MM-DD)
     q = LIKE on description, end_to_end_id, matched reference/group_name, or exact amount
     type = credit|debit (extra) · page_size ≤ 200 · newest first
  → {"items": [tx…], "total", "page", "page_size"}

tx = {
  "id", "fingerprint", "account_number", "entry_id",
  "booking_date": "2026-10-05", "value_date": "2026-10-05",
  "description", "end_to_end_id", "amount": 2800.0, "credit_debit": "CREDIT",
  "balance_after": 31472.66 | null, "first_seen_at",
  "match_status": "suggested", "matched_booking": {"id", "reference", "group_name"} | null,
  "matched_booking_id", "matched_at", "matched_by", "match_method": "reference"|"reference_amount"|"manual"|null,
  "suggestions": [ {…see above…} ], "ignore_reason"
}

GET  /api/v1/payments/bank-transactions/:id              → tx + "raw" (the FNB entry)
POST /api/v1/payments/bank-transactions/:id/match        {"booking_id": 12}
  → {"transaction": tx, "payment": {payments row}}      422 missing/debit · 404 · 409 matched elsewhere
POST /api/v1/payments/bank-transactions/:id/unmatch      → {"transaction": tx}
POST /api/v1/payments/bank-transactions/:id/ignore       {"reason": "Card settlement"} → {"transaction": tx}
POST /api/v1/payments/sync   (≈8 s, runs poll_transactions)
  → {"poll_id", "status": "success", "window_from", "window_to", "entries", "new_entries",
     "new_credits", "new_debits", "chain_breaks", "http_calls",
     "matching": {"checked", "matched", "suggested", "unmatched", "failed"}}
     502 bank_poll_failed when FNB is unreachable/misconfigured (the poll row records the error)
GET  /api/v1/payments/summary
  → {"counts": {"unmatched", "suggested", "matched", "ignored"},
     "unmatched_credits_30d": {"count", "amount"},
     "last_poll": {"id", "started_at", "finished_at", "status", "window_from", "window_to",
                   "entries", "new_entries", "error"} | null}
```

Errors follow the shared `{"error": {"code", "message", "fields"}}` shape; codes
used: `validation_error`, `not_found`, `conflict`, `bank_error`, `bank_poll_failed`.

For the queue (ops agent): `bank_model.list_transactions(status="suggested")`
feeds `payments_to_confirm`, `bank_model.unmatched_credits_since(30)` feeds
`unmatched_credits`, `bank_model.last_poll()` feeds `/ops/status`.

## Cron and environment (lead: `docker/entrypoint.sh`, compose)

```
*/5 * * * *  cd /app && python -m scripts.poll_bank
```
Suggest `POLL_BANK_CRON` with that default, next to `ADD_INVENTORY_CRON`.
Exit codes: 0 polled (summary JSON on stdout), 1 poll failed (recorded in
`bank_poll_log`), 2 FNB not configured, 3 another poll holds
`DATA_DIR/locks/poll_bank.lock` (skipped; verified by holding the lock from a
second process). Budget: one poll ≈ 1 token call + 1 call per page, against
FNB's 170 calls/minute.

Env: `FNB_BASE_URL` (default `https://api.fnb.co.za/apigateway`), `FNB_CLIENT_ID`,
`FNB_CLIENT_SECRET`, `FNB_ACCOUNT_NUMBER`. `FNBClient.from_settings()` raises
`FNBConfigError` naming the missing ones. Scopes on the production credentials:
`i_can i_can_payments i_can_tran_hist` (token `expires_in` 360 s).

## Live poll against production (read-only, 2026-10-08 16:39 SAST)

One run, **3 HTTP calls** (token + 2 pages), 7.9 s. Window 2026-07-03 → 2026-10-09
(first poll, so the season-lead floor applied). **289 entries, all new: 55 credits,
234 debits**, dated 2026-07-03 → 2026-10-07, no future-dated entries, no null
balances. Credits per month: Jul 7, Aug 15, Sep 23, Oct 10; 35 of the 55 are
R5,000+. Two same-day duplicate-content groups (6 debit rows, e.g. identical
wage payments) were kept apart by the occurrence index, so nothing was lost.
Matching: 55 checked, 0 matched/suggested (the bookings table is empty).

Observed reference formats (digits masked, no names):

- `FY9999` — 13 occurrences in 12 credits: upper-case, no separator, numbers in
  the 16xx range (the sheet's numbering, consistent with `next_number` 1703).
  12 carried it in the description, 3 of those echo it in `endToEndId`.
- `INV99999` — 2 occurrences: a payer's *own* 5-digit invoice number, not ours;
  the matcher looks it up as a doc_number, finds nothing, and ignores it.
- 3 credits have a bare 4-digit number only, inside a `XXX_YY9999` token (a
  payer system reference, not a booking); they will only be suggested when the
  amount fits a booking.
- 40 credits have no number at all: own-account transfers (`TRANSFER FROM …`,
  `… CALL …`, `PLAT …`), interest, Netcash/card settlements, and EFTs carrying
  only a free-text name. `endToEndId` is null on 29/55 credits.

Balance chain: 3 breaks reported, all caused by one R50 debit whose `entryId` is
dated 28 Sep but whose `bookingDate` is 5 Oct — the API sequences it by entryId
while the ledger booked it a week later (the fnb README §13.4 date-skew case).
The three balances around it are each off by exactly R50 and the rest of the
chain holds, so no money is missing. Expect the occasional warning of this kind.

## Known gaps / asks for the lead

1. **Status after unmatch.** Unmatching a deposit that auto-confirmed a booking
   leaves it `confirmed`. Either the bookings agent adds a
   `revert_confirmation(booking_id, actor)` (confirmed → proforma_sent when
   paid_total < deposit_due) that `bank.unmatch` can call, or operators
   cancel → reopen by hand. `unmatch` already looks for nothing else.
2. New booking event kind `payment_unmatched` (and I reuse `payment_deleted`);
   the frontend's icon map needs an entry.
3. `bank_model.match_candidates()` and `payment_for_transaction()` are SELECTs on
   `bookings`/`payments` living in my model so the matcher has one read model;
   move them to `booking.py`/`payment.py` if you prefer. `candidate_finance`
   repeats `booking_finance`'s total/deposit/balance formulas to avoid a settings
   lookup per booking.
4. `scheduler` needs the cron line above; `docker/entrypoint.sh` is yours.
5. `types-PyMySQL` would make `mypy` clean on `bank_transaction.py`
   (`requirements/dev.txt`). My five modules are otherwise mypy-clean.
6. Not built: the README §7.3 cache cross-check (same entries, different last
   balance → re-query with another window). The rotating `toDate` makes it
   unnecessary unless two polls land inside one minute.
7. The first poll in production will re-insert nothing (fingerprints are
   content-based), but it will log 289 "new" entries once; the matcher then
   proposes nothing until bookings exist. After the sheet import, run
   `POST /payments/sync` or wait 5 minutes and the 12 `FY`-referenced credits
   should auto-match where the imported bookings keep their sheet numbers.
