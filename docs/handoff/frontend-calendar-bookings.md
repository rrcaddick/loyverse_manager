# Frontend: calendar, day view, bookings list and booking detail — handoff

Owner: frontend calendar+bookings agent. Scope: `frontend/src/pages/calendar/**`,
`frontend/src/pages/bookings/**`, `frontend/src/features/calendar/**`,
`frontend/src/features/bookings/**`. Built on the shell
(`docs/handoff/frontend-shell.md`) against the bookings, documents and mail
handoffs. `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

## What was built

| Route | Page | Role | Summary |
| --- | --- | --- | --- |
| `/calendar` | `pages/calendar/CalendarPage.tsx` | admin, manager | Six-week Monday-first month grid with a single-hue heat fill, confirmed/tentative split bar, closed/avoid/peak/capacity flags, booking chips, week totals, legend, keyboard navigation, a day panel (Sheet) and the Add-booking dialog. URL state `?month=YYYY-MM&day=YYYY-MM-DD`. |
| `/day/:date` | `pages/calendar/DayPage.tsx` | admin, manager | Gate screen: prev/next day, flags, summary tiles, one card per booking with big figures, Loyverse fetch, manual arrivals, gate payment, no-show (admin, past confirmed only). Managers see no balance tile, no booking links, cash/card only. |
| `/bookings` | `pages/bookings/BookingsPage.tsx` | admin | Server-paged, server-sorted DataTable. Search, status multi-select with counts, date presets (upcoming / this month / next month / past / all / custom), all in the URL (`status,range,from,to,q,sort,page,size`). Header search lands as `?q=` and widens the range to "all". |
| `/bookings/:id` | `pages/bookings/BookingDetailPage.tsx` | admin | Header, action bar, tabs via `?tab=overview|timeline|emails|documents|payments|questions`. |

Only `GET /calendar`, `GET /days/:date`, `GET /bookings/:id/arrivals`,
`POST /bookings/:id/arrivals` and `POST /bookings/:id/payments` are used on the
manager-visible pages; `GET /settings` is gated behind `isAdmin` (managers see
humanised group-type codes).

## Component map

```
features/calendar/
  api.ts                 useCalendar(from,to) ["calendar",from,to], usePrefetchCalendar, useDay(date) ["day",date]
  month.ts               buildMonthGrid (6×7, Monday first), HEAT_BANDS/heatLevel, STATUS_DOT, date helpers, chipName
  calendar.css           heat text/bar colour rules per step, closed-day hatch, legend swatches
  components/
    month-grid.tsx       ARIA grid, roving tabindex, DayCell, week totals, keyboard handling
    month-nav.tsx        prev/next/today + month-and-year picker popover
    calendar-legend.tsx  heat ramp, split bar, closed, avoid, peak, capacity, today
    day-panel.tsx        Sheet (right on desktop, full-width on phones), DayFlags (also used by DayPage)
    day-booking-card.tsx the day-view booking card with arrivals / gate payment / no-show
features/bookings/
  types.ts               every API shape used here (BookingRow, BookingListItem, BookingDetail, CalendarDay,
                         DayView, DayViewBooking, InboxMessage, …) plus label maps
  api.ts                 queries + mutations; invalidateBookingWorld() refreshes ["bookings"], ["calendar"],
                         ["day"], ["queue"], ["inbox"] and writes the returned detail into ["bookings", id];
                         documentPdfUrl, fetchDocumentPreview (POST → blob), openBlobInNewTab
  actions.ts             availability(detail, action) → {enabled, reason}; confirmNeedsReason; proformaIsStale;
                         STATUS_CHANGE_COPY / REMINDER_COPY
  list-params.ts         URL ⇄ ListState for the bookings list, range presets, sortable columns
  lib.ts                 useGroupTypes/useGroupTypeLabel (settings, admin-gated), holdState, relativeDayLabel,
                         paragraphsToHtml, sourceLabel, peopleSummary
  shared.tsx             ContactChips, ProvenanceBadge ("Imported from booking sheet"), HoldExpiryNotice
  components/
    booking-form-dialog.tsx   create (POST) and edit (PATCH, changed keys only); used by calendar, list, detail
    action-bar.tsx            every action with precondition tooltips; SendDialog (exported) = the confirm step
    status-dialog.tsx         allowed_transitions → POST /status with reason rules
    override-dialogs.tsx      PriceOverrideDialog, DepositOverrideDialog (waive), HoldDialog
    record-payment-dialog.tsx office/gate modes (managers: cash/card)
    arrivals-dialog.tsx       Loyverse fetch + manual count → POST /arrivals {count, source}
    overview-tab.tsx          facts, contact, notes, pricing card with overrides, hold, reminders, add-note
    timeline-tab.tsx          events + emails merged newest first, with change diffs and status badges
    emails-tab.tsx            thread (bodies from GET /inbox/messages/:id), sandboxed HtmlFrame, reply composer,
                              send log
    documents-tab.tsx         previews (POST preview → new tab), issue proforma without sending, versions table
    payments-tab.tsx          table + totals, record, delete (bank-linked rows explain why they cannot be deleted)
    questions-tab.tsx         inline answers, add question, "Send answers" (confirmed through SendDialog)
