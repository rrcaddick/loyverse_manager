# Today, Work and Gate — frontend handoff

Owner: the Today + Work + Gate page agent, branch `feat/booking`. Built on the
foundation in `docs/handoff/frontend-foundation-v2.md` against the APIs in
`docs/handoff/work-today.md` (GET /today, GET /work, /work/counts, the action
vocabulary, dismiss and extend), `docs/handoff/backend-v2-misc.md` §8 (GET /gate)
and `docs/handoff/bookings.md` (arrivals and payments). Spec: `docs/redesign-spec.md`
§3, §4 and the day-view part of §5.

Files I own:

| Path | What |
| --- | --- |
| `frontend/src/pages/today/TodayPage.tsx` | `/today` and `/today/:date` — home and day view in one screen |
| `frontend/src/pages/calendar/DayPage.tsx` | re-exports `TodayPage` so the first build's imports keep working |
| `frontend/src/pages/work/WorkPage.tsx` | `/work` — rail, list, detail panel, pagination, Dismiss all |
| `frontend/src/pages/gate/GatePage.tsx` | `/gate` — arrivals, open tickets, morning sync |
| `frontend/src/features/today/` | `types.ts`, `api.ts` (`useToday`, arrivals mutations, row shaping), `components/day-table.tsx`, `arrivals-popover.tsx`, `seven-day-strip.tsx`, `system-status-line.tsx` |
| `frontend/src/features/work/` | `types.ts` (rows, the action vocabulary, counts), `api.ts` (queries + every mutation), `use-work-actions.tsx` (the dispatcher), `components/work-row.tsx`, `work-detail-panel.tsx`, `action-dialogs.tsx` |
| `frontend/src/features/gate/` | `types.ts`, `api.ts` (`useGate`, `rowsFromGate`) |

Run: `cd frontend && VITE_API_TARGET=http://127.0.0.1:5100 pnpm dev --port 5311`.
`pnpm typecheck` and `pnpm lint` are clean for every file above (other agents'
in-flight files were failing typecheck at handover; see "Build" below).

## 1. Today (`/today`, `/today/:date`; admin and manager)

Exactly spec §3 plus the day-view part of §5, no scrolling at 1440×900 with
six groups (measured: document height = viewport height in both themes and
both sizes, 841 px of content under the 56 px header).

- **Header strip**: `‹ Saturday 7 November ›` (the API's `label`, computed
  locally while it loads) · relative word ("Today", "In 10 days") · right:
  `Today` (with the `T` keycap, only when not on today) · `Calendar` (links
  `/calendar?from=<Monday>&day=<date>` for the v2 calendar; the first build's
  page ignores the extras) · `Add booking` (admin; the shared
  `BookingFormDialog` with `defaultDate`, then navigates to the new booking).
  Flags beneath as `StatusPill`s: Weekday/Weekend rate (neutral), Closed
  (red-muted, with the season label), Peak day (amber), a holiday/season label
  (blue). Keys: `T` today, `←`/`→` previous / next day.
- **Tiles** (`BigNumberRow`): admin **Groups today** (total · arrived),
  **People** (total · confirmed), **Owed at the gate** (total · paid; amber
  when > 0), **Needs you** (count · oldest, the tile links to `/work`).
  Manager: **Expected** (people · groups), **Arrived** (Σ `arrived_count`
  · groups arrived, green when > 0), **Still to come**.
