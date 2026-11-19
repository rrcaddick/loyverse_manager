# Frontend: queue, inbox, payments and public form — handoff

Owner: frontend queue/inbox/payments/form agent (F3). Branch `feat/booking`.
Built against `docs/handoff/frontend-shell.md` (tokens, components, API client,
query keys, form pattern) and the backend handoffs `ops.md`, `mail.md`,
`payments.md`, `bookings.md`.

`pnpm typecheck`, `pnpm lint` and `pnpm build` all pass on the whole tree
(build output in `web/static/app/`).

## Files (all new or replaced; nothing outside them was touched)

```
frontend/src/features/
  queue/
    types.ts            GET /queue section/item types (discriminated union on `key`)
    api.ts              useQueue (2 min refetch), useDismissReminder (optimistic)
    bookings.ts         the slice of /bookings used here: BookingSummary/ListItem/Detail,
                        useBookingSearch, useBookingDetail, useBookingAction
                        (POST /bookings/:id/actions/*), useUpdateBooking (PATCH),
                        useCreateBooking (POST), visitDateLabel ("Sat 14 Nov 2026")
    booking-line.tsx    <BookingLine> (ref · group · status / date · people · contact)
                        and <Facts> (label/value pairs with tones)
    booking-picker.tsx  <BookingPicker> cmdk search over GET /bookings?q=, <BookingFinanceMeta>
    extend-hold.tsx     <ExtendHoldButton> popover calendar → PATCH hold_expires_on
  inbox/
    types.ts            ListItem / FullMessage / Thread / Suggestion / Sync shapes (thrid = string)
    api.ts              list/message/thread/suggestions queries; attach, detach, resolve,
                        extract, bounce-back, sync, compose, reply-on-booking mutations;
                        paragraphsToHtml, replySubject, formatBytes
    format.ts           messageTime, counterpart (who a row is "from" for the reader)
    message-meta.tsx    <BookingChip>, <ReviewBadge>, <KindBadge>, <SenderAvatar>, <RowMarkers>
    message-list.tsx    left pane: tabs, search, rows, keyboard nav, paging
    message-body.tsx    sandboxed iframe renderer with auto height, remote-image opt-in, text fallback
    thread-view.tsx     reading pane: header, action bar, thread cards, attachments, dialogs
    attach-dialog.tsx   suggestions (score %, reasons) + search + whole-thread switch
    composer-dialog.tsx reply / compose (documents when linked to a booking)
    create-booking-dialog.tsx  extract → prefilled form → POST /bookings → attach thread → navigate
  payments/
    types.ts            BankTransaction, BankSuggestion, PaymentsSummary, filters, MATCH_STATUS_META
    api.ts              summary/transactions/transaction queries; match, unmatch, ignore, sync
    match-status-badge.tsx
    suggestion-picker.tsx  radio list of the matcher's candidates ("R 3 290.00 equals the deposit · …")
    dialogs.tsx         MatchBookingDialog (search), ConfirmSuggestionDialog, IgnoreDialog (presets), UnmatchDialog
    date-range-filter.tsx  popover range calendar
    transaction-drawer.tsx Sheet with facts, suggestions, manual match, unmatch/ignore/restore, raw entry
  public/
    types.ts            FormConfig, BookingRequestInput/Result, RequestSentState
    api.ts              useFormConfig, useSubmitBookingRequest (silent)
    schema.ts           zod mirror of public_form.validate_request (dateProblem, dayNote, buildSchema)
    turnstile.tsx       loads challenges.cloudflare.com only here; explicit render; reset handle
    visit-date-field.tsx calendar with closed weekdays/days disabled, peak markers, day note
frontend/src/pages/
  queue/QueuePage.tsx            summary strip + sections in server order + empty runs collapsed
  queue/shared.tsx               SECTION_META, QueueSectionCard, QueueRow, QueueList ("Show all"), helpers
  queue/sections/*.tsx           one file per section (needs-reply … lapsing)
  inbox/InboxPage.tsx            two-pane layout, URL state (view, q, page, booking_id), mobile swap
  payments/PaymentsPage.tsx      summary tiles, filter toolbar, DataTable, drawer via ?tx=
  public/RequestPage.tsx         the customer form
  public/RequestSentPage.tsx     confirmation (reads router state; graceful without it)
```

Query keys used: `["queue"]`, `["inbox", view, page, q, bookingId]`,
`["inbox","message",id]`, `["inbox","thread",thrid]`, `["inbox","suggestions",id]`,
`["payments","summary"]`, `["payments","transactions",params]`,
`["payments","transaction",id]`, `["bookings","list",params]`, `["bookings",id]`,
`["public","form-config"]`. Every mutation invalidates `["queue"]`; inbox and
payment actions also invalidate `["inbox"]` / `["payments"]` and `["bookings"]`;
booking actions fired from the queue invalidate `["bookings", id]`,
`["bookings","list"]`, `["queue"]` and `["inbox"]`.

