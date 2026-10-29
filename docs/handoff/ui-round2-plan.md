# UI round two: the agreed plan for the remaining screens

Written 29 Oct 2026 after the Bookings list was signed off. Sources: the
owner's UI notes of 26 Oct, the screen proposals he agreed to the same
afternoon with amendments, the decisions taken while finishing the Bookings
list on 29 Oct, and `docs/redesign-spec.md` where it still applies. Where
this note and the spec disagree, this note wins. `docs/handoff/
migration-and-inbound.md` is the functional contract behind it.

## 1. Carried over from the Bookings sign-off (applies to every screen)

- The palette and elevation as signed off (Teal 500 primary, #FF4081 count
  badges, the fixed-width status and last-action pills, the overlay scroll
  bar under the table header). Tokens are generated; never hand-edited.
- No app header. Each page owns its title row and its primary action; the
  drawer carries the toggle and the emblem; "/" opens the search dialog.
- Lists never scroll as a page: the page pins to the viewport and the table
  (or the card list on phones) scrolls inside, header sticky, pager on the
  controls row, no footer. Rows per page is a preference (Settings ›
  Appearance › Tables), never a control on a table.
- Tables reflow by container width instead of scrolling sideways; controls
  snap to dropdowns on card screens the moment they would wrap.
- One count-badge component, equal width for one and two digits.
- Last-action labels are the owner's words (Title Case); arrivals are not an
  action.

## 2. Today (the dashboard and the day view)

Agreed 26 Oct:
- Today is the dashboard proper. Blocks: the season's numbers; this month's
  confirmed and pending people; money outstanding; the next visit days; a
  compact "needs attention" block of counts that link into Work; the
  skipped-mail line ("N mails skipped today · review") that opens the
  skipped list with "Treat as enquiry".
- Plus the day's visits with live arrivals and a date picker for any day
  (the day view and /today are one screen).
- **Up next goes. Needs you goes.** Both were the Work queue stamped on a day
  and meant nothing there.
- **Arrivals come live from the Loyverse receipts of the day.** No "Enter"
  button, no manual count. The final invoice uses that count.
- The rate line at the top of a day ("Weekend rate") goes: groups on one
  day can be on different rates.
- Ops and System are not the dashboard; System detail moves under Settings.
- Manager role: the day view and calendar only, no money.

Superseded in the spec: §3 (Up next, Needs you, the "Weekday rate" line) and
the "inline Enter" arrivals column in §5.

## 3. Calendar

Agreed 26 Oct, design 2's calendar as the base:
- **Day kinds**, a configurable list in Settings with priority order and a
  colour each, where new kinds can be added. Highest priority wins when a
  day matches several. Default order, highest first: Peak day, Public
  holiday, Day before start of Ramadan, Day after end of Ramadan, Weekend,
  School holiday, Closed to the public.
  - Peak days are editable; default 26 Dec, 1 Jan, 2 Jan.
  - Public holidays from the free holiday API with the local calculation as
    fallback.
  - Ramadan computed from the Islamic calendar with a one-day override
    (the moon sighting decides the real date). "Day before" and "day after"
    are single days.
  - **School holidays by a scraper of the Department's calendar, checked
    weekly** (owner, 26 Oct 16:11; there is no official API).
  - "Closed to the public" is a low-priority day kind that **never blocks a
    group booking** (the old closed-weekday rule marked Mondays and Tuesdays
    closed while groups visit on them).
- **Capacity 1 500**, shown as a bar of confirmed plus pending against
  capacity, not the word OVER. The old OVER 1190 was total interest against
  the 1 000 warning.
- Larger group count and people figures in the cell; the words "confirmed"
  and "pending" replaced by the green and amber dots always, as when a day
  is selected.
- Day panel on the right: as design 2, without the rate line.
- Viewport fit, sidebar to the rail on /calendar, month and week navigation,
  keys: as the spec §5.

Open: the five-band heat ramp in the spec §5 was not in the owner's notes;
keep or drop (see §9).

## 4. Work

