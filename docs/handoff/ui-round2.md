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
- **Backend**: `booking_contacts.on_site` (migration 012) with
  `PATCH /bookings/:id/contacts/:cid {name?, mobile?, on_site?}`; the
  primary contact is mirrored into booking_contacts on create and update
  (migration 013 backfilled; upsert promotes the role); `GET /bookings/:id`
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