## What each page does

### Queue (`/`)
- Eyebrow = business day, "Updated HH:MM", Refresh (spins while fetching), 2 min auto-refresh.
- Summary strip: one tile per section (count + title), anchor-scrolls to the
  section; zero tiles are muted. "152 items across 8 sections."
- Sections in the server's order. Non-empty ones are cards (icon, title, count,
  one-line description); runs of empty sections collapse into one dashed block of
  quiet "Visits this week · no groups this week" lines.
- Each list shows 6 rows (4 for payments, 5 per reminder group) with "Show all N".
- Rows: `BookingLine` + section facts + actions (right on desktop, below on phones):
  - needs_reply: message card (sender, relative time, "waiting N days" amber ≥ 3,
    subject, 2-line snippet); Open thread → `/inbox/:messageId`; Open booking.
  - unmatched_emails: Review → `/inbox/:id`; header link to `/inbox?view=review`.
  - new_requests: received/via/type/email/mobile/alternative facts; questions pill
    with "n unanswered"; Open booking.
  - payments_to_confirm: amount in accent, description, dated/seen; `SuggestionPicker`
    (first preselected); Confirm match → ConfirmDialog → POST …/match; More → `/payments?tx=:id`.
  - unmatched_credits: Match… (search dialog, finance meta per result, states what it
    settles) and Ignore (reason with presets); header shows the section total and a link
    to `/payments?status=unmatched&type=credit`.
  - reminders_due: grouped by kind with sub-headers; facts due/overdue (amber > 0, red > 7),
    deposit, hold expiry, email ("none on the booking" in red and Send disabled);
    Send → ConfirmDialog naming recipient and attachment per kind (lapse → `send-expiry`,
    destructive, says it lapses the booking); Dismiss is optimistic (row leaves at once,
    restored on error) via POST /reminders/:id/dismiss.
  - tickets_to_send: Email ticket / WhatsApp ticket ConfirmDialogs; each disabled when the
    channel is missing, with the missing fact shown in red.
  - visits_this_week: compact table (day → `/day/:date`, group → booking, arrival/vehicles/
    gazebos, people, status, ticket, balance due) with totals.
  - arrivals_to_record: Record arrivals → `/day/:date`, Open booking.
  - lapsing: hold "expires tomorrow · 9 Oct 2026"/"expired 2 days ago"; Extend hold
    (popover calendar bounded today…visit date, confirm inside) → PATCH; Send expiry (destructive).

### Inbox (`/inbox`, `/inbox/:messageId`)
- Left 380 px (300 px at md), right pane fills; both scroll independently inside
  `calc(100svh − header)`. Below 768 px the panes take turns ("All messages" back button).
- Tabs Review (amber count) / Unmatched / All; `?booking_id=` swaps the tabs for a
  "Mail for FY1758 …" chip (label fetched from the booking). Search is debounced
  300 ms into `?q=`; paging into `?page=`. Rows: sender (or "To: …" for outbound),
  time, subject, snippet, paperclip, robot (auto-generated), failed badge, booking
  chip or amber dot for pending. Arrow keys / j / k move, Enter opens, rows are real
  links with `aria-current`.
- Reading pane: subject, booking chip (link) or "Not linked", review badge, kind,
  "11 messages · 6 in, 5 out"; toolbar: Reply, Attach to booking (primary when pending)
  + Create booking, or Detach when linked; Mark resolved / Not a booking (pending) or
  Reopen review; Send form link (inbound + unlinked; shows "sent <date>" when a bounce-back
  already went). Thread cards in order, selected one expanded and scrolled into view,
  others collapsed to a snippet; attachments with size, open-inline (images/PDF) and download.
- Body rendering: `<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcdoc>`
  with a CSP meta `default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'`.
  No scripts can run (no `allow-scripts`), nothing external loads until "Load remote images"
  (then `img-src https: http: data:`), links open in a new tab, forms are dead. `allow-same-origin`
  is there only so the parent can measure the document for auto height (ResizeObserver on the
  body); with scripts off it hands the email nothing. Plain-text toggle; text-only messages
  render as `<pre>`.
- Attach dialog: suggestions from GET …/suggestions as a radio list (score as %, reasons),
  or `BookingPicker`; "Attach the whole thread (n messages)" switch when the thread has > 1.
