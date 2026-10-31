# 04 — The booking record workspace and the booking lists

## Who and what for

One operator, all day, one record at a time. She opens a booking because something
happened (an email, a bank credit, a call) or because the queue sent her, and needs three
answers in two seconds: *what state is this in, what is the money position, what do I do
next*. Then she acts and leaves. The lists exist to find a record and to scan a cohort —
"which confirmed groups come this month", "which proformas are about to lapse". Barcode,
source, created-at and VAT are reference material: reachable, not visible.

## What the best products do

**Shopify order page.** One scrolling page, no tabs. Main column: line items, a payment
card (subtotal, discounts, "Paid"), then the Timeline; right rail: Notes, Customer,
Contact, Tags; secondary actions behind "More actions". The Timeline is history and
workspace at once: payment events expand to "Information from the gateway", staff post
internal comments via "Leave a comment..." with @mentions and attachments. Orders list:
saved views are tabs ("All" has no filters; "Unfulfilled" is just a saved filter) and
you "show, hide, and reorder columns" per view.

**HubSpot record.** Three columns. Left: highlight (name, email), action icons (note,
email, call, task, meeting) and an "About this contact" property card; middle:
"Activities" timeline with date/owner/type filters and "Search activities"; right:
associations and attachments.

**Pipedrive deal.** A stage progress bar with days spent per stage. The sidebar's
"Summary" is always first (value, probability, close date, person, organisation); the
main area splits "Focus" (what still needs doing) from "History" (what happened,
filterable by type).

**Attio.** Up to six "highlight widgets" atop Overview; tabs Overview / Activity /
Notes / Tasks / Emails / Files; a "Record Details" sidebar showing five attributes by
default.

**Linear issue.** Title and description, a properties sidebar (status, assignee, labels,
relations with orange/red "Blocked by"/"Blocks" flags), activity beneath. The April 2025
change is the lesson for timelines: "we now group similar consecutive events and
collapse older activity between comment threads"; edits within three minutes of creation
are not logged. List "Display options" show/hide properties per row and sort
active work above completed.

**Mews reservation.** A split screen: right pane is status plus arrival/departure (what
changes on the day); left pane is billing and operational data under seven tabs. The
"Smart detail" side panel has three verbs — Check in, Check out, Confirm — and the
amount due is a link to the bills.

**Cloudbeds reservation drawer.** Tabs Overview / Folio / Notes / Messages / Guest /
Documents / Activity, expandable to full screen. The Folio summary is a fixed ladder —
Subtotal, Products, Taxes and Fees, Payments, Grand Total, Balance due.

**Checkfront booking invoice.** "A brightly coloured label in the top left corner of an
invoice indicates its current status"; changing it is a dropdown plus a "Send email
notifications" toggle. Statuses are money states (Pending, Deposit, Paid, Cancelled).
"If the invoice has not been paid in full, the Add Payment button in the left sidebar
is active" — the action appears only when it applies.

**FareHarbor.** The booking overview is "a complete summary of the entire booking,
including customer contact information, payment details, check-in status ... as well as
booking actions"; notes sit "directly under the payment summary", comments "in the
activity log at the bottom". (SevenRooms' help centre is login-gated; its integration
docs show only a forward-only status ladder.)

## Principles that transfer

1. **Header = identity + state + money + one primary verb.** Status label top-left;
   the verb computed from state (Checkfront's Add Payment, Mews' Confirm/Check in).
2. **Rail holds facts, main holds flow.** Summary in a narrow column (Pipedrive, Linear,
   HubSpot); the activity stream gets the width.
3. **Single page beats tabs for one record** (Shopify, Linear). Tabs survive only for a
   facet that needs its own width and composer — the conversation.
4. **Money is a ladder, not a paragraph**: Total → Deposit → Paid → Balance, state word
   in colour (Cloudbeds, Checkfront).
5. **Timeline is a workspace**: composer on the stream, notes and emails as cards,
   machine events as one-liners, consecutive edits grouped (Shopify, Linear).
6. **Lists are saved views with their own columns** (Shopify); active work sorts first
   (Linear).

## Critique of our current build

*booking-list.png / booking-list-full.png / booking-list-status-filter.png.* One flat
list of 64 rows at 13 px, nine columns. The counts the owner wants (4 enquiries, 47
proforma sent, 13 confirmed) exist but hide inside the "Any status" popover. Three money
columns show "—" on two thirds of rows; "Last activity" reads "Today" on every row
(import artefact). Green deposit figures and a green "−R3 135" balance carry meaning
nobody is told. The hold-expiry warning, the one useful signal, is squeezed under a
badge. *booking-list-mobile.png*: the table scrolls sideways; only Ref/Group survive.