- **The day's groups** as a 56 px table (`DayTable`), left two-thirds for
  admin, full width for the manager: Group (name 15/600 linking to the
  booking for admin; `FY1678 · Church group` 12 px), Expected (people; arrival
  time or "time not set", vehicles), Arrived (count with source and time, or
  `— Enter`), Balance [admin] (amber when owed with "R 4 500 paid" beneath;
  green "✓ Paid" at zero), Status (`StatusPill`, plus a `TicketX` icon with a
  tooltip when a confirmed group's ticket has not been sent), one `⋯`. Rows
  sort by arrival time (unset last) then size; an arrived row is tinted
  `bg-green-soft/40`.
- **Inline Enter** opens `ArrivalsPopover` anchored on the cell: a number
  input (defaults to the booked count), Save → `POST /bookings/:id/arrivals`
  with `source: "manual"`, and "Fetch from Loyverse" → `GET /bookings/:id/arrivals`;
  the fetched count fills the input and saving it records `source: "loyverse"`.
  The `⋯` menu: Fetch from Loyverse (opens the popover and fetches at once),
  Enter arrivals, Record gate payment (the shared `RecordPaymentDialog` in
  `mode="gate"` — cash/card — with the booking's finance loaded first so the
  balance prefills), Open booking [admin]. Every mutation invalidates
  `["today"] ["day"] ["gate"] ["calendar"] ["bookings"] ["work"] ["queue"]`
  (`invalidateDayWorld`), so the row, the tiles, Gate and the Work badge refresh.
- **Closed or empty day**: a card with "The park is closed today." / "No
  groups today.", "Next visit day: Fri 16 Oct · 1 group · 24 people" with
  `Open day →`, and the `SevenDayStrip` (weekday, day, `3 grps · 300`; closed
  days hatched; today ringed; each cell opens that day).
- **Right third (admin)**: **Up next** — the first five `up_next` rows as
  compact `WorkRow`s with their primary verb (sends go through the same
  confirmation as on Work; clicking a row goes to `/work`), "All work →";
  then the **System** line "Mail 21:39 ✓ · Bank 21:35 ✓ · Loyverse sync off ●"
  linking to `/system` (green tick = ok, red dot = problem, grey = off).
- Data: `GET /today?date=` (`["today", date]`, 60 s refresh). `/today` groups
  carry no `group_type` or arrival source, so the page also reads
  `GET /days/:date` (`useDay`, `["day", date]`) once there are groups and
  merges those two fields in (`mergeDayRows`).

## 2. Work (`/work`, admin)

- **KindRail** on the left: Up next (always) · Reply (blue) · New requests ·
  Confirm money · Send tickets · Reminders · Holds lapsing (amber) · Record
  arrivals · Stale (muted); counts from `GET /work/counts` (and from the list
  response, which carries the same object); hidden at zero. The view and page
  live in the URL (`?view=reply&page=2`), so the Today tile and links work.
- **One list** of 56 px `WorkRow`s: status dot (booking status; amber for an
  unmatched credit) · `FY1737` **Group** · `Sat 7 Nov · 24 people` · amount |
  the context line | right edge: ghost secondary (`secondary[0]`) · the one
  filled primary · `⋯` for the rest. Money rows lead with the amount then the
  bank description. A 3 px edge bar marks urgency: red for a hold already
  past, amber for an arrival to record or anything waiting ≥ 7 days (off in
  Stale). The date/people meta hides below a 36 rem row width (container
  query), which is what happens when the detail panel narrows the list.
- **Reminders** groups rows by `group` with a `SectionHeader` and count;
  **Stale** adds "Dismiss all stale" in the page header behind a destructive
  `ConfirmDialog` → `POST /work/reminders/dismiss {all_stale: true}`.
- **Detail panel** (`WorkDetailPanel`, right of the list at ≥ xl, below it
  otherwise): reference, group, `StatusPill`; the facts line (date · people ·
  type · arrives); contact line; hold date; `MoneyLadder` (Total with `n × R`,
  Deposit with the due date, Paid with the payment count, Balance) and a state
  word; the latest email (direction dot, from, date, subject, three-line
  snippet); footer: Open booking, Open in Mail (when the row has a thread),
  Open in Bank (money rows) and the row's primary verb. Clicking a row or
  pressing Enter on it toggles the panel; Esc closes it.
- **Keys**: `J`/`K` move DOM focus between rows (`[data-work-row]`), `Enter`
  selects, `1`/`2` fire the focused row's primary/secondary verb (handled on
  the row, so a verb that needs input opens its popover or menu), keycaps
  appear on the focused row's buttons. All of these are already in the
  global cheat sheet.
- **Pagination** at 50: "Showing 1–50 of 78" with Previous / Next.
- **Empty states** per view with a hint and a pathway link (`EmptyState`).

### Action handling (`features/work/use-work-actions.tsx`)