- Composer: reply on a linked message → POST /bookings/:id/emails/reply (To is the booking
  contact, read-only; document checkboxes from the booking detail); otherwise POST /inbox/compose
  with the sender as recipient. Body is plain text → `paragraphsToHtml` (escaped `<p>`/`<br>`).
- Create booking: POST …/extract (guarded against StrictMode double-fire) → form with the
  public-form fields (group types from GET /public/form-config) → POST /bookings
  `source: "email"` → attach whole thread → navigate to the booking. 503 not_configured / 502
  fall back to a sender-prefilled form with a notice.
- Sync now runs POST /inbox/sync and toasts "fetched · new · matched".

### Payments (`/payments`)
- Tiles: Suggested / Unmatched / Matched / Ignored (click toggles the status filter),
  "Unmatched credits, 30 days" (amount + count), "Last poll" (relative time, status badge,
  entries/window or error). Poll now → ConfirmDialog → POST /payments/sync → toast with the
  matching summary.
- Filters in the URL: `status`, `type=credit` (switch), `from`/`to` (range calendar),
  `q` (Enter/blur), `page`. Columns: date (value date in title), description + reference
  (mono), amount (credits in accent, debits muted with a minus), balance (hidden below xl),
  status chip (+ suggestion count), booking link / "FY1710?" for suggested / ignore reason.
- Row click or `?tx=:id` opens the drawer: hero amount, facts table, matched booking
  (method, time, Remove match), ignored reason (Restore to unmatched = POST unmatch, which
  the payments service documents as also un-ignoring), suggestions with Confirm, Match a
  booking…, Ignore, raw FNB entry (collapsible). Debits show a note instead of actions.

