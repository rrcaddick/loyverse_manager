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
  Date · Count · Payment · Status (since 29 Oct; see the addendum) — plus
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

## Addendum, 29 Oct 2026: design signed off; list housekeeping

The owner signed off the design at the commit before the calibration sheet
(`ca47a39`) with his materialpalette teal applied and the approved elevation
added back: Teal 500 `#009688` on the table head, buttons and the active nav
item; `#FF4081` count badges; the 50 % tint `#80CBC4` on the active filter
and tab; the hovered row at 25 % primary; text `#212121` / `#757575`;
dividers `#BDBDBD`; Pending amber; padding under the pagination. The
palette lives as an override block at the end of `tokens()` in
`frontend/scripts/gen-m3-tokens.mjs`. The calibration ladder and the
Material 2 pass that followed are kept under the tag
`archive/palette-explorations`, not on the branch. (The owner's screen
brightness was down during the first pass, which explains the contrast
chase.)

Same day on the list: Paid and Balance became one **Payment** cell
(`features/bookings/components/payment-bar.tsx`: paid of total, a bar that
fills with the payments made, the deposit as a tick on the bar, what is
still due beside it; overpaid shows the credit in blue). Status and Last
action became one **Status** cell: the pill, then the last action with its
date and age under it, coloured by who acted (amber: the customer; green:
us). Visit is now Date, People is now Count. The sidebar header shows the
full lock-up at the drawer's width with "Farmyard Admin" under it when
open, the tree mark when collapsed; `APP_NAME` is now Farmyard Admin
(titles, login). Opening a select, menu or dialog no longer shifts the
page: Radix's scroll lock hid the viewport scrollbar and padded the body,
so `index.css` keeps the scrollbar on `body[data-scroll-locked]`.

Later the same day, agreed and done: **the app header is gone** app-wide.
The drawer carries its own toggle (a corner button when open, under the
mark when collapsed; the rail handle and Ctrl/Cmd+B still work; narrow
screens get a floating button over the content). "/" opens a small search
dialog from anywhere (`components/layout/global-search.tsx`, admin only)
and on the Bookings list focuses the list's own box. The breadcrumb went;
records keep their own back links. Keyboard shortcuts stay in the user
menu. On Bookings the title row went too: the buckets are the header and
New booking sits at the right end of their row. The calendar and the
full-height layout now size against the viewport, not the header.

Also: the **Status** cell is two pills side by side, the status pill at a
fixed width so they line up down the column and the last-action pill
stretching to fill the rest, with the action's date and age under them.
**Count badges** share one component (`components/count-badge.tsx`): one
and two digits get the same chip, three or more stretch.

Then, same afternoon: both Status pills are fixed widths (the status pill
6.5 rem, the action pill 12 rem for "Payment confirmation sent"), so both
columns of pills line up; the Status cell shrinks to them and spare width
goes to Group and Payment. The collapsed rail shows a new **emblem**
(`assets/brand/emblem.svg`: the tree and the two gate panels cut from the
lock-up without the ground or grass tufts, so the gate's bottom rail is
the flat base; the full logo file is untouched) filling the rail width, and the emblem itself is the button that
opens the drawer. The A/B servers and worktrees are gone: :8010 is the one
local URL, with `web/static/app` bind-mounted so `pnpm build` is live there.

The Bookings list no longer scrolls as a page on desktop (owner's note, 29
Oct): the route uses `layout: "fill"` (AppLayout pins the padded page to the
viewport on md+), the table card takes the remaining height, and only the
table body scrolls (`DataTable fill`), with the header sticky inside that
scroller and the pagination pinned under it. Phones keep page scrolling.