*booking-overview.png / booking-overview-full.png.* The header is good: reference,
name, status pill, date · people · type, contact chips. Then an 11-button action bar in
two rows, three disabled with no reason (the reason appears only inside the "More" menu,
*booking-actions-more-menu.png*, which does it right), and a disabled "Confirm" on an
already-confirmed booking. The Overview is five cards of equal weight: a
12-fact Booking card (barcode and created-at beside visit date), a Contact card
repeating the header chips, Notes, Add-a-note, and a rail with Pricing, Hold ("Only
tentative bookings lapse; this one is confirmed" — a card that exists to say it does not
apply) and Reminders. Labels are 11 px uppercase grey. The most important blocker — no
email address, so nothing can be sent — is amber body text inside the Contact card.
There is no "next step" anywhere. The money card never resolves: R14 250 paid against a
R4 275 deposit, yet no "Paid in full"; "Deposit outstanding: Covered" is a label/value
mismatch. The breadcrumb says "Booking 155", not FY1681.

*booking-timeline.png.* Day-grouped, iconed, actor and time right-aligned, status change
as Enquiry → Confirmed pills. The best screen, hidden in a tab: notes are typed on
Overview and appear here; emails are a third place.

*booking-payments.png / booking-documents.png / booking-questions.png.* Each tab holds
one short table or an empty state plus a primary button that duplicates the action bar
("Record payment" twice on screen); Payments repeats the Pricing ladder as a footer.

*booking-edit-dialog.png.* Adults 0 / Children 0 with "People in total: enter adults and
children" on a 150-person booking — saving as-is would zero the count (people_booked
defaults to adults+children). Save is below the 900 px fold.
*booking-actions-status-menu.png* ("Currently Confirmed", "Mark completed", red "Cancel
booking", each with a one-line consequence) is the model every menu should follow.

## Recommendation for ours

**Record header.** Breadcrumb `Bookings › FY1681`. Line 1: group name at 24 px with the
status pill beside it (amber Enquiry/Proforma sent, green Confirmed/Completed, grey
Lapsed, red Cancelled/No show); the source badge moves to the rail. Line 2 at 15 px:
`Sat 5 Dec 2026 · in 58 days · 150 visitors · Church group · Berry · 083 523 8376 ·
no email ⚠`. Right side: **one** primary button computed from state (`Send proforma` →
`Record payment` → `Send ticket` → `Record arrivals` → `Send final invoice`),
`Edit`, and a `⋯` overflow.

**Next-step strip** under the header, one line, coloured by urgency, built from status +
finance + reminders: "Deposit R4 275 due by 28 Nov — nothing received. [Send deposit
reminder] [Record payment]" or "No email address — add one to send documents [Edit
contact]". Same rules as the Queue, so the two never disagree.

**Rail versus main.** Main (two thirds): Next-step strip, Money card, Activity. Rail
(one third, collapsible cards): Details (visit date, arrival time, visitors, vehicles,
gazebos, area, type — six lines, not twelve), Contact, Documents (latest proforma /
invoice / final invoice with Preview and Send), Hold & reminders (tentative only),
Internal note, and a collapsed "Record" footer (barcode, source, created).

**Tabs.** Two: **Booking** (everything above) and **Conversation** (email thread, reply
composer, send log; count badge). Payments become rows inside the Money card, documents
a rail card, questions a main-column card shown only when questions exist (unanswered
count in the Next-step strip).

**Money card.** A four-row ladder in 16 px tabular figures: `Total R14 250` (150 ×
R95, VAT muted 12 px), `Deposit R4 275 · due 28 Nov · ✓ paid`, `Paid R14 250 ·
1 payment ▸` (expands to the payment rows and Record payment), `Balance R0`. One state
word top-right in colour: *Deposit outstanding* (amber), *Deposit paid* / *Paid in
full* (green), *Overpaid R3 135* (blue, never a green minus). Override and waive live
under the card's `⋯`; an override is a small tag with its reason on hover.

**Action grouping and naming.** Overflow menu in three groups — *Send* (proforma,
invoice, final invoice, ticket by email / WhatsApp, reminder…, answers, payment
confirmation), *Record* (payment, arrivals, note), *Status* (allowed transitions only,
destructive in red). Verb + object everywhere. Hide impossible actions; disable blocked
ones with the reason beneath, as the More menu already does.

