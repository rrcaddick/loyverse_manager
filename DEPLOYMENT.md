# Deployment

The stack is fully containerised and self-contained. MySQL and Chromium run as
containers on a private Docker network; nothing but the web port is published,
and that only on `127.0.0.1`. There is no database process loose on the host.

```
                    ┌──────────────────────────────────────────┐
  A record ──▶ nginx│  farmyard (docker compose project)        │
   + certbot   │    │                                           │
   (host)      └───▶│  web ──────┐                              │
        127.0.0.1:8000           ├──▶ db      (mysql:8.4)       │
                    │  scheduler ┤                              │
                    │            └──▶ chrome  (standalone       │
                    │                          chromium)        │
                    └──────────────────────────────────────────┘
```

| Service | Role | Published |
| --- | --- | --- |
| `web` | gunicorn + Flask admin portal | `127.0.0.1:8000` only |
| `scheduler` | supercronic running the daily jobs | no |
| `migrate` | one-shot migration runner, exits | no |
| `db` | MySQL 8.4, named volume `db_data` | no |
| `chrome` | Selenium standalone Chromium for the Quicket bot | no |

## First run

```bash
git clone <repo> /opt/farmyard && cd /opt/farmyard
cp .env.example .env
# fill in .env - see the notes at the top of that file
docker compose up -d --build
docker compose ps
```

`migrate` runs automatically before `web` and `scheduler` start, and is
idempotent — already-applied files are skipped.

Two things in `.env` will bite you otherwise:

- **`MYSQL_USER` must not be `root`** — the MySQL image refuses it.
- **Avoid `$` in any value.** Compose interpolates it. PythonAnywhere database
  names look like `user$dbname`; use a plain name such as `farmyard`.

Generate the two secrets with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## nginx

Copy `deploy/nginx.conf.example` to `/etc/nginx/sites-available/farmyard`, point
`server_name` at your A record, symlink it into `sites-enabled`, then run
`certbot --nginx -d <your-host>`.

**`proxy_set_header X-Forwarded-Proto $scheme;` is not optional.** The group
ticket is delivered by handing Meta a URL it fetches, and that URL is built with
`url_for(..., _external=True)`. Without the header the app emits `http://` and
WhatsApp delivery fails. `PREFERRED_URL_SCHEME=https` in `.env` is the fallback
for the same reason.

The proxy timeouts in the example are long on purpose: the Scripts page runs
`add-inventory` synchronously inside the request, and that drives Selenium.

## Day-to-day

```bash
docker compose up -d --build     # start / apply changes
docker compose down              # stop, keep data
docker compose down -v           # stop and destroy the database
docker compose logs -f web       # tail
docker compose ps                # health
```

A `Makefile` wraps the same commands (`make up`, `make down`, `make logs`,
`make db-shell`, …); run `make` on its own for the list.

Run a job by hand:

```bash
docker compose run --rm scheduler add-inventory
docker compose run --rm scheduler clear-inventory
docker compose run --rm scheduler hide-quicket-event
```

## Schedule

The `scheduler` container runs supercronic in the `TZ` from `.env`
(`Africa/Johannesburg`). Defaults, matching the historical PythonAnywhere runs:

| Job | Default | Env var |
| --- | --- | --- |
| Morning Quicket + group sync | 06:01 | `ADD_INVENTORY_CRON` |
| End-of-day teardown | 18:00 | `CLEAR_INVENTORY_CRON` |

Set either to a different cron expression in `.env` and recreate the container.
`hide-quicket-event` is not scheduled — `add-inventory` already hides the day's
event as its second step.

Supercronic will not start a job while the previous run of the same job is still
going, so a slow morning sync cannot overlap itself.

## Backups

Everything durable lives in the `farmyard_db_data` volume.

```bash
docker compose exec db sh -c \
  'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  > backup-$(date +%F).sql
```

Restore into a fresh stack with `docker compose exec -T db sh -c 'mysql ...' < backup.sql`.

## What is not deployed

Payment audits (PayCloud/AddPay), the Aronium POS reconciliation, and the
Loyverse open-ticket observer are out of scope. The code is still present but
the audit blueprint is not registered, and the PayCloud RSA keys under `keys/`
are optional — the app starts normally without them.