```

## Calendar encoding (dataviz skill applied)

- Heat = `total_people` in fixed bands 1–99 / 100–249 / 250–499 / 500–799 / 800+
  → `--heat-1…5`; empty days stay `bg-card`. Fixed bands (not the month's max)
  so months are comparable and the legend is stable.
- The shell's ramp was converted to hex and run through the skill's validator
  (`--ordinal`, both modes): monotone lightness, every step gap ≥ 0.06 L, single
  hue. The lightest step sits 1.16:1 from the surface — the documented
  sequential allowance — so cells also carry a hairline border, the numbers
  and the bar as secondary encoding.
- Text on the fill was chosen from measured WCAG contrast, not the shell's
  "1–3 foreground / 4–5 primary-foreground" rule of thumb: light steps 1–4 use
  `--foreground` (≥ 5.09:1) and step 5 `--primary-foreground` (6.94:1); dark
  steps 1–3 use `--foreground` (≥ 5.93:1) and steps 4–5 a deep green-black
  `oklch(0.12 0.02 150)` (4.9:1 / 6.2:1) because both standard tokens fail on
  dark step 4 (3.84 / 4.35). Rules live in `features/calendar/calendar.css`.
- Split bar: solid = confirmed, 38 % tint = tentative, track = 10 % foreground.
  The bar colour is the accent on light steps and `currentColor` once the fill
  is deeper than the accent (light 4–5, dark 3–5) so it never disappears.
- Closed = diagonal hatch over the fill; avoid = dashed border; peak = flame;
  capacity warning = red dot with tooltip; today = ring in `currentColor`.

## Keyboard and accessibility

- Grid: `role="grid"` / `row` / `columnheader` / `gridcell`, one roving
  `tabIndex=0`, `aria-label` per cell ("Saturday, 7 November 2026, 5 bookings,
  167 confirmed of 368 people"), `aria-selected` for the open day. Arrows move
  a day/week, Home/End to Monday/Sunday, PageUp/PageDown change the month and
  keep focus (verified with Playwright: PageDown from 15 Nov lands focused on
  15 Dec), Enter/Space open the panel, Escape closes it.
- Disabled actions are wrapped in a focusable span with a tooltip and an
  `aria-label` carrying the reason; menu items state the reason inline.
- Every send/state change goes through `ConfirmDialog` stating To, Attachment
  and Then (effect); reasons are required where the API requires them.
- Icon buttons carry `aria-label`; day-cell markers are `aria-hidden` and
  described in the cell label instead.

## Data-shape notes for the lead / backend

- `GET /days/:date` items are **not** list items: they carry `paid_total`,
  `finance` and `payments` but no `balance_due`, `total_amount`,
  `deposit_covered` or `status_label`. `DayViewBooking` reflects the real
  shape; the bookings handoff says "list item fields".
- `gmail_thrid` and `email_thread_id` are JSON **numbers** in the booking
  detail and lose precision in JS; the UI never uses them (message ids only).
  Worth serialising as strings like the inbox API does.
- The Emails tab fetches bodies from `GET /inbox/messages/:id` on expand (the
  booking's `emails` have no body). The iframe uses
  `sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"`
  with a CSP meta (`default-src 'none'; img-src https: http: data: cid:;
  style-src 'unsafe-inline'`), no scripts/forms/top-navigation. `allow-same-origin`
  is there only so the parent can measure the document for auto-height;
  with scripts blocked the content cannot reach the parent. Links open in a
  new tab via `<base target="_blank">`.
