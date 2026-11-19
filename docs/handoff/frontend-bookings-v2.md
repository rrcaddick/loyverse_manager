# Frontend bookings v2 — handoff

Owner: Bookings page agent. Scope: `frontend/src/pages/bookings/**`,
`frontend/src/features/bookings/**`, this note, and the screenshot script
`frontend/scripts/shoot-bookings.py`. Built on the foundation v2
(`docs/handoff/frontend-foundation-v2.md`) against spec §6
(`docs/redesign-spec.md`), research note 04 and the backend handoffs
(`bookings.md`, `backend-v2-misc.md`, `mail-v2.md`). `pnpm typecheck`,
`pnpm lint` and `pnpm build` pass.

## Running and verifying

```bash
cd frontend && VITE_API_TARGET=http://127.0.0.1:5100 pnpm dev --port 5313
.venv/bin/python frontend/scripts/shoot-bookings.py --phase shots     # read-only: lists, records, mobile
.venv/bin/python frontend/scripts/shoot-bookings.py --phase flow      # creates "TEST P3 Playwright", 1 email send
.venv/bin/python frontend/scripts/shoot-bookings.py --phase cleanup   # deletes the TEST booking, its mail rows and thread
```

The script logs in as `FY_SHOT_EMAIL` / `FY_SHOT_PASSWORD` (default: the
scratch admin used during the build, which was deleted at the end — create a
new one with `src.services.users.create_user`). Real bookings are only ever
opened read-only.

## What was built

| Route | File | Summary |
| --- | --- | --- |
| `/bookings` | `pages/bookings/BookingsPage.tsx` | One list split by status: `SegmentedTabs` with counts from `GET /bookings/counts` (Pending default · Confirmed · Lapsed · Past · All, `?bucket=`), one search box (reference, group, contact, phone, area), an Upcoming / This month / Past / All dates range, per-tab columns and default sort, 25 a page, 48 px rows, the ref a real link, the whole row clickable. Cards below `md`. State in the URL (`tab, q, range, sort, page`; only non-defaults written). |
| `/bookings/:id` | `pages/bookings/BookingDetailPage.tsx` | The record: header, two tabs (Booking · Conversation with the email count), main column (NextStepStrip, money card, questions when any, Activity) and the rail (Details, Contact, Documents, Hold & reminders or Reminders, Internal note, Record). Keys `E` edit, `N` note, `Esc` closes dialogs (Radix). |

## Component map

