# Redesign specification

Consolidates the seven research notes in `docs/research/` and the owner's
first-use feedback into one build order. Every item here is a decision; the
notes hold the evidence. Where a note and this spec differ, this spec wins.

## 0. Principles (apply to every screen)

1. **One primary list per screen.** Views live in a rail with counts; nothing is
   stacked. Counts hide at zero.
2. **Colour is meaning, the accent is interaction.** Green = done or paid,
   amber = waiting on someone, red = wrong or overdue (always with a word or
   icon), blue = information (incoming mail, notes, today), grey = not started.
   The accent (theme-dependent) is used only for interactive and selected
   things. The capacity ramp on the calendar uses the accent hue.
3. **Large, glanceable numbers.** Display numbers 36 px; body 15/22; nothing
   below 12 px; tabular figures everywhere; 44 px rows and targets.
4. **Three visible surface tiers** and a 1 px border that can be seen; section
   headers carry an icon, a count pill and a rule; urgent rows carry a 3 px
   amber left bar, never a tinted fill.
5. **One filled verb per row** and it is always the move-on action; secondary
   verbs are ghost buttons; everything else is in `⋯`.
6. **Plain words that Linda uses:** Today, Work, Calendar, Bookings, Mail, Bank,
   Gate, Settings. Not Queue, Inbox, Ops, unmatched_emails.
7. **Nothing sends automatically** unless the Settings toggle for the form
   acknowledgement is turned on (see §11).
8. **Information stays; hierarchy changes.** Nothing the first build showed is
   dropped; it is regrouped, resized and recoloured.

## 1. Information architecture

Sidebar, one flat list, counts only on Work, Mail and Bank:

```
Today                 /today            admin + manager (manager's landing page)
Work           12     /work             admin
Calendar              /calendar         admin + manager
Bookings              /bookings         admin
Mail            9     /mail             admin   (was Inbox)
Bank            4     /bank             admin   (was Payments)
Gate                  /gate             admin + manager: arrivals today, open tickets, morning sync (POS tooling)
—
Settings · Users · System (was Ops) at the bottom with the user menu
```

Keyboard: `G T` Today, `G W` Work, `G C` Calendar, `G B` Bookings, `G M` Mail,
`/` search, `?` cheat sheet, `T` today on calendar and day view. Old routes
(`/`, `/inbox`, `/payments`, `/ops`, `/day/:date`) redirect.

## 2. Design system (research note 07)

- **Tokens.** Semantic model and the six themes exactly as the note's tables:
  Graphite (default), Fynbos, Indigo, Lagoon, Cocoa, High contrast; light and
  dark each; shared neutral lightness so one semantic set passes contrast in
  every theme. Status map: enquiry grey, proforma_sent amber, confirmed green,
  completed green-subtle, cancelled red, lapsed and no_show grey with red text.
- **Type scale.** Root 16 px; display 36/40 600; page title 28/34; section
  18/26; body 15/22; secondary 14/20; label 12/16 500 tracked; button 15/20.
  Text-size preference scales the root (16, 17, 18).
- **Surfaces.** Canvas L 0.985, card L 0.995 with a border at L 0.86, nested
  L 0.965, sidebar L 0.94; dark 0.20 / 0.245 / 0.27 with 14 % borders.
- **Components to add or change.** `BigNumber` (display tile with label and a
  "remaining" line), `KindRail` (view rail with counts), `WorkRow`,
  `Conversation` + `MessageCard` (inbound, outbound, note, event), `Composer`
  (docked), `MoneyLadder`, `NextStepStrip`, `StatusPill` (dot + text, 22 px,
  1 px ring), `SegmentedTabs` with counts, `CapacityBar` (split bar), `DayCell`.
- **Appearance page** (Settings › Personal › Appearance and in the user menu):
  theme tiles 160×100 with a live preview, Mode (Light, Dark, Match system),
  Text size (Default, Large, Extra large). Persisted per user via
  `PUT /users/me/preferences {theme, mode, text_size}`, mirrored to
  `localStorage` for pre-paint apply. Default Graphite, system, Large.
- **Settings** gets a left rail: Park (Season, Pricing & deposits), Documents &
  mail (Documents, Email, Reminders, Templates), Public (Booking form),
  Personal (Appearance, Password), Admin (Users, System). Two-column pages,
  help text under fields, sticky save bar "Unsaved changes · Discard · Save".

## 3. Today (home; research note 01)

Above the fold at 1440×900, no scrolling required:

