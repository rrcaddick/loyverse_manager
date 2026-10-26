# UI round one (26 Oct 2026): the sign-off screen

Scope agreed with the owner: fix separation and contrast first, make Work a
sidebar accordion, and rebuild the Bookings list as the pattern every other
screen will follow. Research: `docs/research/08-contrast-elevation-tables.md`.

## What changed

- **Tokens** (`frontend/src/styles/tokens.css`, `index.css`): canvas a step
  darker than cards, borders darker (L 0.82 light / 18 % dark), secondary
  text at L 0.42, a two-layer card shadow (`--shadow-card`), the 1600 px page
  cap removed so lists use the width they are given.
- **Card** gets the shadow and a border; **DataTable** gets zebra rows
  (`striped`, default on), a nested-surface sticky header and a stronger hover.
- **Sidebar** (`lib/nav.ts`, `components/layout/app-sidebar.tsx`): Today,
  Work ▾ (Requests, Enquiries, Reply, Verify payments, Assign mail, Confirm
  money, Send tickets, Reminders, Holds lapsing, Arrivals, Stale), Calendar,
  Bookings, Enquiries; Settings and Users at the bottom. Mail, Bank, Gate and
  System are no longer in the nav (routes still answer). Counts come from
  `/work/counts` per view and `/enquiries/counts`.
- **Work** page lost its own rail; the sidebar is the only menu. Three new
  views: enquiries, allocate (assign mail), pops (verify payments).
- **Statuses** (`status-pill.tsx`): Request · Pending (enquiry and
  proforma_sent) · Confirmed · Completed · Lapsed · Cancelled · Declined · No
  show. What last happened is the **latest action**, not the status.
- **Bookings list**: buckets Requests · Pending · Confirmed · Lapsed · Past ·
  All as filters over one column set — Ref (primary cell) · Group / contact ·
  Visit · People · Paid (of total) · Balance · Status · Latest action — plus
  one contextual column (Pending: Deposit due by; Past: Arrived; Lapsed:
  Reason). Ranges: Upcoming, This week, This month, Next month, Past, All
  dates. Page sizes 25 / 50 / 100 / All (500). State in the URL (`?tab=
  &range=&q=&sort=&page=&size=`).
- **API**: `GET /bookings` items carry `latest_action {label, at, who}` from
  `booking_service.latest_actions` (emails either way, payments, status
  changes, WhatsApp ticket; creation and import stamps only when nothing else
  happened); `page_size` up to 500; bucket `requests`.

## Screenshots

`data/screenshots/r1/`: bookings-all / pending / confirmed-month in Graphite
light and Fynbos dark at 1440×900, bookings-all at 1920, work-reply.

## Not in this round (next, after sign-off)

Today as the dashboard; the Calendar changes (day kinds with priority and
colour, capacity bar, larger counts, dots); the booking record with tabs
(Overview, Conversation, Payments, Documents, Activity, Contacts) and the
request review banner; the Enquiries page; Settings for day kinds, capacity
and inbound; the document templates in the owner's Excel layout.

## Addendum, same day: the palette rebuilt on Material 3

The owner could not see hover, elevation or a theme change on the first cut,
and measurement agreed (surfaces 2–4 % apart at near-zero chroma, hover a
surface swap, 7 % shadows, themes changing only the accent). The colour
foundation was regenerated on Material 3 roles: `frontend/scripts/
gen-m3-tokens.mjs` writes `tokens.css` from one seed per theme with Google's
colour utilities; mapping and reasons in `docs/research/09-material-colour.md`.
`scripts/check-palette.mjs` proves the separation (240 checks) and
`check-contrast.mjs` the text pairs (636), both at zero failures.

Also fixed: the table header style split (the shadcn primitives merged
classes with the default merger, which dropped the type-role utilities;
they now use the app's `cn`), the Last action column (pill: amber when the
customer acted last, green when we did; labels Customer reply / Response
sent / Proforma sent …), and Pending status is the tinted neutral so amber
means one thing. Screenshots in `data/screenshots/r1b/` (Graphite light,
Fynbos dark, Lagoon light, Indigo dark, hover states, 1920).

## Second addendum: ladder D and deeper colour

The Material default ladder still read as one grey to the owner. A
calibration sheet (`frontend/scripts/palette-calibration.mjs`, published as
a private artifact) put four ladders side by side with the real Bookings
parts and measured gaps; he chose D for both modes and asked for less pastel.
The generator now emits ladder D (dark navigation column in light mode,
canvas 90, table head 80, zebra 94, white cards; dark 8 / 22 / 27 / 32 with a
primary-tinted sidebar), a vivid primary for fills, `--primary-text` for the
primary used as text, deeper semantic fills, and an ink button for Graphite.
`check-palette.mjs` minimums were raised to match. Screenshots in
`data/screenshots/r1c/`.

## Third addendum: hover and elevation

The owner could not pick out a hovered row (the 8 % layer over the card
landed on the zebra tone) nor any elevation in either mode. Hover is now a
fixed tone beyond the zebra row; shadows are desktop-scale in light and a
lighter fill plus a top highlight edge in dark; inputs, selects, the tab
strip, chips and outline/secondary buttons sit on a raised control surface
(`--control`, `--control-border`, `--control-hover`); the active tab and
chip use the primary container. `check-palette.mjs` gained zebra↔hover,
hover↔selected (tint-aware), canvas↔control and control text pairs
(396 checks). Screenshots in `data/screenshots/r1d/`.