```
features/bookings/
  types.ts            API shapes; billing_address / customer_vat_number; BookingCounts; BookingBucket;
                      DOCUMENT_KIND_LABELS = Proforma / Statement / Tax invoice (backend-v2-misc §2)
  api.ts              queries + mutations; useBookingCounts() → the full counts object;
                      invalidateBookingWorld() → ["bookings"], ["calendar"], ["day"], ["work"], ["today"],
                      ["queue"], and on a detail also ["inbox"], ["mail"], ["bookings", id, "conversation"]
  list-params.ts      URL ⇄ ListState (tab, range, q, sort, page), TAB_DEFAULTS, stateForTab()
  actions.ts          availability(detail, action) → {enabled, reason?, hidden?}; ACTION_LABELS;
                      REMINDER_COPY, STATUS_CHANGE_COPY, confirmNeedsReason, proformaIsStale, latestDocument
  next-step.ts        nextStep(detail) → {urgency, icon, title, detail, primary, secondary} — the ONE rule set
  money.ts            moneyState(detail) → the ladder's state word
  lib.ts              useGroupTypeLabel, holdState, relativeTo/relativeDays, lastStatusReason, …
  use-booking-actions.ts  context + hook: run(verb), send(action), openEdit(focus), openPayment, openArrivals,
                      openHold, changeStatus(target), focusNote, noteRef
  components/
    booking-actions.tsx    BookingActionsProvider — owns every dialog and runs StepVerbs
    record-header.tsx      RecordHeader (eyebrow, 24 px name + StatusPill, facts line, primary verb, Edit, ⋯
                           in Send / Record / Status groups), NextStepCard (NextStepStrip bound to nextStep),
                           VerbButton, Gated
    money-card.tsx         MoneyLadder (Total / Deposit / Paid ▸ / Balance) + expandable payment rows with
                           Record payment and delete (bank-linked rows explain why not), pricing footer
                           (tier, rate, peak, override tags with the reason on hover, deposit rule)
    activity.tsx           composer on top (N focuses it, Ctrl+Enter adds), chips All · Notes · Emails · Money ·
                           Changes, newest first by day; notes and emails as cards ("Open in Conversation"),
                           money / status / document / ticket / arrival events as one-liners with a pill,
                           "n fields changed" and the sheet-import burst collapsed and expandable;
                           email_sent / email_received events are dropped when the email itself is in the stream
    questions-card.tsx     only when questions exist; inline answers; Send answers (gated with the reason)
    rail.tsx               collapsible cards: Details (six lines), Contact (tel/mailto, billing address and VAT
                           number when present), Documents (latest proforma / statement / tax invoice with
                           Preview — issued → PDF, unissued → rendered now — and Send; All versions; Issue
                           proforma without sending), Hold & reminders (tentative) / Reminders (firm, when
                           any), Internal note (inline edit → PATCH), Record (barcode + copy, source incl.
                           "Imported from the booking sheet (row n)", enquiry, created, updated, tier)
    booking-form-dialog.tsx  create / edit: Visit (date, alternative, visitors, arrival, vehicles, gazebos),
                           Group (name, kind of group from settings, area), Contact (+ "Invoice details"
                           disclosure: billing address, VAT number), Pricing (live line
                           "45 × R 95 = R 4 275 · deposit R 3 800 · tier"; "Price and deposit overrides"
                           disclosure: special price + reason, deposit standard / custom + reason / waived +
                           reason), Notes; sticky footer; `focus="contact" | "pricing"` opens on those fields.
                           Props unchanged for the calendar and day pages (open, onOpenChange, defaultDate, onCreated)
    send-dialog.tsx        the ConfirmDialog for every send: To / Attachment / Then (+ reason, attach statement)
    record-payment-dialog.tsx  unchanged API; the default amount is now the deposit outstanding while the deposit
                           is not covered, else the balance
    arrivals-dialog.tsx, status-dialog.tsx, hold-dialog.tsx
    list-columns.tsx       columnsFor(tab); list-cards.tsx  BookingCards (phones)
pages/bookings/BookingsPage.tsx, BookingDetailPage.tsx
```

Removed: `action-bar.tsx`, `overview-tab.tsx`, `documents-tab.tsx`,
`emails-tab.tsx`, `payments-tab.tsx`, `questions-tab.tsx`,
`timeline-tab.tsx`, `override-dialogs.tsx`, `shared.tsx`. The calendar and
day pages only ever imported `types`, `lib` (`useGroupTypeLabel`), `api`
and the three dialogs, all of which keep their signatures.

## List columns (research note 04)

| Tab | Columns | Default sort · range |
| --- | --- | --- |
| Pending | Ref · Group/contact · Visit · Visitors · Status · Deposit due · Hold expires (relative; amber ≤ 3 days, red when past; date beneath) | `hold_expires_on` · upcoming |
| Confirmed | Ref · Group/contact · Visit · Visitors · Paid of total (`R 5 000 / R 9 025`) · Balance (`credit R…` blue when overpaid) · Ticket ✓ · Arrived | `visit_date` · upcoming |
| Lapsed | Ref · Group · Visit · Visitors · Status · When (cancelled_at / lapsed_at) · Reason | `-updated_at` · all dates |
| Past | Ref · Group · Visit · Visitors · Arrived · Paid · Status | `-visit_date` · all dates |
| All | Ref · Group/contact · Visit · Visitors · Status · Paid of total · Balance | `-visit_date` · all dates |

A search widens the range to all dates unless one was chosen. Switching tab
resets sort, range and page; the search stays.

## Next-step rules (`next-step.ts`)

Evaluated in this order; the first match wins. Urgency colours the strip's
edge and icon only. `[primary]` is the filled verb, the rest are ghosts. A
send the booking cannot receive (no email) becomes **Add email address**
(Edit on the contact fields); a ticket with a mobile but no email becomes
**WhatsApp ticket**; neither → **Add contact details**.

