# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

Operations automation for **The Farmyard Park (Pty) Ltd** — a recreation park in Klapmuts,
Western Cape, South Africa. The repo is named `loyverse_manager` after its original scope
(automating the Loyverse POS), but it has grown into the park's back-office platform:

1. **Daily inventory automation** — pulls the day's ticket sales from Quicket (the online
   ticketing platform), materialises them as items/inventory in Loyverse (the POS the gate
   staff use), and clears them again at end of day.
2. **Group bookings** — the whole pipeline from a customer's request to the visit day:
   public request form → proforma → deposit matched from the FNB bank feed → invoice →
   barcoded vehicle ticket (email + WhatsApp) → arrivals from Loyverse → final invoice.
   A React admin app (Today, Work, Calendar, Bookings, Enquiries, Settings)
   replaced the old Gmail + Google Sheet + Excel workflow. `docs/booking-system.md` is
   the data/API contract; `docs/redesign-spec.md` and `docs/research/` are the UI
   design authority — read them before changing a screen.
3. **Payment auditing** — reconciles card takings from the AddPay/PayCloud terminals
   against both POS systems (Loyverse and Aronium), and tracks cash-bag blind counts.
4. **Open-ticket observation** — webhook endpoints that record the lifecycle of Loyverse
   open tickets for an external observer app.

There is a pytest suite under `tests/` (no CI); UI changes are verified in the browser.

## Domain glossary

| Term | Meaning |
| --- | --- |
| **Loyverse** | Cloud POS used at the park's tills. Source of truth for sales. Public REST API. |
| **Aronium** | A second, on-premise POS. Read-only SQLite file at `db/aronium/pos.db`. |
| **Quicket** | South African online ticketing platform. Visitors buy day tickets here. |
| **PayCloud / AddPay** | Card-terminal gateway. RSA-signed API, used for card reconciliation. |
| **Chatwoot** | Self-hosted customer messaging platform; used as the WhatsApp send path. |
| **Gazebo** | A hireable structure. Fixed set of 7, mapped Quicket name → Loyverse variant id. |
| **Group booking** | A pre-arranged group visit. Gets an EAN-13 barcode and a vehicle ticket. |
| **Online ticket** | A Quicket-purchased visitor ticket, pushed into Loyverse as a stock item. |
| **Open ticket** | A Loyverse "held"/unpaid ticket, tracked over time by the observer webhook. |

## Architecture

Four top-level Python packages, all imported absolutely from the repo root
(`from src...`, `from config...`, `from web...`). Install with `pip install -e .`.

```
config/      settings.py  → env vars + secrets (single place env is read)
             constants.py → business constants (Loyverse IDs, gazebos, recipients, season)

src/
  clients/       thin HTTP/transport adapters, no business logic
                 base.py (requests wrapper) → loyverse, quicket, chatwoot,
                 meta_whatsapp, paycloud (RSA sign/verify), gmail (IMAP read-only +
                 SMTP), fnb (transaction-history API)
  services/      business logic, composed from clients
                 booking (status machine, pricing, actions), pricing, documents
                 (WeasyPrint PDFs), email_templates, mail_ingest, mail_send,
                 extraction (Claude), bank (FNB matching), reminders (queue),
                 public_form, settings, users, arrivals (Loyverse count), tickets,
                 loyverse, quicket, inventory, chatwoot, notification, pdf, barcode, token
  models/        plain-SQL persistence over MySQL (base.py has query/execute/transaction)
                 booking, booking_event, booking_question, payment, document,
                 bank_transaction, email_message, user, group_booking (read adapter),
                 audit (3 models), open_ticket
  repositories/  mysql.py → get_db_connection() (PyMySQL, DictCursor); aronium.py
  bots/          quicket.py → Selenium bot (Quicket has no API for hiding an event)
  utils/         logging (CSV logger), date (SAST today), holidays (SA public
                 holidays), gazebos

web/
  app.py         factory: serves the React app, registers the JSON API, auth guard
  api/           /api/v1 blueprints: auth, users, settings, bookings, calendar,
                 documents, inbox, payments, queue, ops, public (helpers in __init__)
  routes/        legacy: ticket endpoints (groups), bridge webhooks (open_tickets,
                 stock), /api/groups receipts feed
  templates/     documents/ (PDF) and emails/ (HTML) Jinja templates
  static/app/    the built React app (gitignored; built by the Docker frontend stage)
frontend/    Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui admin app
scripts/     CLI entry points (sync_mail, poll_bank, import_sheet, import_mail,
             recompute_reminders, create_user, backup_db.sh, add/clear_inventory, ...)
migrations/  numbered .sql files, applied by scripts/run_migrations.py
docs/        booking-system.md (the build contract) and handoff/ notes per area
docker/      entrypoint.sh - web / worker / scheduler / migrate / one-off roles
deploy/      nginx site example for the reverse proxy
tests/       pytest (pure logic and DB-backed tests; DB tests skip without MySQL)
```