`useWorkActions()` returns `{ run, dialogs, busyRow }`; `run(action, row, input?)`
is passed to every row (Work and Today's Up next) and mounts `dialogs` once.

| action | what happens |
| --- | --- |
| `open_conversation` | `navigate("/mail/<thrid>")` |
| `open_booking` | `navigate("/bookings/<id>")` |
| `open_transaction` | `navigate("/bank?tx=<id>")` (the Bank drawer) |
| `open_day` | `navigate("/today/<date>")` |
| `booking_action`, `send_reminder` | `BookingActionDialog` (a `ConfirmDialog`) loads the booking and names the channel and recipient ("Email to jane@…" / "WhatsApp to 082 …"), the attachment (the proforma's filename, "the vehicle ticket (PDF)" / "(image)", "the statement", "the tax invoice", or "Nothing") and the visit; a missing email/mobile is shown in red once the booking has loaded. Confirm → `POST /bookings/:id/actions/<name>` with the row's extra keys (`kind`) as the body. Sends are never silent. |
| `match_transaction` | `POST /payments/bank-transactions/:tx/match {booking_id}` at once; `toastWithUndo("R 3 800 recorded on FY1698")` whose Undo calls `…/unmatch`; then, if the booking's deposit is now covered and it has an email, `toastWithAction("Deposit covered…", "Send payment confirmation")` which opens the same send dialog. |
| `ignore_transaction` | with a fixed `reason` ("Not a booking") it fires at once as `{reason: "other", note: "Not a booking"}`; otherwise the ghost button is a reason menu (Not a booking · Own transfer · Card settlement · Interest · Other) and in `⋯` a submenu → `POST …/ignore {reason, note?}`. |
| `dismiss_reminders` | `POST /work/reminders/dismiss {ids}`; toast "Reminder dismissed" (no undo, as agreed). |
| `extend_hold` | `ExtendHoldPopover` (a `Calendar` limited to today … the visit date) on the verb button, or anchored on `⋯` when chosen from the menu; Extend → `POST /work/holds/:id/extend {hold_expires_on}`. |
| `set_status` | `SetStatusDialog` ("Mark as no show?", destructive) → `POST /bookings/:id/status`. |

A finished row leaves every list immediately (`removeWorkRow` edits the
cached `["work","list",…]` pages and Today's `up_next`), then
`invalidateWorkWorld` refetches `["work"] ["today"] ["bookings"] ["bank"]
["payments"] ["mail"] ["inbox"] ["queue"] ["day"] ["calendar"] ["gate"]`.
Errors are toasted by the mutation cache and the row stays. `busyRow`
disables the row's buttons while its call is in flight.

Keyboard-triggered popovers and menus: a popover opened from a dropdown
menu item is dismissed by Radix's focus return to the trigger, so both the
day table and `WorkRow` open menu-chosen popovers from the menu's
`onCloseAutoFocus` (and prevent the focus bounce). Keep that pattern if you
add more.

### Query keys

`["work","list",view,page]` (50 per page, 60 s refresh, carries `counts`),
`["work","counts","full"]` (the full counts object). The sidebar's
`useNavCounts` stores a *number* under `["work","counts"]`, so the full
object lives one level deeper; both share the `["work"]` prefix and every
mutation here invalidates it, so the badge, the rail and the Needs-you tile
refresh together. `["today",date]`, `["gate",date]` (30 s refresh).

## 3. Gate (`/gate`, admin and manager)

`GET /gate` for today: four tiles (Groups today · Expected · Arrived · Owed at
the gate [admin]); **Arrivals** — the same `DayTable` in `compact` (48 px)
mode with the full arrivals and gate-payment behaviour; **Open tickets** —
one 56 px row per held ticket (name or ticket id, device · employee · reason,
a vehicle line, total [admin], items and the last change time; everything
nullable); **Morning sync** — a status pill (Ran OK / No event today / Failed
/ Running / Not run yet), schedule ("Daily at 06:01 · cleared at 18:00" or
"Off — runs by hand only"), last run, finished, summary, the clear-inventory
run, and for admins **Run morning sync** behind a `ConfirmDialog` that warns
it takes minutes → `POST /ops/run {name: "add_inventory"}` (`useRunJob`),
toasting the outcome and refreshing `["gate"]` and `["today"]`. Refresh
button and a link to Today in the header.

## 4. Verification

Playwright (`.venv/bin/python -m playwright`, Chromium) against the dev
server at :5311 and the API at :5100, as a scratch admin and a scratch
manager (both deleted afterwards), Graphite light and Fynbos dark at 1440×900
and 1920×1080. Screenshots in `data/screenshots/v2/`:

- `p1-today-closed-*`, `p1-today-groups-*` (2026-11-07, six groups),
  `p1-work-up-next-*`, `p1-work-reply-*`, `p1-work-confirm-money-*`,
  `p1-work-reminders-*`, `p1-work-stale-*`, `p1-gate-*` — each in
  `{graphite-light,fynbos-dark}-{1440,1920}`.
- Interaction states at 1440 Graphite: `p1-work-panel-*` (row selected, panel
  open), `p1-today-arrivals-popover-*`, `p1-today-row-menu-*`,
  `p1-work-extend-popover-*`, `p1-work-send-dialog-*`,
  `p1-work-ignore-submenu-*`, `p1-today-arrived-row-*` (a recorded, paid,
  completed row).
- Manager: `p1-manager-today-groups-*`, `p1-manager-gate-*` (`/work` redirects
  the manager to `/today`).

Functional pass on `TEST P1 …` bookings only (created through `POST /bookings`,
reminders inserted directly): Extend hold via `1` → popover → Extend (hold
moved 9 → 11 Oct); Send reminder via the confirm dialog (one dev-rewritten
email, reminder marked sent, row left the list); Dismiss via `⋯`; Send ticket
via `1` → dialog → confirm (second dev-rewritten email); Enter arrivals (12,
then 13 from the `⋯` menu — booking completed, row re-rendered live with the
count, source and time); Record gate payment (R1 900 cash, prefilled from the
balance); `J` focuses, `Enter` opens the panel, `Esc` closes it; Stale's
Dismiss all opens its confirm (cancelled). No real reminder, credit, hold or
booking was touched; no WhatsApp was sent. `match`/`unmatch`/`ignore` were
not fired (real bank rows only); their code paths mirror the Bank page's
existing mutations, and the Ignore reason menu and submenu were opened and
cancelled. "Extend" chosen from a `⋯` menu (only on stale lapse rows, none
in the data) uses the same menu-to-popover pattern as the day table's
"Enter arrivals", which was exercised.

## 5. Shared-component and backend requests

- `GET /today` groups: add `group_type` and `arrived_source`/`arrived_at`
  so the page can drop its second request to `/days/:date`.
- `useNavCounts` could store the whole counts object (it already tolerates
  it through `sumCounts`); then `["work","counts"]` could be shared outright.
- `KeyboardCheatSheet` accepts `extra` groups but `AppLayout` does not pass
  any, so a page cannot add rows; the global map already lists my keys.
- `RecordPaymentDialog` wants a full `BookingFinance`; a `balance_due`-only
  prefill would save the detail fetch the gate menu does first.
- `KindRail` hides a view at zero even when it is the current view (e.g. a
  link to `?view=arrivals` with nothing to record): the page shows the empty
  state but the rail has no active item. A `value`-is-always-visible rule in
  the rail would fix it.
- The manager sees humanised group-type codes ("Church", "Nonprofit") because
  `GET /settings` is admin-only; a public group-type list (or the label on
  the row) would make the two roles read the same.
- `features/bookings` was being restructured while this was built; I import
  `useBooking`, `useGroupTypeLabel`, `relativeDayLabel`, `BookingFormDialog`
  and `RecordPaymentDialog` from it (plus `useDay` and `shiftDay` from
  `features/calendar`). If those move, these pages need the import paths
  updated.

## 6. Gaps

- `open_conversation` navigates to `/mail/<thrid>`; the Mail agent's
  conversation route must read that param.
- The money row's "n more" suggestions are not listed in the panel (the Bank
  page's drawer is the place to choose between them — "Open in Bank").
- Up next on Today reuses the full confirmation flow, but a send from there
  removes the row only from the cached `up_next`; the tile count refreshes
  on the next `["today"]` fetch (triggered at once).
- Gate shows today only (`?date=` is not read); add the ‹ › strip if the
  gate ever needs another day.
- Build: `pnpm typecheck`, `pnpm lint` and `pnpm build` all passed on the
  whole tree at handover (2026-10-08 evening); the bundle is in
  `web/static/app`.