| State | Urgency | Title (example) | Verbs |
| --- | --- | --- | --- |
| cancelled / lapsed / no_show | neutral | "Lapsed 3 Oct 2026 — reason" | [Reopen as enquiry] when allowed |
| completed, no tax invoice | amber | "Arrived 41 of 45 — send the tax invoice" | [Send tax invoice] · Record payment when owed |
| completed, tax invoice sent | green / amber if owed | "Done — tax invoice sent, paid in full" / "Tax invoice sent — R… still owed" | — / [Record payment] · Send payment confirmation |
| confirmed, visit passed, no arrivals | red | "Visited Sat 17 Oct — record the arrivals" | [Record arrivals] · Mark no-show |
| confirmed, visiting today | blue | "Visiting today — 95 visitors from 09:30" | [Record arrivals] · Send ticket if not sent |
| confirmed, no ticket | amber | "Confirmed — send the vehicle ticket" | [Send ticket / WhatsApp ticket / Add contact details] · WhatsApp ticket |
| confirmed, ticket sent, balance | neutral | "Ticket sent — R 4 025 due on the day" | [Record payment] · Send final details |
| confirmed, paid in full | green | "Paid in full — ticket sent" | [Send final details] |
| tentative, no email | amber | "No email address — add one to send the proforma and documents" | [Add email address] · Record payment |
| enquiry (no proforma yet) | amber | "New enquiry — send the proforma" | [Send proforma] · Send answers when unanswered questions, else Record payment |
| deposit waived / covered but not confirmed | amber | "Deposit waived / covered — confirm the booking" | [Confirm booking] · Record payment |
| hold expired | red | "Hold expired 2 days ago — R 3 800 deposit not received" | [Send expiry notice] (status Mark lapsed without an email) · Extend hold · Record payment |
| hold ≤ 3 days | amber (red today) | "Hold expires in 2 days — R 3 800 deposit not received" | [Record payment] · Send deposit reminder · Extend hold |
| part-paid | amber | "Deposit R 3 800 — R 2 000 received, R 1 800 short" | [Record payment] · Send payment confirmation |
| a deposit / still-interested reminder is due | amber | "Deposit R 3 800 due by Sun 15 Nov — nothing received" | [Send deposit reminder / Send “Still interested?”] · Record payment |
| otherwise (proforma sent) | amber | "Deposit R 3 800 due by Sun 15 Nov — nothing received" | [Record payment] · Send deposit reminder |

The detail line adds "n questions to answer" when any are unanswered. These
follow the Work verbs in `docs/handoff/work-today.md` (reminders → Send
reminder, holds past → expiry/extend, arrivals → Record, tickets → Send ticket
/ Add contact).

## Primary-verb rules (header)

The header's one filled button **is** `nextStep(booking).primary`, so it
never disagrees with the strip: Send proforma → Record payment → Send ticket →
Record arrivals → Send tax invoice, with Add email address / Add contact
details substituted when a send is impossible, Confirm booking when the deposit
is waived or covered, and Reopen as enquiry on ended bookings. `Edit` and `⋯`
sit beside it. The overflow has three groups: **Send** (proforma, statement,
tax invoice, email ticket, WhatsApp ticket, Reminder… ▸ still interested /
deposit / final details, answers, payment confirmation, acknowledgement on
enquiries), **Record** (payment, arrivals, note), **Status** (Confirm booking
through the confirm action, `allowed_transitions` with destructive ones red,
Send expiry notice on tentative bookings). `availability()` marks an action
`hidden` when the status makes it meaningless (left out) and `enabled: false`
with a `reason` when a person can unblock it (shown beneath the item). Every
send goes through `SendDialog` (To / Attachment / Then).

## Money card

`moneyState()`: Overpaid R… (blue) → Paid in full (green) → Nothing due
(ended) → Deposit waived → Deposit paid (green) → Deposit outstanding
(amber). Rows: Total (`95 × R 95 · VAT R 1 177.17`; after arrivals `41 arrived
× R 95 · 45 booked` on the final amount), Deposit (`due 15 Nov · ✓ paid`,
`R… short`; amber until covered), Paid (`n payments`, click ▸ expands the
rows + Record payment), Balance (emphasis; "Credit" when overpaid, red when
owed after completion). Overrides are tags in the pricing footer with the
reason on hover; "Edit pricing" opens the edit dialog on the Pricing
disclosure.

## Mutations and keys

Every mutation goes through `invalidateBookingWorld` (keys above) and
writes the returned detail into `["bookings", id]`. `E` opens Edit, `N`
focuses the note composer (on the Conversation tab the Mail agent's
ConversationView owns `N` for its own note — the most recent registration
wins, as intended). The Conversation tab lazy-loads
`@/features/mail/conversation-view` (`ConversationView({ bookingId })`); the
file existed when this was built, so nothing was stubbed.