Deployment is `compose.yaml` + `Dockerfile` at the root; see `DEPLOYMENT.md`.

**Dependency direction:** `web/api` and `scripts` → `services` → `clients` / `models` →
`repositories`. Keep new code in this shape: HTTP details in a client, decisions in a
service, SQL in a model, validation and orchestration in the API module. The booking
contract (`docs/booking-system.md`) is the reference for tables, statuses, API shapes
and service signatures; update it when you change them.

## Key flows

### Daily inventory (`add-inventory`, normally scheduled each morning)

1. Find today's Quicket event (`QuicketService.get_event_id`, matched on schedule date).
2. Hide that event on Quicket via `QuicketBot` (Selenium, up to 5 attempts with browser
   restarts) so no further online sales land after the sync. On failure it emails and
   WhatsApps the team but **continues**. The browser is not installed in the app image:
   when `SELENIUM_REMOTE_URL` is set the bot drives the standalone Chromium container,
   otherwise it falls back to a local Chrome at `CHROME_BINARY`/`CHROMEDRIVER_PATH`.
3. Pull the guest list, filter to today's tickets, zero out gazebo stock for gazebos sold.
4. Group tickets by purchaser email → build Loyverse items → create each item, upload the
   product image, then set inventory levels for the order variants.
5. Also create Loyverse items for any `group_bookings` rows with today's `visit_date`.
6. Email a success/failure/no-event summary to `NOTIFICATION_RECIPIENTS`.

### Loyverse variant encoding (important, non-obvious)

Online-ticket items encode data into the Loyverse variant field `option1_value`:

- `"<OrderId> x <count>"` — a real order; the count is mirrored as tracked stock, so gate
  staff decrement it as visitors arrive.
- `"~~ <anything> ~~"` — a non-order annotation (extra ticket types, purchaser cellphone).
  Tildes are toggled between `~~` and `~~~` on update purely to force a visible change.

`LoyverseService.is_online_item` is the heuristic that distinguishes them. If you touch
this encoding, update `is_online_item`, `update_item_order_counts`, and
`InventoryService.build_orders_inventory_map` together.

### Authentication and roles

Accounts live in `users` (`src/services/users.py`): `admin` sees everything,
`manager` sees only the calendar and day view. Sessions are Flask cookies;
`web/app.py:_register_guard` is deny-by-default: anonymous API calls get 401,
every non-GET `/api` call needs the session's CSRF token (`X-CSRF-Token`),
managers are refused on any view not marked `@allow_manager`, and a user with
`must_change_password` can only reach the auth endpoints. Views opt out with
`@public_endpoint` (the public form) or by blueprint (the bridge webhooks).

The one legacy exemption that matters: **`groups.get_ticket_image` must stay public**.
Meta's servers fetch that URL to render the WhatsApp template header and have no
session. It is protected by its own 5-minute JWT instead. Gating it silently breaks
ticket delivery.

### Booking pipeline (the main flow now)

`enquiry → proforma_sent → confirmed → completed` with `cancelled`, `lapsed`, `no_show`
as exits (`src/services/booking.py:set_status`). Nothing is sent automatically: every
email is a button in the app (`POST /api/v1/bookings/:id/actions/<action>`), and every
send is an outbound `email_messages` row plus a `booking_events` row. The worker
container keeps the data fresh: `scripts/sync_mail.py` (read-only IMAP, every minute),
`scripts/poll_bank.py` (FNB, every 5 minutes; a credit whose description carries the
booking reference records the deposit and confirms the booking, still without
sending anything), `scripts/recompute_reminders.py` (daily; fills the action queue).
Prices and deposits come from `src/services/pricing.py` and the Settings page; per-booking
overrides are explicit flags with a reason and survive recalculation. Document numbers
are one counter per booking (`FY1703` proforma, `INV1703` invoice) taken atomically
from `settings.documents.next_number`.

