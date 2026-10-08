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
   A React admin app with a Gmail helpdesk, an action queue and a season calendar
   replaced the old Gmail + Google Sheet + Excel workflow. See `docs/booking-system.md`.
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

`ENV=dev` and `SESSION_COOKIE_SECURE=false` must be set in the local `.env`. The
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
- **Frontend** conventions live in `docs/handoff/frontend-shell.md`: tokens in
  `frontend/src/styles/tokens.css`, shadcn components, TanStack Query keys, zod forms.
  No external CDNs except the Turnstile script on the public form.
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