## Shared-component requests (for the foundation / lead)

1. **Breadcrumb**: the route crumb for `/bookings/:id` reads "Booking 125"
   (the id). Spec wants `Bookings › FY1681`; the page shows the reference as
   an eyebrow for now. A route loader (or the crumb reading the
   `["bookings", id]` cache) could supply the reference.
2. **NextStepStrip** on narrow screens: the text block (`min-w-0 flex-1`)
   shrinks before the action group wraps. The page passes
   `className="max-sm:[&>div:first-of-type]:basis-full"` as a workaround;
   the component should do that itself (`basis-full sm:basis-auto` on the
   text, or wrap the actions).
3. **MoneyLadder** on narrow screens: both the label and the note truncate
   (`Total` → `T…`). Letting the note wrap under the label below `sm` would
   remove the need to hide note fragments on phones.
4. **Keyboard cheat sheet**: `KeyboardCheatSheet` accepts `extra` groups but
   the layout mounts it without a way for a page to register rows; the
   record's `E` / `N` are not listed. A `useShell().registerKeys(group)` or
   a route `handle.keys` would do.
5. **DataTable**: a `rowHeight` prop (or `py` meta default) would avoid every
   column setting `meta.className: "py-1.5"` to reach 48 px two-line rows;
   `rowClassName="h-row-lg"` sets the floor.
6. **EmptyState inside DataTable** still renders the column header row above
   it; fine, but a `hideHeaderWhenEmpty` option would look cleaner on the
   Lapsed / Past tabs while they are empty.

## Backend requests

- **`status_reason` on list items**: the Lapsed tab's Reason column reads
  `item.status_reason` (typed optional) and shows "—" until the API carries
  the reason of the last `status_changed` event.
- **Sort by `lapsed_at` / `cancelled_at`**: not in `SORTABLE`; Lapsed sorts
  by `-updated_at` meanwhile.
- `web/api/bookings.py` `DOCUMENT_LABELS` still says "Invoice" / "Final
  invoice" in event summaries (already flagged in backend-v2-misc §9); the UI
  labels documents from `documents[].label` / its own map, so only the
  `document_issued` summaries differ.

## Screenshots (`data/screenshots/v2/p3-*.png`)

- Lists: `p3-list-{pending,confirmed,lapsed,past,all}-{graphite-light,fynbos-dark}-{1440,1920}.png`,
  `p3-list-pending-mobile-390.png`.
- Real confirmed booking, read-only: `p3-record-confirmed-{theme}-{vp}.png`,
  `p3-record-confirmed-mobile-390.png`.
- TEST booking flow (1440, Graphite light): `p3-flow-01-create-dialog` →
  `02-enquiry` → `03-send-proforma-confirm` → `04-proforma-sent` →
  `05-record-payment-dialog` → `06-confirmed` → `07-note` →
  `08-arrivals-dialog` → `09-completed` → `10-edit-dialog` →
  `11-conversation` → `12-overflow-menu`; `p3-record-test-{theme}-{vp}.png`,
  `p3-record-test-conversation-{theme}-{vp}.png`, `p3-record-test-mobile-390.png`.
  (The flow shots 02–09 predate two cosmetic changes — the facts line no
  longer repeats the email, and override tags moved to the pricing footer;
  the `record-test-*` shots are current.)

## Gaps and notes

- The live price line in the dialog is a client-side estimate of
  `src/services/pricing.py` (weekend by weekday, peak from `season_days`,
  the no-discount window, the deposit rule); public holidays are not known
  client-side, so a holiday weekday shows the weekday price until save
  recalculates. The line says "recalculated on save" whenever it is an
  estimate.
- `send-proforma` stays available on completed bookings because the API
  allows it (status active); it sits in the overflow only.
- WhatsApp ticket delivery was not exercised (no WhatsApp sends allowed);
  the confirm dialog and the action call are unchanged from the first build.
- The import burst is detected as every event sharing the `created`
  event's timestamp plus any `status_changed` carrying `sheet_row`; an
  import that spans two seconds would show one extra line.
- The TEST booking (FY3714, "TEST P3 Playwright") and the scratch admin
  `test-p3@example.com` were deleted at the end of the build; one
  dev-redirected proforma email was sent from it and its `email_messages`
  / `email_threads` rows were removed with it.