Outside `ENV=prod`, `src/services/mail_send.py` rewrites every recipient to
`DEV_MAIL_RECIPIENT` and prefixes the subject. Never bypass this.

### Group booking ticket delivery

`create`/`update` booking → EAN-13 barcode (`src/services/barcode.py`) → short-lived JWT
(`TokenService`, 5 min TTL) → public image URL
`/group-bookings/ticket/image/<barcode>?token=…` → Chatwoot template message
`group_vehicle_ticket_jpeg` with that URL as header media → Meta fetches the URL and
renders the PDF-to-JPEG on demand (`src/services/pdf.py`, ReportLab + PyMuPDF + Pillow).

Consequences: the app **must be publicly reachable** for WhatsApp delivery to work, the
token expires in 5 minutes (fine — Meta fetches immediately), and the image endpoint is
deliberately `no-store`.

### Payment audit

`AuditService.create_card_payment_audit` unions daily totals from PayCloud, Loyverse and
Aronium per date and stores the variance. `create_cash_bag_assignments` mints blind bag
IDs (`BAG-XXXXXXXX`) — one per day for Aronium, one per employee+device for Loyverse —
which are later reconciled against a counted amount.

### Open tickets webhook

`POST /open_tickets/events` upserts ticket state keyed on a `semantic_hash` (only writes
history when the hash changes); events carrying `event: voided|closed` end the ticket via
`OpenTicket.close_one`. `POST /open_tickets/heartbeat` closes any tracked ticket absent from
the heartbeat set. Both are called by the **Loyverse bridge** (the patched POS build in
`~/repos/support/loyverse_addpay/bridge`), which replaced the old observer app; each event
also carries `reason`, `device` and `employee_id`. `POST /api/stock/availability`
(`web/routes/stock.py`) answers the bridge's stock guard with the quantity of a product
held in other open tickets (`OpenTicket.held_quantity`, thousandths). All three endpoints
require `Authorization: Bearer $BRIDGE_TOKEN` when `BRIDGE_TOKEN` is set
(`web/routes/bridge_auth.py`).

### POS staff (self-managed employees for the Loyverse bridge)

Migration 007 adds `pos_roles`, `pos_employees`, `pos_devices`, `pos_auth_params` and the
append-only `pos_employee_events`. The terminals no longer trust Loyverse's employee list:
`POST /api/pos/roster` hands each enrolled terminal the active employees with their role's
permissions and a *per-device verifier* (HMAC-SHA256 of the stored PBKDF2 PIN hash under that
device's secret), and `POST /api/pos/events` receives the terminal's audit trail (login,
logout, login_failed, locked, approval, approval_failed, permission_denied, sale, refund,
ticket_replaced, ticket_reduced, ticket_voided, ...; de-duplicated on the event's UUID). Both need the bridge token **and** the
device's `device_id` + `device_secret` in the body (`PosStaffService.authenticate_device`,
constant time; unknown, revoked or wrong = 403). PINs are never stored or sent: the service
hashes them (`hash_pin`, site salt in `pos_auth_params`), the unique index on `pin_hash`
makes shared PINs impossible, and `validate_pin` rejects runs and repeats. Permission names are
Loyverse's `ACCESS_*` enum plus `bridge.*` (`PERMISSIONS`; `bridge.apps` shows the Apps drawer entry,
`bridge.manual_plate` / `bridge.replace_ticket_items` gate bridge features). Reductions of saved
tickets are flagged, not blocked: Loyverse's own `ACCESS_DELETE_OPEN_RECEIPT` ("Void saved items in
open tickets") decides who may remove a saved line, and `src/services/pos_alerts.py` (hooked into
`record_events`) e-mails `POS_ALERT_EMAILS` only (never `NOTIFICATION_RECIPIENTS`, which includes the managers; unset = no e-mail; optionally WhatsApps `POS_ALERT_WHATSAPP`) when a role
that can take payments reduces a ticket, when a cash sale follows any reduction within ten minutes,
and on every `ticket_voided`; `PosStaffService.reductions_report` / `pos-staff reductions` lists
reductions. Deleting a whole ticket is blocked for everyone but a Manager: Loyverse checks the same
permission for it, so the terminal additionally requires `bridge.void_ticket` (Manager only) on
that check and on the manager PIN that follows a refusal.

