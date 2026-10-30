# UI round two: what was built

Companion to `ui-round2-plan.md` (the agreements). One section per screen as
it lands.

## Booking record (29 Oct 2026)

`frontend/src/pages/bookings/BookingDetailPage.tsx` and
`frontend/src/features/bookings/components/record/*`.

- **Header** as before (reference line, group name and status pill, facts
  line, the one computed primary button, Edit, the ⋯ menu in Send / Record /
  Status groups).
- **Nothing under the header any more** (owner, 29 Oct, second pass): what
  the booking is waiting on us for is its own tab, **Needs attention**, with
  a count badge (`attention.ts` for the count, `record/attention.tsx` for
  the tab): a request's review banner (Accept with "send the proforma now",
  the one automatic send; Decline with a reason), the computed next step,
  reminders that have fallen due with their Send buttons, proofs of payment
  waiting. A request opens on this tab.
- **Seven tabs**, `?tab=` in the URL (overview is the default and unset):
  - *Overview* (`overview-tab.tsx`): the quick actions as one row across
    the top (every send the state allows, the next step filled, blocked
    ones explained on hover, Cancel booking last); then the Contacts card
    top left (primary first, the on-the-day marker, Manage → the tab) with
    Hold & reminders and the collapsed Record footer under it; the Details
    card large on the right (visit, arrival, visitors, vehicles and gazebos,
    kind, price per visitor as a plain number, area, the customer's notes,
    source, reference and barcode), questions when any, the internal note.
    Nothing else about money.
  - *Conversation*: the existing `ConversationView` (design 2's, kept).
  - *Payments* (`payments-tab.tsx`): three figures across the top (Deposit,
    Total, Balance) with **Find payment** beside them and the money state
    word; any proof of payment waiting (Find payment prefilled with the
    proof, Dismiss); then the payments received as a list (date, amount,
    kind, reference, source). **No manual "record payment"**: every amount
    reaches the bank and is found by the search; cash on the day will come
    from Loyverse later. The old pricing footer (tier, rate, override
    chips, deposit formula) is gone. `find-payment-dialog.tsx` searches
    the bank feed by reference, amount or date; results are plain lines
    (date, amount, the full description), never wrap, and the backend
    returns only credits not yet on any booking and no larger than the
    outstanding balance plus R 1 000 (`payment_search.OVERPAY_LEEWAY`).
    "Use this payment" records it; opened from a proof it allocates the
    proof too. The "Record payment" verb is "Find payment" everywhere (the
    header's primary button, the ⋯ menu, the next-step strip).
  - *Documents* (`documents-tab.tsx`): one table (Document · Status ·
    Sent · Send status · Actions) for the proforma, statement, tax invoice
    and vehicle ticket. Status is Not issued / Not sent / Sent / Re-sent;
    Sent is the last send's time; Send status is Delivered or Failed (the
    error on hover), and for the ticket which channels went. Actions are
    Preview (the PDF, saved from the viewer) and Send or Re-send. The ticket
    has **one send** that emails the PDF and WhatsApps the image to every
    primary contact (`send-ticket`, backend `act_send_ticket`,
    `tickets.send_ticket_whatsapp_all`).
  - *Activity* (`activity.tsx` reworked): notes as cards; every email in
    either direction one line ("Zara Dollie wrote: Re: …" / "Sent: …")
    linking to Conversation; a payment once, on the day it came in, from
    the payment rows (the recorded and matched events are dropped);
    documents, tickets, status changes and collapsed field edits as lines.
  - *Contacts* (`contacts-tab.tsx`): the Bookings-style table (Name,
    Email, Mobile, Primary ☐, On site ☐, Added, edit icon), growing with its
    rows up to 60 % of the viewport then scrolling. Any number of primaries
    (each receives the WhatsApp ticket); one on site. The edit dialog takes
    name, email and mobile and removes a contact; a new number on a primary
    contact gets the ticket again at once when one has gone out. Edits to
    the booking's own contact keep the booking's fields in step.
- **Backend**: `booking_contacts.on_site` (migration 020) with
  `PATCH /bookings/:id/contacts/:cid {name?, mobile?, on_site?}`; the
  primary contact is mirrored into booking_contacts on create and update
  (migration 021 backfilled; upsert promotes the role); `GET /bookings/:id`
  carries `contacts` and `pops`. See `docs/booking-system.md`.

Not done here, for the next screens: the old `rail.tsx` and `money-card.tsx`
still back parts of the record (the rail cards are imported individually);
they go when nothing else uses them.

Second pass the same evening (owner's review): the header keeps only Edit
and a short ⋯ menu (Add note, the lapse notice, status changes not on a
tab); the Payments tiles carry their state as pills top right and the money
state with Find payment sits in the "Payments received" header; copy rules
applied (no implementation talk in descriptions, labels capitalised,
actions on one right edge).

Third pass (owner's review, 29 Oct evening): tab badges only where something
needs doing (Needs attention, Conversation's unanswered, Payments' proofs
waiting). Needs attention also lists a missing email address, a missing
on-site contact (the emergency contact at the gate) and the lapse notice
when the hold has run out. Clicking a payment opens its dialog
(`record/payment-dialog.tsx`): every field we hold, the bank transaction's
included (from `GET /payments/bank-transactions/:id` with the raw payload),
and at the bottom Release from this booking (our unmatch) or Move to
another booking (unmatch, then allocate on the booking picked by reference
or name); a payment without a bank transaction can only be removed. Quick
actions are grouped by channel with the channel's colour: email in Gmail
red, the ticket in WhatsApp green, then Confirm and Cancel. Documents and
Contacts have their heading above the table, full width. The note box says
only "Add a note…". The header's ⋯ menu holds only the status changes nothing
else offers (lapsed, no-show, reopen) and is absent when there are none;
"mark proforma sent" and "mark completed" are gone. A booking contact with
no email now exists as a contacts row too (migration 023: email optional),
so On site can be ticked on any booking.

Fourth pass (29 Oct, late): the Bookings list's bucket badges count bookings
with a Work item in the bucket (`GET /bookings/counts` → `attention`), not
bookings; the earlier 42 against "1–41 of 41" was the pending total against
the Upcoming-filtered list. Activity's chip counts are "(n)" text, since they
are totals, not work. Quick actions are filled with the brands' own marks
and colours (simple-icons: Gmail #EA4335, WhatsApp #25D366). Needs
attention's buttons are uniform. Contact checkboxes are centred, tick at
once (optimistic cache update, loud toast and roll-back on failure), the
booking's own contact is always primary, and a row no longer duplicates
after a toggle. The payment dialog has no Close button; every dialog's X is
a step larger.

Fifth pass (29 Oct, late): the two invoices. The **invoice** goes out once
the deposit has been paid, on the booked numbers, with 80 % of the balance
due before the visit (the 80 % wording is for the document template, still
to do); the **final invoice** goes out on the day, on the arrived numbers
when Loyverse has them, otherwise the booked ones, and no longer waits for
arrivals to be recorded. Both list payments to date. UI labels are Invoice
and Final invoice everywhere (the PDF heading keeps "Tax invoice", the
wording SARS expects). Quick actions are amber until something has gone
out and green after, when the verb becomes Re-send; the brand marks sit on
small white chips. Needs attention's buttons, the next step's included, are
one size. Payments received is the standard table. The contacts table lost
its Added column. Contact updates track in-flight requests per contact, so
a second click before the first answer keeps the later state and a failure
rolls back only that row.

Fixes (29 Oct, night): an email opened from Activity is brought to the top
of the Conversation thread and held there while its body iframe sizes
itself; the Conversation tab shows messages and notes only (events stay on
Activity); email attachments open in a new tab for viewing; Find payment
read the finance figures under the wrong names (`due`, `total` instead of
`balance_due`, `total_amount`), so its cap was R1 000 and nothing larger
ever showed; covered by `tests/payments/test_payment_search.py`.

## Schema pass (30 Oct 2026)

Agreed with the owner and done in one pass (migration 024, `scripts/reprice_bookings.py`):

- **Dropped** arrival time, vehicles, gazebos (back later as invoice line
  items), arrived-at and the manual arrivals source; the sheet row moved to
  `booking_legacy_rows`. The public form, the Edit dialog, the record, Today,
  Calendar, Work, the queue and the documents and emails no longer show them.
- **Three rates** (children's groups R70 on term-time weekdays, groups R95,
  public R115, peak R130) with the group minimum of 40 (hard on weekends and
  school holidays, waived on a weekday when another group is booked) and
  school-holiday ranges on the Season tab in place of the no-discount window.
  Group types carry a children's flag only; aftercare and youth club added.
- **Discounts** replace price overrides: the agreed price per visitor is typed
  in the Edit dialog, the gap below the rate is the discount with its reason,
  documents show the rate line and a discount line. The Edit dialog's price
  line is a live quote (`GET /bookings/quote`).
- **Arrivals are real time**: the worker polls Loyverse receipts every two
  minutes through opening hours (`ARRIVALS_POLL_CRON`), the day and record
  pages refresh themselves, and every count button and manual entry is gone.
  The poll is also runnable from Ops.
- **Contacts**: every outside address on an inbound email (sender, To and Cc)
  becomes a learned contact; only a primary receives correspondence.
- Reprice of the 69 imported bookings: 16 changed; FY1724 (R100 agreed against
  the R95 group rate) sits on the public rate less R15 for review.
- To confirm: the default school-holiday ranges (10 Dec 2026 to 12 Jan 2027,
  25 Mar to 5 Apr 2027) against the Western Cape calendar.

Merged `main` (the Loyverse bridge line, 5249f24) into `feat/booking` on 30 Oct
2026: the POS tables (`pos_*`, `open_tickets_*` with closed receipts,
`shop_sales` for the Aronium till) and their terminal routes (`/api/pos/*`,
`/api/shop/sales`) are now on this branch. The booking migrations were
renumbered 015–024 to follow the bridge's 007–014; the old single-account
login and the AdminLTE layout went (the Shop till page's data endpoint stays
for a React page later). Local databases that had the booking migrations under
their old names need their `schema_migrations` rows renamed; production never
ran them.