- Bank-linked payments link to `/payments?transaction=<bank_transaction_id>`;
  the payments agent may want to honour that query parameter (or tell me the
  right one).
- `POST …/documents/preview` is fetched directly (not through `api`) because
  the client returns text for non-JSON bodies; the blob is opened in a tab
  that is created synchronously on click so popup blockers allow it.
- `group_types` come from `GET /settings` (admin). If a manager-safe source
  appears (e.g. `/public/form-config`), `useGroupTypes` in `features/bookings/lib.ts`
  is the one place to switch.

## Requests for the lead

- No new routes or shared components were needed. `features/bookings/types.ts`
  holds the API types for these pages; move them into `src/types/api.ts` if
  you want one file.
- The breadcrumb for `/bookings/:id` reads "Booking 130"; a `crumb` that reads
  the loaded reference would need route loader data (router is yours).
- `/payments?transaction=<id>` — see above.

## Verification

Dev server `VITE_API_TARGET=http://127.0.0.1:5100 pnpm dev --port 5174`
against the real imported data. Playwright flows (venv) exercised, on a
booking created through the UI (`TEST F2 Playwright Group`, since deleted
together with its email rows, document files and the two scratch users):
create → send proforma → record payment → add note → add + answer question →
reply with the proforma attached → waive deposit → confirm with reason →
record arrivals from the day page (status → completed). Two emails were sent
(both to the dev recipient). WhatsApp was never run. No real booking was
modified.

Screenshots (`/tmp/claude-1000/-home-ray-repos-python-loyverse-manager/2fb501b6-0235-4643-9dc0-c7575f60f59e/scratchpad/`):

```
f2-calendar-light-1440.png   f2-calendar-dark-1440.png    f2-calendar-light-390.png
f2-calendar-panel-1440.png   f2-calendar-panel-390.png    f2-calendar-keyboard-panel-1440.png
f2-calendar-focus-ring-1440.png  f2-manager-calendar-1024.png
f2-day-light-1024.png        f2-day-dark-1024.png         f2-day-light-390.png
f2-day-empty-1024.png        f2-day-after-arrivals-1024.png  f2-manager-day-1024.png
f2-arrivals-dialog-1024.png  f2-gate-payment-dialog-1024.png
f2-bookings-light-1440.png   f2-bookings-dark-1440.png    f2-bookings-light-390.png  f2-bookings-filtered-1440.png
f2-detail-overview-1440.png  f2-detail-dark-1440.png      f2-detail-light-390.png    f2-detail-emails-1440.png
f2-detail-emails-390.png     f2-detail-notfound-1024.png  f2-create-dialog-1440.png  f2-send-dialog-1440.png
f2-after-send-1440.png       f2-test-created-1440.png     f2-reply-confirm-1440.png  f2-emails-after-reply-1440.png
f2-timeline-1440.png         f2-documents-1440.png        f2-payments-1440.png       f2-questions-1440.png
f2-deposit-dialog-1440.png   f2-confirm-dialog-1440.png   f2-confirmed-1440.png
```

## Known gaps

- CSV export of the list was optional and is not built.
- The bookings table scrolls horizontally inside its card below ~1100px (the
  shell's convention); a card layout for phones would be a follow-up.
- The Timeline merges `events` and the email summaries from the detail; it
  does not page — fine at today's volumes (≤ ~20 rows per booking).
- Reminder "dismiss" lives on the queue page (not here); the Overview only
  lists reminders with their status.
- `send-ticket-whatsapp` is wired and confirmed through the same dialog but
  was not exercised (the brief forbids it); the 502 path surfaces as the
  dialog's inline error.