**Re-entry passes** (`src/services/pos_reentry.py`, agreed 2026-10-13): a re-entry is any ticket
carrying the Re-Entry line (SKU 10001, R0). The terminal asks `POST /api/pos/reentry/check` before
saving one (plate, typed?, heads) and `POST /api/pos/reentry/status` before admitting one. Rules:
an anchor is required (a closed, unrefunded sale today for the plate with heads > 0); scan-or-stricter
(a scanned anchor refuses a typed re-entry); one open pass per plate; heads up to the anchor's paid
heads, more needs the Manager PIN on the terminal (`bridge.approve_reentry`) and is flagged; bearer,
single use, dead at the cut-off (18:00). A refund of the anchor voids open passes (full) or lowers the
cap (partial). Heads = Visitor (SKU 10000) quantity + any line in the Online Tickets / Groups
categories; `src/services/pos_items.py` (`ItemKinds`) is the one mapping of SKUs and category ids to
meanings, served to terminals in the roster `policy.items` block (category *names* resolved from the
live account, refreshed every 15 min) and checked against the account by `pos-staff items`.
Anchors come from `open_tickets_history` closed rows (lines carry `sku` + `category` from bridge
build 32 on), refunds from `refund` audit events. Events `reentry_issued` / `reentry_admitted` /
`reentry_refused`; flagged issues alert (owner only); `pos-staff reentries` is the report.
**Who sold what** (agreed 2026-10-15): Loyverse only knows its own employees, so every receipt it
stores and syncs carries the account owner ("Owner"); the real cashier is the bridge's. Sale and
refund receipts report `receipt_no` ("#1-0020") in the `sale` / `refund_receipt` events, and
`POST /api/pos/receipts/cashiers` (`PosStaffService.cashiers`, cursor on `received_at`) hands every
terminal the receipt -> cashier list so the receipt screen, list and reprints show the cashier who
closed the sale on any terminal. The portal's sales pages must take the cashier from these events,
never from Loyverse's receipt employee field or API.

**Group entries** (agreed 2026-10-15): a group ticket reaches a terminal's ticket only by scanning
the group's barcode (the Groups category is hidden from the sales list, search and dropdown; a tap
is refused and logged as `permission_denied`), and before such a ticket is saved or printed the
terminal captures the person entering: a driving licence card (PDF417, decoded on the terminal
with the published keys), a smart ID card (plain-text PDF417) or a green ID book (the number
only), or the driver's name typed and flagged manual (nothing else is typed). The name line
("TJ NKOSI" from a licence, "THANDI JANE NKOSI" from a smart ID, "ID 8001015009087" from an ID
book) goes onto the ticket comment and the slip; the `group_entry` event carries group, plate,
heads, `person` (the name line), surname, names, ID number, source and the manual flag. `pos-staff groups` lists them; the portal's group page
should show them. ID numbers live only in the audit (owner/manager access), never on slips.

**Group conversions** (`src/services/pos_conversions.py`, migration 009, agreed 2026-10-15): a car
that belongs to a group but arrived without the group ticket pays public price; later the same day a
manager converts it on the terminal (drawer entry "Convert to group", permission
`bridge.convert_group`): group ticket scanned, receipt named by slip QR or licence disc, the person
entering captured as at the entrance, then Loyverse's own refund screen where the Visitor quantity
chosen is the heads. The terminal calls `POST /api/pos/conversions/record` BEFORE the refund runs
(the row is what waives the refund window), refunds, then closes a group ticket for the heads.
`POST /api/pos/conversions/lookup` finds today's paid sales by plate or slip sync id. Later stages
(`refunded`, `admitted`, `refund_failed`, `cancelled`) arrive as `group_conversion` audit events and
are mirrored by `record_events`. `PosConversionService.heads_for_group(name, day)` is what a group
invoice adds at the group rate. A conversion's refund does not void re-entry passes
(`pos_reentry._refunds_from_audit` skips `detail.conversion`). CLI: `pos-staff conversions`,
`pos-staff roles grant Manager bridge.convert_group` for roles created before this.