**Timeline.** Composer at the top ("Add a note…"), newest first, grouped by day. Three
weights: notes and emails as cards (avatar, text or subject + snippet, "Open" to
Conversation); money, status, document and ticket events as one-liners with icon and
coloured pill; field edits collapsed into an expandable "3 fields changed". Collapse the
import burst into one event. Filter chips: All · Notes · Emails · Money · Changes.

**Lists.** Tabs with counts from `/bookings/counts`, default **Pending**: `Pending 51 ·
Confirmed 13 · Lapsed 0 · Past 0 · All 64` (Pending = enquiry + proforma sent; Lapsed
includes cancelled, told apart by pill; Past = completed + no show). Columns per tab:
*Pending* — Ref, Group/contact, Visit, Visitors, Status, Deposit due, Hold expires
(relative, amber ≤ 3 days). *Confirmed* — Ref, Group/contact, Visit, Visitors, Paid of
total (`R5 000 / R9 025`), Balance, Ticket ✓, Arrived. *Lapsed* — Ref, Group, Visit,
Visitors, Status, When, Reason. Drop "Last activity" until it is real. Density: 48 px
rows, 14 px primary, 13 px muted secondary, max seven columns, 25 per page. Row: muted
tabular ref, bold group with contact beneath, right-aligned money, pill colour =
meaning, whole row clickable with the ref a real link. Search: one
box over reference, group, contact, phone, area, kept in the URL; sort by header with a
per-tab default (Pending by hold expiry, Confirmed by visit date, Lapsed by lapsed
date); keep the Upcoming / Month / Past dropdown, drop the status multi-select.

**Edit dialog.** One `Visitors` field; delete Adults/Children. A live price line
("150 × R95 = R14 250 · deposit R4 275") since edits recalculate. Sticky Save footer.

**Mobile.** Lists become cards (ref + pill, group, date, visitors, one money line).
Record: header stacks, Next-step strip, Money card, Details/Contact/Documents as
accordions, Activity last; actions in a bottom-sheet `Actions` button.

## Sources

- Shopify, Managing order details — https://help.shopify.com/manual/orders/manage-orders/managing-orders
- Shopify, Timeline — https://help.shopify.com/en/manual/shopify-admin/productivity-tools/timeline
- Shopify, Searching, viewing and printing orders (saved views) — https://help.shopify.com/manual/orders/search-view-print-orders
- Shopify changelog, Customize your orders list — https://changelog.shopify.com/posts/customize-your-orders-list-and-get-to-work-faster
- HubSpot, Work with records — https://knowledge.hubspot.com/records/work-with-records
- Pipedrive, Deal detail view — https://support.pipedrive.com/en/article/deal-detail-view
- Attio, Record pages — https://attio.com/help/academy/introduction/record-pages ; Configure record pages — https://attio.com/help/reference/managing-your-data/records/configure-record-pages
- Linear changelog, Collapsed issue history — https://linear.app/changelog/2025-04-03-collapsed-issue-history ; Create issues — https://linear.app/docs/creating-issues ; Display options — https://linear.app/docs/display-options ; Issue relations — https://linear.app/docs/issue-relations
- Mews, Reservations management screen — https://help.mews.com/s/article/what-is-the-reservation-module-and-what-are-its-features ; Smart detail window — https://help.mews.com/s/article/The-Smart-detail-window-in-the-Timeline
- Cloudbeds, Reservation Details: Overview and Folio actions — https://myfrontdesk.cloudbeds.com/hc/en-us/articles/49527551635355 ; Reservation Details Page — https://myfrontdesk.cloudbeds.com/hc/en-us/articles/8354513114907
- Checkfront, Introduction to the booking invoice — https://support.checkfront.com/hc/en-us/articles/19868166555676 ; Booking statuses — https://support.checkfront.com/hc/en-us/articles/360006984273 ; Transactions — https://support.checkfront.com/hc/en-us/articles/360006985253
- FareHarbor, Glossary (booking overview, notes, comments) — https://help.fareharbor.com/hc/en-us/articles/42957683138459-FareHarbor-Glossary ; Orders overview — https://help.fareharbor.com/hc/en-us/articles/40897557579547-Orders-overview
- SevenRooms via Lightspeed integration (status ladder) — https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329259118107-Setting-up-the-SevenRooms-integration
- Screenshots: `data/screenshots/research/booking-*.png` (taken 2026-10-08 at 1440×900 as the read-only research user; booking FY1681).
