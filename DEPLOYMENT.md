# Deployment

The stack is fully containerised. MySQL and Chromium run as containers on a
private Docker network; nothing but the web port is published, and that only
on `127.0.0.1`. nginx on the host terminates TLS for two hostnames that both
proxy to the same app: the admin portal and the public booking request form.

```
  admin.farmyardpark.co.za ─┐           ┌──────────────────────────────────────────┐
  bookings.farmyardpark.co.za┴▶ nginx ──▶│  farmyard (docker compose project)        │
        127.0.0.1:8000                   │  web ───────┐                             │
                                         │  worker ────┼──▶ db      (mysql:8.4)      │
                                         │  scheduler ─┤                             │
                                         │             └──▶ chrome  (standalone      │
                                         │                           chromium)       │
                                         └──────────────────────────────────────────┘
```

| Service | Role | Published |
| --- | --- | --- |
| `web` | gunicorn: JSON API + the React app | `127.0.0.1:8000` only |
| `worker` | supercronic: mailbox sync (1 min), FNB poll (5 min), reminders (06:30), DB backup (02:15) | no |
| `scheduler` | supercronic: the daily Loyverse inventory jobs (profile `scheduled`) | no |
| `migrate` | one-shot migration runner, exits | no |
| `db` | MySQL 8.4, named volume `db_data` | no |
| `chrome` | Selenium standalone Chromium for the Quicket bot | no |

Two named volumes carry state: `db_data` (MySQL) and `data` (`/app/data`:
generated PDFs, mail attachments, nightly dumps, lock files).

## First run

```bash
git clone <repo> /opt/farmyard && cd /opt/farmyard
cp .env.example .env
# fill in .env - see the notes at the top of that file and "Booking system" below
docker compose up -d --build
docker compose ps
```

The image builds the React app in a Node stage, so the server needs no Node
installed. `migrate` runs automatically before `web` and `worker` start and is
idempotent.

Two things in `.env` will bite you otherwise:

- **`MYSQL_USER` must not be `root`** — the MySQL image refuses it.
- **Avoid `$` in any value.** Compose interpolates it.

Generate the secrets with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.

## Login and roles

Accounts live in the `users` table. There is no shared password any more.

```bash
docker compose run --rm web create-user --email ray@example.com --name "Ray" --role admin
```

prints a temporary password once; the account must set a new one on first
sign-in. Roles: `admin` sees everything; `manager` sees only the calendar and
the day view (arrivals and gate payments). Reset a password from the Users
page. Failed logins are throttled per
IP and logged with the source address.

| Public (no session) | Why |
| --- | --- |
| `/login`, `/request`, `/request/sent`, `/static/...`, `/healthz` | the app shell and the public form |
| `/api/v1/public/*` | the booking request form's endpoints (Turnstile, honeypot, rate limit) |
| `/group-bookings/ticket/image/<barcode>` | **Meta fetches this** to render the WhatsApp ticket; its own 5-minute JWT |
| `/open_tickets/*`, `/api/stock/*` | the Loyverse bridge; `BRIDGE_TOKEN` |

Everything else requires a session; non-GET API calls also need the session's
CSRF token (`X-CSRF-Token`), which the app handles.

## nginx

Two sites, both proxying to `127.0.0.1:8000`: `admin.farmyardpark.co.za`
(see `deploy/nginx.conf.example`) and `bookings.farmyardpark.co.za` (same
block with the other `server_name`; `/` on that host redirects to the form).
Run `certbot --nginx -d <host>` for each.

**`proxy_set_header X-Forwarded-Proto $scheme;` is not optional.** The WhatsApp
ticket URL and the links inside emails are built from it.

## Booking system: go-live checklist

1. `.env` on the server: add every key under "booking system" in
   `.env.example` (Gmail app password, FNB production credentials, Turnstile
   keys, `ANTHROPIC_API_KEY`, `PUBLIC_BASE_URL=https://admin.farmyardpark.co.za`,
   `BOOKING_FORM_HOST`, `DEV_MAIL_RECIPIENT`). `ENV=prod` is what switches
   outbound email from the developer rewrite to real recipients.
2. `docker compose up -d --build` — migration 007 creates the tables and
   carries the old `group_bookings` rows across.
3. Create the user accounts (above).
4. One-off imports, in this order, from the repo root on the server:
   ```bash
   docker compose run --rm -v "$PWD/data/import:/app/data/import" worker \
     import-sheet --file /app/data/import/fy-bookings-2026-27.csv --dry-run   # review
   docker compose run --rm -v "$PWD/data/import:/app/data/import" worker \
     import-sheet --file /app/data/import/fy-bookings-2026-27.csv
   docker compose run --rm worker poll-bank          # matches deposits already in the bank
   docker compose run --rm worker import-mail        # full mailbox sync + thread linking
   docker compose run --rm worker recompute-reminders
   ```
   The sheet import keeps the sheet's document numbers and moves the counter
   past the highest one. Deposits recorded from the sheet are placeholders
   that the bank matcher absorbs when the real credit is seen.
5. Point the website's "bookings by email" line at
   `https://bookings.farmyardpark.co.za/request`.
6. Watch `docker compose logs -f worker` for the first few sync and poll runs.

## Day-to-day

```bash
docker compose up -d --build     # start / apply changes
docker compose down              # stop, keep data
docker compose logs -f web worker
docker compose ps

docker compose run --rm worker sync-mail
docker compose run --rm worker poll-bank
docker compose run --rm worker backup
docker compose run --rm scheduler add-inventory
docker compose run --rm scheduler clear-inventory
```

The Ops page in the app runs the same jobs and shows the last sync and poll.

## Schedules

`worker` is always on. Its times are in `TZ` and can be overridden with
`MAIL_SYNC_CRON`, `BANK_POLL_CRON`, `REMINDERS_CRON`, `BACKUP_CRON`.

`scheduler` (the Loyverse inventory jobs) sits behind the `scheduled` compose
profile, exactly as before: set `COMPOSE_PROFILES=scheduled` in `.env` to
run it on a timer, or run the jobs by hand with `docker compose run`.

## Backups

`scripts/backup_db.sh` runs nightly in `worker`: a `mysqldump` gzipped to
`/app/data/backups/farmyard-YYYY-MM-DD.sql.gz`, keeping `BACKUP_KEEP_DAYS`
(default 14). Set `BACKUP_OFFSITE_CMD` to a command that receives the file
path to ship it off the server (the ERP's offsite script is the model).
Restore into a fresh stack with `docker compose exec -T db sh -c 'mysql ...' < dump.sql`.

## Email notifications and safety

The inventory scripts still email `NOTIFICATION_RECIPIENTS` over `SMTP_*`
(use port 587). Customer email goes through the Gmail account in
`GMAIL_ADDRESS`. Outside `ENV=prod` every customer email is redirected to
`DEV_MAIL_RECIPIENT` with a `[DEV → ...]` subject prefix, so a local stack can
never reach a customer.

## What is not deployed

Payment audits (PayCloud/AddPay) and the Aronium reconciliation remain out
of scope; the audit blueprint is not registered.
