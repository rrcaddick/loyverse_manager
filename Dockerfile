# syntax=docker/dockerfile:1
#
# Single image, three roles (selected by the entrypoint argument):
#   web        - gunicorn serving the Flask admin portal
#   scheduler  - supercronic running the daily inventory jobs
#   migrate    - one-shot database migration runner
#
# Chrome is deliberately NOT installed here. The Quicket bot drives the
# standalone Chromium container over the network (SELENIUM_REMOTE_URL), which
# keeps this image small and the browser independently restartable.

FROM python:3.12-slim-bookworm

ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA256_AMD64=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1
ARG SUPERCRONIC_SHA256_ARM64=02aa0cb229ba09050cba6638059dadb9eedc2276632ea43d6a57a2f8c1629dd5

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app \
    TZ=Africa/Johannesburg

# tzdata is required: get_today() resolves Africa/Johannesburg via zoneinfo.
# curl is used by the container healthchecks.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata curl ca-certificates \
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

RUN set -eux; \
    chmod +x docker/entrypoint.sh; \
    mkdir -p logs web/static/pdfs; \
    useradd --create-home --uid 10001 farmyard; \
    chown -R farmyard:farmyard /app

USER farmyard

EXPOSE 8000

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["web"]