- Row 1: "Thursday 8 October · Weekday rate" (or "Closed day"), `Add booking`.
- Row 2: four BigNumber tiles: **Groups today** (total · arrived), **People**
  (total · confirmed), **Owed at the gate** (total · paid) [admin only],
  **Needs you** (count · oldest, opens Work) [admin only].
- Row 3: left two-thirds, today's groups as a table (see §5 day view); on a
  closed or empty day, "Next visit day: Sat 31 Oct · 3 groups · 300 people"
  with a seven-day strip. Right third: **Up next**, the five most urgent Work
  rows with their verb [admin]; below it one **System** line: "Mail 20:11 ✓ ·
  Bank 20:10 ✓ · Loyverse sync off ●" linking to System.
- Manager sees the tiles without money, the groups table, no Up next.
- Data: `GET /today?date=`.

## 4. Work (research note 01)

- Left rail of kinds in pipeline order with counts, hidden at zero: **Up next**
  (default, ten most urgent across kinds), Reply, New requests, Confirm money,
  Send tickets, Reminders, Holds lapsing, Record arrivals, Stale.
- One list. Row anatomy, identical everywhere, 56 px: status dot · `FY1737`
  **Group** · date · people | one grey context line | right edge: one filled
  verb + one ghost + `⋯`. Keys `1` and `2` fire them. A completed row leaves
  with an undo toast. The detail opens beside the list, not on a new page
  (a right panel: the booking summary or the conversation).
- Reminders older than 30 days are Stale, with bulk Dismiss, so live counts
  are honest. Unlinked mail is not Work; it lives in Mail.
- Empty view: one sentence and a link.
- Data: `GET /work?view=`, `GET /work/counts`, actions per the action
  vocabulary in `docs/handoff/work-today.md`.

## 5. Calendar and day view (research note 02)

- **Viewport fit.** `/calendar` is a flex column of `calc(100dvh − 56px)`:
  toolbar 44, headers 24, grid, legend 28. No page title. Sidebar collapses to
  the icon rail on this route. Rows `repeat(N, minmax(104px, 1fr))`, N = 6 at
  1440×900, 7 at 1920×1080, 5 below 720 px tall. Gaps 6 px.
- **Cell** (padding 8): row 1 day number 14/600 (today = filled disc), one tag
  at most (`CLOSED` hatch, `PEAK` + 2 px amber top rule, `AVOID` dashed, holiday
  label); row 2 **interest** 30/700 (36 at 1920) with "9 grps" 12/500 to its
  right; row 3 the 6 px split bar (confirmed green, pending amber, denominator
  = interest) with `550 confirmed · 250 pending` beneath (`550 · 250` with
  swatches in narrow cells). Over capacity: 3 px red top rule and `OVER`.
  No names in the cell.
- **Heat ramp.** Five fixed bands of the capacity setting (1–9, 10–24, 25–49,
  50–74, ≥75 %), lightness 0.95 / 0.89 / 0.81 / 0.72 / 0.62 on the accent hue
  (dark 0.28 → 0.52); ink text on every step. Legend of six swatches.
- **Week column.** No heat; interest 24/700, "people", groups, the same bar,
  `550 · 250`; background alternates by month.
- **Navigation.** `Today` · `‹ ›` month · "November 2026" (month picker) ·
  `▲ ▼` week · visible-weeks totals on the right. State `?from=<Monday>`;
  the wheel over the grid moves a week; keys as in the note. Out-of-month days
  are never dimmed.
- **Side panel.** 400 px (440 at 1920), non-modal, no scrim, swaps on click,
  Esc closes: date, the cell's numbers at full size, then one 56 px row per
  group (name + status dot, people, `arrives 10:00 · Church group · FY1678`,
  admin balance in red when due). Footer: Open day view, Add booking.
- **Day view** (`/today` is the same screen for today): header
  `‹ Saturday 7 November ›` · Today · Calendar · Add booking; three tiles
  (Expected, Arrived, Still to come) plus Outstanding for admin; a **table**:
  Group (name, ref, type), Expected (people, arrival), Arrived (count, source,
  inline Enter), Balance (admin), Status; one `⋯` per row (Fetch from
  Loyverse, Enter arrivals, Record gate payment, Open booking). Rows 56 px,
  sorted by arrival time; arrived rows tinted lightest green.

## 6. Bookings list and record (research note 04)