Agreed 26 Oct: Work stays, as **an accordion heading in the left nav with
the views and their counts under it**, no floating sub-menu. The items are
exactly what the new model produces: requests to review, enquiries to
answer, bookings whose customer wrote last, proofs of payment to verify, a
message to assign between two bookings, deposits outstanding, tickets to
send, today's arrivals. One list, one line per item with a single verb,
counts in the nav. Reminders older than 30 days are stale with a bulk
dismiss.

Superseded in the spec: §4's own left rail of kinds (the nav accordion
replaces it) and "Unlinked mail lives in Mail" (there is no Mail page).

Open: whether a row's detail opens beside the list (spec) or goes to the
record (see §9).

## 5. Booking record

Agreed 26 Oct, back to tabs; design 2 was too cluttered:
- **Overview**: the details as the large card (where Money sat), the
  contacts card on the right, quick actions for the routine tasks, the
  money ladder (total, deposit, paid, balance, one state word).
- **Conversation**: as design 2 (kept). The two-bookings prompt appears here
  as "Assign to this booking" on both candidates.
- **Payments**: the list of money received, with the **Find payment** button
  opening the search modal (by reference, amount or date), and any proof of
  payment waiting at the top for verify / allocate.
- **Documents**: what was sent and when, with view, download, send next and
  resend. Proforma, statement, tax invoice, vehicle ticket.
- **Activity**: the blend of design 1's Timeline and 2's Activity: one line
  per email in either direction (not the verbose cards), a payment shown
  once when it arrived (not "paid" then "matched"), documents sent, status
  changes.
- **Contacts**: several per booking, one marked as on site and in charge on
  the day.
- A **request** shows a review banner with Accept and Decline on this page.
- Header: group name, status pill, one facts line, one computed primary
  button, Edit, overflow menu in three groups (Send, Record, Status) with
  impossible actions hidden and disabled ones explained.

Superseded in the spec: §6's two-tab record and its Money ladder with
payments as rows; payments are their own tab now.

Open: whether reminder, lapse and cancellation emails belong on Documents
(the owner listed them there) or only in Activity and Conversation, since
they carry no document (see §9).

## 6. Enquiries (new page)

Agreed 26 Oct: a list with a reading pane and six actions: **Reply**,
**Convert** (sends the form again; when the form arrives the enquiry and
its correspondence attach to the new request), **Create request**, **Attach
to booking**, **Resolve**, **Not an enquiry** (per thread; no learned sender
list). Mail arriving on an open enquiry attaches to it. The backend for all
of this exists (`/api/v1/enquiries`).

## 7. Settings

Agreed: Season and **Day kinds** (the list above, with priority, colour,
add); **Capacity**; **Inbound** (the windows, the labels, the bounce-back
text; exists in the backend as `settings.inbound`); Pricing and deposits;
Documents; Email; Templates; Booking form (acknowledgement toggle, arrival
slots); Users; Appearance (done, with Tables); **System** moves here from
the top level.

## 8. Removed, and documents

- **Bank, Mail and Gate pages go**, and Ops and System as top-level areas.
  Gate comes back later from the Loyverse tables, after the booking tool is
  signed off. Their APIs still answer until the screens are gone.
- **Documents keep the owner's Excel layout exactly**, generated from a
  template or script, never through Excel.
- The public request form stays as it is, pre-filled from a convert link.

## 9. Open questions to settle before building

1. Today: are the dashboard blocks in §2 the right set, and in that order?
2. Calendar: keep the heat ramp behind the figures, or the bar only?
3. Work: a row's detail beside the list, or straight to the record?
4. Record › Documents: PDFs only, or also the reminder, lapse and
   cancellation emails the owner listed?
5. Record › Overview: which quick actions, and does the money ladder sit on
   Overview or only on Payments?

## 10. Proposed order

1. Booking record (the screen every list and Work row lands on).
2. Enquiries (the inbound pipeline already feeds it).
3. Today and Calendar together, with the day-kinds and capacity settings and
   the school-holiday scraper.
4. Settings tidy-up and System under it; remove Mail, Bank, Gate, Ops.
5. Documents in the Excel layout.
Then the operational steps: the full-season migration dry run and review,
apply, start the inbound worker, deploy.
