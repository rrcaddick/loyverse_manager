# syntax=docker/dockerfile:1
#
# Two stages:
#   frontend  - builds the React app (frontend/) into web/static/app
#   runtime   - python image with one entrypoint and several roles:
#                 web        gunicorn serving the API + SPA
#                 worker     supercronic: mail sync, bank poll, reminders, backups
#                 scheduler  supercronic: the daily Loyverse inventory jobs
#                 migrate    one-shot database migration runner
#
# Chrome is deliberately NOT installed here. The Quicket bot drives the
# standalone Chromium container over the network (SELENIUM_REMOTE_URL).

FROM node:22-bookworm-slim AS frontend
ENV CI=1
# Pin pnpm to the version the lockfile was written with (pnpm 10 adds a
# minimum-release-age policy that rejects freshly published packages).
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /src/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend ./
# vite.config.ts writes to ../web/static/app
RUN mkdir -p /src/web/static && pnpm build


FROM python:3.12-slim-bookworm AS runtime

ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA256_AMD64=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1
ARG SUPERCRONIC_SHA256_ARM64=02aa0cb229ba09050cba6638059dadb9eedc2276632ea43d6a57a2f8c1629dd5

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app \
    TZ=Africa/Johannesburg \
    DATA_DIR=/app/data

# tzdata: get_today() resolves Africa/Johannesburg via zoneinfo.
# curl: container healthchecks.
# libpango/harfbuzz/ffi/jpeg/openjp2/fontconfig: WeasyPrint (PDF documents).
# default-mysql-client: nightly mysqldump in scripts/backup_db.sh.
# DEBIAN_MIRROR lets a build on a network that cannot reach deb.debian.org use
# another mirror, e.g. --build-arg DEBIAN_MIRROR=https://mirror.lstn.net
ARG DEBIAN_MIRROR=http://deb.debian.org
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org
RUN sed -i -e "s|^URIs: http://deb.debian.org/debian-security$|URIs: ${DEBIAN_SECURITY_MIRROR}/debian-security|" \
           -e "s|^URIs: http://deb.debian.org/debian$|URIs: ${DEBIAN_MIRROR}/debian|" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        tzdata curl ca-certificates \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 \
        libffi8 libjpeg62-turbo libopenjp2-7 fontconfig fonts-dejavu-core shared-mime-info \
        default-mysql-client \
    && rm -rf /var/lib/apt/lists/*

# supercronic: cron built for containers - runs unprivileged, logs to stdout,
# and will not start a job while the previous run is still going.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) sha="$SUPERCRONIC_SHA256_AMD64" ;; \
      arm64) sha="$SUPERCRONIC_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSLO "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${arch}"; \
    echo "${sha}  supercronic-linux-${arch}" | sha256sum -c -; \
    chmod +x "supercronic-linux-${arch}"; \
    mv "supercronic-linux-${arch}" /usr/local/bin/supercronic

WORKDIR /app

# Dependencies first so code edits don't invalidate the pip layer
COPY requirements/prod.txt requirements/prod.txt
RUN pip install --no-cache-dir -r requirements/prod.txt

COPY . .
COPY --from=frontend /src/web/static/app ./web/static/app

RUN set -eux; \
    chmod +x docker/entrypoint.sh scripts/backup_db.sh || true; \
    mkdir -p logs data web/static/pdfs; \
    useradd --create-home --uid 10001 farmyard; \
    chown -R farmyard:farmyard /app

USER farmyard

EXPOSE 8000

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["web"]