- **List.** Tabs with counts from `/bookings/counts`, default **Pending**:
  Pending (enquiry + proforma sent) · Confirmed · Lapsed (incl. cancelled) ·
  Past (completed + no show) · All. Columns per tab exactly as the note;
  48 px rows; one search box over reference, group, contact, phone, area, in
  the URL; per-tab default sort; keep Upcoming / Month / Past, drop the status
  multi-select; drop "Last activity".
- **Record header.** Breadcrumb; group name 24 px + status pill; one 15 px
  facts line (date · in N days · visitors · type · contact · phone · ⚠ no
  email); right: **one computed primary button** (Send proforma → Record
  payment → Send ticket → Record arrivals → Send final invoice), `Edit`, `⋯`.
- **Next-step strip** under the header, coloured by urgency, same rules as
  Work so they never disagree.
- **Layout.** Main two-thirds: next-step strip, **Money ladder** (Total /
  Deposit · due · paid / Paid · n payments ▸ / Balance, one state word
  top-right), Activity timeline (composer "Add a note…" at top, newest first,
  grouped by day, cards for notes and mail, one-liners for money, status,
  documents, tickets; field edits collapsed; filter chips). Rail one third:
  Details (six lines), Contact, Documents (latest of each with Preview and
  Send), Hold & reminders (tentative only), Internal note, collapsed Record
  footer (barcode, source, created).
- **Tabs.** Two: **Booking** and **Conversation** (count badge). Payments are
  rows in the Money ladder; questions a main-column card only when present,
  unanswered count in the next-step strip.
- **Overflow menu** in three groups: Send, Record, Status; hide impossible
  actions; disabled ones explain why beneath.
- **Edit dialog.** One `Visitors` field, billing address and customer VAT
  number fields (optional), live price line, sticky Save.

## 7. Mail (research note 03)

- **Queues over conversations**, not messages: Needs reply (default),
  Unmatched, Waiting on customer, Done, All mail (chips Inbound · Sent ·
  Failed · Automated). Done (`E`) leaves every queue; a new inbound reopens.
  Sent mail is never a queue row.
- **List row**: counterpart, booking chip (`FY1703 · Mount Olive`) or amber
  "Unmatched", subject, snippet of the latest new text ("You: …" when ours),
  time, unread dot. `J K` move, Enter opens.
- **Conversation**: newest at the bottom; older messages collapsed to one line;
  incoming = paper card, full width, initials avatar, blue dot "From"; outgoing
  = indented, accent tint 6 % with a 2 px accent left rule, "Farmyard Park ·
  Linda", kind chip (Proforma FY1703, Reply, Ticket, Reminder), send state;
  note = amber card "only the team sees this"; system event = one muted line
  with an icon, linking to the document or payment. Quoted history and
  signatures are split at ingest and hidden behind "Show quoted history".
  Attachments as chips.
- **Composer** docked at the bottom, collapsed bar "Reply to Nolene…" | Note;
  expands in place to at most 45 % of the pane; To chips, Subject only when
  it differs, Reply / Note tabs, Template, Attach document, Attach file, bold
  / list / link; Send (`Cmd+Enter`) and "Send and mark done". Drafts autosave.
- **Context panel** on the right when a conversation is attached: contact,
  date, status, visitors, balance, documents with attach buttons; the same
  panel is the empty state's home for "Attach to booking" with suggestions.
- **Booking › Conversation tab** renders the same component with the booking's
  threads merged plus its events; the separate Emails tab and send-log column go.

## 8. Bank (research note 05)

- One summary line under the title: "4 to confirm · 12 unmatched credits this
  month · last poll 20:10, OK" (links; red on failure). No tiles.
- Tabs: **Needs attention** (default; suggested first, then unmatched credits
  oldest first; never debits), Matched, All entries (with balance column).