**Refund disputes** (`src/services/pos_disputes.py`, migration 008, agreed 2026-10-15): when a
terminal cannot refund a sale (the refund window has closed, or a card refund failed inside it) it
offers "Log a refund dispute" instead of a dead end: the customer's name, e-mail, mobile and their
own words, with the sale attached (receipt, plate, time, register, cashier, amount, card, AddPay
code), and prints the receipt again with a dispute block and a number (`RD-XXXXXX`, made on the
terminal) for the customer to keep. It arrives as the `refund_disputed` audit event and is mirrored
into `pos_refund_disputes` by `record_events`; `PosDisputeService` lists, shows (with every terminal
event for that plate that day: reductions, voids, re-entries), resolves (open / investigating /
approved / declined / refunded) and replies (e-mail when an address was given). A dispute never
moves money. Owner-only, like the audit: the history it carries must not reach managers. Alert to
`POS_ALERT_EMAILS` on each new dispute. `pos-staff disputes` is the CLI. A card payment can only be
refunded on the terminal that took it; the terminal says which one, that is a prompt, not a dispute.
`bridge.admit_reentry` (Ticket Marshal) lets a role without Accept payments close a pass and
nothing else: the terminal hands Loyverse a copy of the role with Accept payments so its payment
screen opens, but answers the permission itself only while the current ticket is a live pure pass,
and offers only the Re-Entry payment type (payment types Online / Group / Re-Entry, kind "Other",
must exist in the Loyverse account; the API cannot create them). `DEFAULT_ROLES` (Manager,
Payment Marshal, Ticket Marshal) are created on the first roster. Manage everything with `pos-staff` (`scripts/pos_staff.py`: roles, employees,
PINs, device enrolment, events) until the portal pages exist; UI work goes through
`PosStaffService`, never straight to the tables. Terminals enrol themselves: on first use
the bridge makes its own secret and `POST /api/pos/devices/register` records it under the device's
name (a revoked device stays revoked); `pos-staff devices enrol` remains for a fixed secret placed in
`staff.deviceSecret`.

## Commands

Normal operation is through Docker — see `DEPLOYMENT.md` for the full story.

```bash
docker compose up -d --build        # whole stack; migrations run automatically
docker compose down                 # stop, keep data
docker compose logs -f web          # tail
make                                # list the convenience targets

docker compose run --rm scheduler add-inventory       # morning sync, now
docker compose run --rm scheduler clear-inventory     # end-of-day teardown, now
docker compose run --rm scheduler hide-quicket-event  # bot only, now
```

The daily schedule is **off by default**: the `scheduler` service is behind the
`scheduled` compose profile, so `up` does not create it and nothing fires on a
timer. `docker compose run` activates the profile for that single invocation,
which is why the manual commands above still work. Enable the schedule by
setting `COMPOSE_PROFILES=scheduled` in `.env`.

