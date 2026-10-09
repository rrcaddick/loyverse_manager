# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

Operations automation for **The Farmyard Park (Pty) Ltd** — a recreation park in Klapmuts,
Western Cape, South Africa. The repo is named `loyverse_manager` after its original scope
(automating the Loyverse POS), but it has grown into the park's back-office platform:

1. **Daily inventory automation** — pulls the day's ticket sales from Quicket (the online
   ticketing platform), materialises them as items/inventory in Loyverse (the POS the gate
   staff use), and clears them again at end of day.
2. **Group bookings** — a Flask admin portal for capturing group visits, generating a
   barcoded vehicle-entry ticket PDF, and delivering it over WhatsApp.
3. **Payment auditing** — reconciles card takings from the AddPay/PayCloud terminals
   against both POS systems (Loyverse and Aronium), and tracks cash-bag blind counts.
4. **Open-ticket observation** — webhook endpoints that record the lifecycle of Loyverse
   open tickets for an external observer app.

There is **no test suite** and no CI. Changes are verified by running the scripts/app.

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
                 meta_whatsapp, paycloud (RSA sign/verify)
  services/      business logic, composed from clients
                 loyverse, quicket, inventory, audit, paycloud, chatwoot,
                 meta_whatsapp, notification (SMTP), pdf, barcode, token (JWT)
  models/        active-record style persistence over MySQL
                 group_booking, audit (3 models), open_ticket
  repositories/  mysql.py  → get_db_connection() context manager (PyMySQL, DictCursor)
                 aronium.py → read-only SQLite queries against the Aronium POS DB
  bots/          quicket.py → Selenium bot (Quicket has no API for hiding an event)
  utils/         logging (CSV logger), date (SAST today), gazebos (lookup helpers)

scripts/     CLI entry points; also imported and called by the web Scripts page
web/         Flask app (factory pattern), AdminLTE + jQuery templates, blueprints
migrations/  numbered .sql files, applied by scripts/run_migrations.py
bin/         host-side wrappers that shell out to `docker compose run`
docker/      entrypoint.sh - dispatches the image's web/scheduler/migrate roles
deploy/      nginx site example for the reverse proxy
```

Deployment is `compose.yaml` + `Dockerfile` at the root; see `DEPLOYMENT.md`.

**Dependency direction:** `routes`/`scripts` → `services` → `clients` / `models` →
`repositories`. Services are constructed with their dependencies injected (see
`scripts/add_inventory.py` and `web/routes/audit.py:get_audit_service` for the wiring
pattern). Keep new code in this shape: HTTP details in a client, decisions in a service,
SQL in a model.

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

### Authentication

A single shared account gates the portal (`web/routes/auth.py`). The gate is a
deny-by-default `before_request` registered in `create_app` **after** the
blueprints, with a small `PUBLIC_ENDPOINTS` exemption set.

The one exemption that matters: **`groups.get_ticket_image` must stay public**.
Meta's servers fetch that URL to render the WhatsApp template header and have no
session. It is protected by its own 5-minute JWT instead. Gating it silently
breaks ticket delivery - the booking saves, the send reports success, and the
customer receives a broken image.

Credentials are `AUTH_USERNAME` plus a werkzeug hash in `AUTH_PASSWORD_HASH`.
An empty hash fails closed. Moving to per-user accounts means replacing
`_credentials_valid` and the session payload; nothing else depends on the shape
of the credential check.

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
ticket_replaced; de-duplicated on the event's UUID). Both need the bridge token **and** the
device's `device_id` + `device_secret` in the body (`PosStaffService.authenticate_device`,
constant time; unknown, revoked or wrong = 403). PINs are never stored or sent: the service
hashes them (`hash_pin`, site salt in `pos_auth_params`), the unique index on `pin_hash`
makes shared PINs impossible, and `validate_pin` rejects runs and repeats. Permission names are
Loyverse's `ACCESS_*` enum plus `bridge.*` (`PERMISSIONS`; `bridge.settings` and `bridge.apps` show those
drawer entries, `bridge.manual_plate` / `bridge.replace_ticket_items` gate bridge features); `DEFAULT_ROLES` are created on the
first roster. Manage everything with `pos-staff` (`scripts/pos_staff.py`: roles, employees,
PINs, device enrolment, events) until the portal pages exist; UI work goes through
`PosStaffService`, never straight to the tables. Enrolling a device prints its secret once; it
goes into that terminal's bridge config as `staff.deviceSecret`.

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

Running against a local checkout instead:

```bash
pip install -r requirements/dev.txt

python -m scripts.run_migrations    # apply migrations/*.sql (idempotent, tracked)
python -m scripts.add_inventory     # and clear_inventory / hide_quicket_event

python -m web                       # dev server on :5000
flask --app web.app run --debug     # same, with reloader

mypy src config scripts web         # dev extra; no CI runs this automatically
```

Two notes: the README's `python -m web.app` does **not** start a server
(`web/app.py` has no `__main__` guard) — use `python -m web`. And the README's
`poppler-utils` requirement is stale; PDF→JPEG moved to PyMuPDF in `f94d6bd`
and there is no system dependency left.

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
- **Templates** are Jinja2 on AdminLTE 3.2 with jQuery, DataTables, Flatpickr and Toastr,
  all loaded from CDNs in `web/templates/base.html`.
- **Long scripts run inline in the request** on the Scripts page (`web/routes/scripts.py`)
  — `add_inventory` can take minutes because of Selenium. Bear that in mind before adding
  more work to it.

## Known rough edges

Pre-existing; don't "fix" them as a side effect of unrelated work, but be aware:

- `PayCloudService.get_terminal_transactions` calls
  `self.client.send_request(self, "reconcile.trans.details", payload)` — it passes the
  service as the `endpoint` argument, so the gateway URL is malformed. The exception is
  swallowed and an empty list returned, so PayCloud amounts silently come back as zero.
- `audit_bp` (`web/routes/audit.py`) is **not registered** in `web/app.py`, and its nav
  link was removed in `7689af1`. The audit UI is currently unreachable.
- `CardPaymentAudit.create_batch` plain-`INSERT`s against a table with
  `UNIQUE KEY unique_audit_date`, so re-running the audit for an already-audited date
  fails rather than updating.
- The web app has no CSRF protection; the `/open_tickets/*` webhooks and
  `/api/stock/availability` are bridge-token protected (session guard exempts them) and
  must stay reachable from the terminals through nginx. Everything else sits behind the
  session login.
- `LoyverseClient.get` auto-paginates using the endpoint string as the response key, so
  pagination only works when the endpoint is a bare resource name (`items`, `receipts`) —
  not when a query string is appended (`inventory?variant_ids=…`).
- Class name `NoticifationService` and the README filename `REAMDE.md` are both
  misspelled; renaming either is a deliberate change, not a drive-by.