- Row, Xero-style halves: left date, amount large, description, reference
  mono; right the proposal card `FY1698 · Harbour of Hope · Sat 7 Nov ·
  Proforma sent`, one line of arithmetic, confidence as a sentence ("Equals the
  deposit" green, "Part of the balance", "Exceeds the balance" grey), green
  **Match** on the row; several candidates expand in place; pre-select nothing
  on ties. Unmatched rows: **Find booking…** and **Ignore ▾** (Own transfer,
  Card settlement, Interest, Other…; the first three create a description rule).
- No modals: Match records, the row slides to Matched, toast "R3 800 recorded
  on FY1698 · Undo" ten seconds, then offers "Send payment confirmation" when
  the deposit is covered. Remove match is one click and reverts
  confirmed → proforma_sent when the deposit is no longer covered.
- Drawer keeps the raw entry with bank metadata collapsed.

## 9. Documents and emails (research note 05)

- Three documents: **Proforma invoice** (unchanged, add "VAT may not be
  claimed on this document"); **Deposit receipt and statement** on deposit
  (replaces the "Tax invoice" at that stage; not a tax invoice; shows deposit
  received and balance); **Tax invoice INV1703** at the visit for the counted
  visitors, the only tax invoice, so no credit note is ever needed. Describe the
  supply ("Group day admission, Saturday 7 November 2026"), show
  `67 × R95.00 = R6 365.00` with "Includes VAT 15 % R830.22"; print billing
  address and customer VAT number under Bill to when present; drop the
  contact's phone and email and the duplicate Booking ref row; no bank box on
  a paid final invoice. Flag for the accountant in the handover.
- Emails: amount-first subjects (`Proforma FY1703 – R3 800 deposit by 31 Oct`,
  `Payment received: R3 800.00 – FY1703`), group and date in the preheader, the
  amount as the first card row, a three-item instruction list on the proforma,
  one "Attached: …" line, card rows stack below 480 px.

## 10. Settings

As §2: left rail, two-column pages, save bar. New pages: **Templates** (canned
snippets for the composer), **Appearance**, **Booking form** gains the
acknowledgement toggle (§11) and the arrival-time slots.

## 11. Public request form (research note 06)

- Three screens plus Check: `/request/visit`, `/request/group`,
  `/request/contact`, `/request/check`, `/request/sent/<id>`; "Step 1 of 3";
  answers in `sessionStorage`; one line of intro; full-width Continue.
- Fields and hints exactly as the note's 14-field list: preferred date (text
  `dd/mm/yyyy` + picker opening on the first bookable month, closed days muted
  with a legend, read-back line, error names the next open day), alternative
  date, visitors (numeric text, "adults and children together", 10–900 rules),
  arrival time (half-hour select 09:00–14:00 + Not sure), group name, kind
  (radios), area, vehicles, gazebos (max 7), questions (add another, up to
  five), anything else; your name, email, mobile with the hints in the note.
- Check screen: summary list with Change links; the policy as a declaration
  (no checkbox; `policy_accepted: true` sent); Turnstile rendered here only,
  flexible size, above "Send request"; "Nothing is paid now." Honeypot stays.
- Errors: "There is a problem" summary with links plus inline; `aria-invalid`.
- Confirmation `/request/sent/<id>`: green "Request sent", reference large with
  copy, dated reply promise, next steps, phone, email, `wa.me`; survives
  refresh (server returns the public summary by id with a signed token).
- **Acknowledgement email**: a Settings toggle "Email an acknowledgement when a
  request arrives", off by default per the no-automatic-sends rule; when on,
  the confirmation page says a copy was emailed.
- Fix the shell bug: anonymous 401 handling must not discard the public
  `form-config` query (research note 06 critique).

## 12. Backend changes (lead and backend agents)

- Done: visitors only; school-parents tier retired; migrations 008 and 009;
  mail v2 (threads, quote split, conversation queues) and Work/Today APIs in
  progress.
- To do: bank ignore rules + unmatch reverts status + confidence sentences in
  suggestions; document renames and billing fields; email subject changes;
  settings DEFAULTS for templates, form.acknowledgement_enabled,
  form.arrival_slots; public form accepts the new field set and a signed
  `/public/requests/<id>` for the confirmation page; `/bookings/counts` with
  the tab buckets; Gate endpoints reuse existing open-ticket and sync data.

## 13. Build order and ownership

1. **Foundation agent**: tokens v2 and the six themes, type scale, surfaces,
   Appearance page and preference wiring, sidebar and routes (§1), shared
   components listed in §2, the public-form race fix, redirects. Delivers a
   handoff before the page agents start.
2. In parallel after 1: **Today + Work + Gate** agent; **Calendar + Day**
   agent; **Bookings list + record (incl. Conversation tab via the shared
   component)** agent; **Mail + Bank** agent (owns `Conversation`, `Composer`);
   **Public form + Settings** agent.
3. Lead: backend items in §12, integration, screenshots at 1440×900 and
   1920×1080 in two themes, the first-use test (§14), build, PR.

## 14. First-use test (done before handover)

Without instructions, a tester must be able to: see what today holds; find
what needs doing and do the first three items; check availability for a
Saturday in November from the calendar alone; open a booking and send its
proforma; read a customer's reply and answer it; confirm a deposit that the
bank matched; change the theme; submit the public form on a phone. Each step
must take one obvious click per decision, and nothing may require scrolling
on Today or the Calendar at 1440×900.