### Public form (`/request`, `/request/sent`)
- No session: only GET /public/form-config and POST /public/booking-request are called from
  these pages. Intro from config, a 3-step strip, numbered fieldsets: Your group, Contact,
  Your visit (date pickers disable days before `min_date`, after `max_date`, closed weekdays
  and `closed_days`; peak days get an amber dot and the note "Saturday · peak day, peak rates
  apply"), Numbers (live total, min group size rule), Questions (repeater to `max_questions`),
  Notes, Booking policy (summary + checkbox), hidden honeypot `website` (off-screen,
  `aria-hidden`, `tabindex=-1`), Turnstile (script loaded only here when `turnstile_site_key`
  is set; token sent as `turnstile_token`).
- zod mirrors the server rules with the same customer wording; server 422 `fields` are mapped
  onto the inputs and the first one focused; 429 and `turnstile_failed` show a clear banner
  (the widget is reset on the latter). If the widget itself fails to load (e.g. hostname not
  allowed for the site key, as on localhost) the visitor can still submit and the server decides.
- 201 → `/request/sent` with `{reference, group_name, visit_date, contact_email, park}` in router
  state: big reference with Copy, "what happens next", park phone/email, "Send another request".
  Without state (refresh) it shows a generic confirmation.

## Verified live (Playwright, chromium)

Dev server `pnpm dev --port 5175` with `VITE_API_TARGET=http://127.0.0.1:5100` (no config
edit). A second API on :5101 with `TURNSTILE_SECRET_KEY=` empty plus Vite :5176 was used only
to submit the public form end to end (the real site key rejects localhost in the widget).

Mutations exercised against my own data only:
- Queue: Extend hold (FY1758 → 14 Oct), Dismiss reminder (optimistic), Confirm match on a
  synthetic suggested credit (payment recorded on FY1759), Ignore a synthetic credit with a
  preset reason, Send deposit reminder (email 1), Email ticket (failed — see below).
- Payments drawer: Restore ignored, Match a booking… (FY1758), Remove match; filters and the
  date-range popover; `?tx=` deep link.
- Inbox: Compose (email 2), open the new row, Attach to FY1758 (whole thread), Reply dialog
  (not sent), Detach, Create booking (extract ran and the form prefilled; cancelled),
  keyboard navigation, `?booking_id=219` filter.
- Public form: client validation messages, date picker, full submission → FY1760.

Emails sent to the dev recipient: 2 (compose, deposit reminder). Nothing real was resolved,
attached, matched, ignored, dismissed or sent. WhatsApp was never run.

### TEST data
- Bookings created for the tests: **FY1758** (id 219, enquiry), **FY1759** (id 220,
  confirmed) and **FY1760** (id 221, via the public form). By the time I cleaned up,
  all three `TEST F3 …` bookings, their events, reminders and the deposit-reminder email
  were already gone (a sibling agent's test cleanup removes every `TEST ` booking), so
  nothing is left for the lead to purge.
- Removed by me: the two synthetic `bank_transactions` (fingerprints `test-f3-*`, unmatched
  first so no payment row survived), my composed `email_messages` row (id 687), the
  `form_submissions` rows from the form tests, and the scratch user `test-f3@example.com`.
- Document numbers 1758–1760 are consumed (harmless gap in the sequence).

### Screenshots (`/tmp/claude-1000/-home-ray-repos-python-loyverse-manager/2fb501b6-0235-4643-9dc0-c7575f60f59e/scratchpad/`)
Matrix (1440×900, 1024×768, 390×844 × light/dark): `f3-queue-*`, `f3-inbox-*`
(thread 368 open), `f3-payments-*`, `f3-request-*` (full page), `f3-request-sent-*`.
Flows: `f3-queue-top/pay/rem/mobile-*`, `f3-queue-extend-hold-*`, `f3-queue-confirm-match-*`,
`f3-queue-ignore-*`, `f3-queue-send-reminder-*`, `f3-queue-email-ticket-*`,
`f3-inbox-thread/att/mobile-list/mobile-thread-*`, `f3-inbox-compose-*`,
`f3-inbox-attach-dialog-*`, `f3-inbox-attached-*`, `f3-inbox-reply-*`,
`f3-inbox-create-booking-*`, `f3-inbox-booking-filter-*`, `f3-payments-drawer-*`,
`f3-payments-drawer-matched-*`, `f3-payments-match-dialog-*`, `f3-payments-unmatch-dialog-*`,
`f3-payments-filtered-*`, `f3-payments-daterange-*`, `f3-payments-mobile-*`,
`f3-request-datepicker-*`, `f3-request-errors-*`, `f3-request-filled-*`.

## Requests for the lead / other agents

1. **Backend bug (bookings/documents):** `POST /bookings/220/actions/send-ticket-email` on a
   confirmed manual booking returns `500 render_failed: "Could not render the ticket email:
   object of type 'NoneType' has no len()"`. FY1759 reproduces it (no `area`, no
   `arrival_time`, vehicles 0). The UI handles it (error toast, dialog stays open) but the
   queue's "Email ticket" cannot be completed until it is fixed.
2. **Ops agent:** `GET /queue` → `unmatched_emails[].gmail_thrid` is a raw integer
   (e.g. `1878488852225177509`, beyond 2^53); every other endpoint sends it as a string.
   The queue navigates by `id` so nothing breaks, but it should be `str()`-ed.
3. **Shared components worth promoting** (I could not touch `components/`): `BookingPicker`
   + `useBookingSearch`, `BookingLine`/`Facts`, `SuggestionPicker`, `MatchStatusBadge`,
   `DateRangeFilter`, `MessageBody`. The calendar/bookings pages may want the first three.
   `features/queue/bookings.ts` duplicates a subset of the bookings agent's types; merging
   into `features/bookings` is a mechanical change.
4. `AuthProvider` still calls `GET /auth/session` on the public routes (one 401 in the
   console per visit). Harmless; skipping it when `location.pathname.startsWith("/request")`
   would make the public pages fully silent.
5. Mail agent, optional: a reply on a *linked* message always goes to the booking's
   `contact_email`. When the sender differs (forwarded enquiries) the composer says so but
   cannot address the sender; an optional `to` on `/bookings/:id/emails/reply`, or
   attachments on `/inbox/compose`, would close that gap. "Restore" of an ignored credit uses
   `/unmatch` as documented; a dedicated `/unignore` would read better in audit logs.
6. The `[DEV → …]` subject prefix from the outbound rewrite shows in the inbox list; expected
   outside prod.

## Decisions worth knowing

- Dismissing a reminder and the review marks (resolved / not a booking / reopen) have no
  confirm step: they are one-click, reversible triage actions. Every send, match, unmatch,
  ignore, detach and lapse goes through a ConfirmDialog that names the recipient/attachment.
- The iframe grants `allow-same-origin` (never `allow-scripts`) for auto height — see above.
  If you would rather keep `sandbox=""`, the cost is a fixed-height scrolling frame.
- Queue sections cap visible rows with "Show all" so the page stays a worklist; the summary
  strip gives the full counts.
- Stat tiles use proportional figures (dataviz guidance); tables and inline numbers use
  `tabular`.

## Known gaps

- Bounce-back ("Send form link") and resolve/not-a-booking were not exercised against the
  live API (they only apply to real inbound mail); the calls are one-liners.
- A message with no `gmail_thrid` shows only itself in the reading pane.
- Emails that set their own white background stay white in dark mode (as in most clients).
- Attachments on mail we sent appear only after the Sent-folder sync (mail handoff).
- The public form's "avoid" weekdays are not surfaced (no customer-facing policy text exists
  for them); closed weekdays/days and peak days are.