Local development (the `.venv` virtualenv and `compose.dev.yaml` exist for this):

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d db   # MySQL on 127.0.0.1:3307
.venv/bin/python -m scripts.run_migrations
.venv/bin/python -c "from web.app import create_app; create_app().run(port=5100)"  # API + built app
cd frontend && pnpm install && pnpm dev          # live-reload UI on :5173, proxies /api
cd frontend && pnpm typecheck && pnpm lint && pnpm build   # build → web/static/app
PYTHONPATH=. .venv/bin/python -m pytest tests -q               # backend tests
```

`compose.dev.yaml` bind-mounts `web/static/app` into the web container, so after
`pnpm build` the UI on :8010 is current with no image rebuild; :8010 is the one
local URL for UI review. `ENV=dev` and `SESSION_COOKIE_SECURE=false` must be set in the local `.env`. The
README's `poppler-utils` requirement is stale; PDF→JPEG uses PyMuPDF.

## Conventions

- **Env & secrets** live only in `config/settings.py`, read from `.env` via python-dotenv.
  Business constants (Loyverse category/variant UUIDs, gazebo map, notification
  recipients, terminal serials, `SEASON_START`) live in `config/constants.py`. Add new
  IDs there, not inline.
- **`.env` and `keys/` are gitignored and contain live credentials** (Loyverse, Quicket
  login, MySQL, SMTP, Chatwoot, WhatsApp, PayCloud RSA PEMs). Never commit, print, or
  echo their contents. `.env.example` documents every variable; keep it in step when
  you add one. The PayCloud PEMs are optional — `load_key_file` returns `None` when
  they are absent so the app still starts.
- **Dates are South African.** Use `src.utils.date.get_today()` (Africa/Johannesburg), not
  `date.today()`. Business days pivot on local date. Resolve the date **inside** the
  function, never at module scope: these modules are imported once by a long-lived
  gunicorn worker, so a module-level date freezes at boot.
- **Logging:** `setup_logger(name)` from `src/utils/logging.py`. All loggers write CSV rows
  to the single rotating `logs/inventory_updates.log` plus a human-readable console line.
- **Migrations** are plain numbered SQL (`NNN-name.sql`), applied in filename order and
  recorded in `schema_migrations`. The splitter in `run_migrations.py` strips `--` comment
  lines and splits naively on `;` — avoid semicolons inside string literals, and don't use
  `DELIMITER`/stored procedures.
- **Style:** Python ≥3.10, 4-space indent, double quotes, 88-col, trailing commas —
  consistent with Ruff/Black defaults. Type hints are used in newer modules but are not
  applied uniformly; match the file you're editing.
- **Frontend** conventions live in `docs/handoff/frontend-foundation-v2.md`. Colour is
  Material 3 roles: `frontend/src/styles/tokens.css` is **generated** by
  `frontend/scripts/gen-m3-tokens.mjs` (one seed per theme; see `docs/research/09-material-colour.md`),
  never hand-edited; `scripts/check-palette.mjs` and `check-contrast.mjs` must pass. Type roles (`text-display`, `text-title`, ...), shadcn
  components, TanStack Query keys, zod forms. One primary list per screen, counts in
  rails, one filled verb per row, 15 px body, nothing below 12 px. No external CDNs
  except the Turnstile script on the public form.
- **API** conventions: `web/api/__init__.py` (`make_blueprint`, `ok`, `ApiError`,
  `parse_json`, `require_role`, `allow_manager`, `public_endpoint`). Errors are
  `{"error": {"code", "message", "fields"}}`; lists are `{"items", "total", "page", "page_size"}`.
- **Long jobs run inline in the request** on the Ops page (`web/api/ops.py`) —
  `add_inventory` can take minutes because of Selenium.

## Known rough edges

Pre-existing; don't "fix" them as a side effect of unrelated work, but be aware:

- `PayCloudService.get_terminal_transactions` calls
  `self.client.send_request(self, "reconcile.trans.details", payload)` — it passes the
  service as the `endpoint` argument, so the gateway URL is malformed. The exception is
  swallowed and an empty list returned, so PayCloud amounts silently come back as zero.
- `audit_bp` (`web/routes/audit.py`) is **not registered** in `web/app.py` and still
  renders a Jinja template that no longer has a base layout. The audit UI is unreachable.
- `CardPaymentAudit.create_batch` plain-`INSERT`s against a table with
  `UNIQUE KEY unique_audit_date`, so re-running the audit for an already-audited date
  fails rather than updating.
- The `/open_tickets/*` webhooks and `/api/stock/*` are bridge-token protected (the
  session guard exempts them) and must stay reachable from the terminals through nginx.
- `LoyverseClient.get` auto-paginates using the endpoint string as the response key, so
  pagination only works when the endpoint is a bare resource name (`items`, `receipts`) —
  not when a query string is appended (`inventory?variant_ids=…`).
- Class name `NoticifationService` and the README filename `REAMDE.md` are both
  misspelled; renaming either is a deliberate change, not a drive-by.

**Which Loyverse account a row came from** (`src/models/pos_accounts.py`, `src/services/pos_accounts.py`,
migration 010, built 2026-10-16): every terminal request carries `X-Loyverse-Account: <owner id>`
(the Loyverse account the terminal is signed into); the bridge auth binds it to the request and
the models stamp it on every row they write (`account_value()`) and filter every read by it
(`account_clause()`), so a training terminal on the throwaway account only ever sees and touches
its own rows. Outside a terminal request the scope is the *live* account: the one in
`pos_accounts` whose e-mail matches the merchant behind `LOYVERSE_API_KEY` (`GET /merchant`,
cached ten minutes, re-checked at every registration/roster call; `POS_LIVE_ACCOUNT` pins it).
Alerts fire only for the live account. `pos-staff accounts` lists accounts with row counts and
terminals; `accounts purge <id> --yes` deletes one account's rows; `accounts adopt <id>` tags
rows written before the tag existed; `--account <id>|all` before any listing changes its scope.

**Live vs training staff** (migration 011, 2026-10-16): `pos_employees.scope` is `live` or
`training`; a roster request from a terminal on the live account gets the live employees, any
other terminal the training ones (`roster_for_device`). Everyone from before the migration is
training; `pos-staff employees add` makes live logins unless `--training`; `--random-pin` prints a
policy-passing PIN once (run it with stdout to a private file when the PIN must not be seen).
The re-entry cut-off (`POS_REENTRY_CUTOFF`, 18:00 on prod) applies to the live account only;
training terminals get `POS_REENTRY_CUTOFF_TRAINING` (default 23:59) in their roster policy and
in the server-side checks (`ItemKinds.for_request()` / `scoped(live)`), so training can run after hours.
**Sales-screen categories per role** (migration 012, 2026-10-16): `pos_roles.sales_categories` (JSON
list of names, NULL = all) travels to the terminals as each employee's `categories` in the roster;
the bridge trims the category dropdown to it (Public always offered, Groups scan-only, and the
All items / Favourites / Discounts entries dropped for everyone). Prod: Manager and Owner all,
Payment Marshal = Public, Online Tickets, Gazeebos; Ticket Marshal = Public, Online Tickets.
`pos-staff roles set-categories <role> --category ... | --all-categories`.

**Group payments** (`src/services/pos_group_payments.py`, migration 013, 2026-10-16): a terminal takes
a group's payment only after scanning the group's ticket (Ray: no manual choice anywhere group-related,
"not even me as the owner can add a count or payment to a group without scanning a ticket"). Before
charging it asks `POST /api/pos/groups/status` (heads admitted under the ticket today from the closed
R0 group sales, heads converted, what was paid already); the closed receipt comes in as a
`group_payment` audit event whose `paid` stage is mirrored into `pos_group_payments`, keyed by the
barcode. Permission `bridge.group_payment` (Manager default; granted to Manager and Owner on prod).
`pos-staff group-payments [--days 7]`. The policy block now carries `group_payment_sku` (10037).

**One paid entry per car per day + re-entry cool-down** (2026-10-16 evening, Ray): `POST /api/pos/plates/status`
(`ReentryService.plate_status`) answers whether a plate already has a live paid entry today (the
re-entry anchors); the terminals refuse a second non-re-entry sale for the plate and point at
re-entry (lines added to a returning re-entry stay allowed). `check_return` refuses a pass admitted
within `POS_REENTRY_COOLDOWN_MINUTES` (default 5) of being issued (`"cooldown": true`; a manager's
PIN overrides at the terminal); the roster policy carries `reentry_cooldown_minutes`.

**Held stock counts a Loyverse ticket once** (2026-10-16 late): a ticket synced to two terminals is
fed by both, each under its own `ticket_id` (unique key), with the same `sync_id`; `OpenTicket.held_by`
/ `held_quantity` now count one hold per `sync_id` (newest row wins). Before this the pay point saw
"4 held in other open tickets" for a ticket's own seats and the stock guard refused Admit and Save.

**Shop till feed** (2026-10-19): the Aronium module on the office laptop posts every saved document to
`POST /api/shop/sales` with header `X-Shop-Token` = `SHOP_FEED_TOKEN` (.env on prod; the token is in
`/home/ray/private/shop-feed-token-20261019.txt` on Ray's PC). Rows land in `shop_sales` (migration 014,
`src/models/shop_sales.py`, upsert on till_id + document uid); `/shop/till` shows the day live (10 s poll,
`/shop/till/data`). A body with `"probe": true` only checks the token (the module's "Test back office").
