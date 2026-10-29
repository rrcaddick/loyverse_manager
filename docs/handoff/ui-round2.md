# UI round two: what was built

Companion to `ui-round2-plan.md` (the agreements). One section per screen as
it lands.

## Booking record (29 Oct 2026)

`frontend/src/pages/bookings/BookingDetailPage.tsx` and
`frontend/src/features/bookings/components/record/*`.

- **Header** as before (reference line, group name and status pill, facts
  line, the one computed primary button, Edit, the ⋯ menu in Send / Record /
  Status groups).
- **Under the header**: a request shows the review banner
  (`request-banner.tsx`: Accept with a "send the proforma now" checkbox,
  default on, the one automatic send; Decline with a reason). Every other
  booking shows the due sends (`due-sends.tsx`): the computed next step,
  then any reminder that has fallen due with its Send button, then any
  proof of payment waiting. Nothing goes out by itself.
- **Six tabs**, `?tab=` in the URL (overview is the default and unset):
  - *Overview* (`overview-tab.tsx`): Details as the large card (visit,
    arrival, visitors, vehicles and gazebos, kind, area, the customer's
    notes, source, reference and barcode), questions when any, the internal
    note; on the right Quick actions (Find payment, then every send the
    state allows, the next step filled, blocked ones explained on hover,
    Cancel booking last), the Contacts card (primary first, the on-the-day
    marker, Manage → the tab), Hold & reminders, the collapsed Record
    footer. Nothing about money.
  - *Conversation*: the existing `ConversationView` (design 2's, kept).
  - *Payments* (`payments-tab.tsx`): proofs of payment to verify at the top
    (read from the PDF / mentioned in the mail, Find payment prefilled with
    the proof, Dismiss), then the money ladder with the payment rows always
    open and **Find payment** (`find-payment-dialog.tsx`): bank credits by
    reference, amount or date window, each with why it matched, "Use this
    payment" records it; opened from a proof it allocates the proof too.
    Record payment stays for cash and card. No Bank page links.
  - *Documents* (`documents-tab.tsx`): proforma, statement, tax invoice
    (number, version, issued, emailed to whom; View, Download, Send or
    Resend; Preview before issue) and the vehicle ticket (barcode, emailed
    and WhatsApp stamps, View and Download from the legacy ticket routes,
    Email and WhatsApp). All versions collapsible. Reminders, lapse and
    cancellation notices are not here.
  - *Activity* (`activity.tsx` reworked): notes as cards; every email in
    either direction one line ("Zara Dollie wrote: Re: …" / "Sent: …")
    linking to Conversation; a payment once, on the day it came in, from
    the payment rows (the recorded and matched events are dropped);
    documents, tickets, status changes and collapsed field edits as lines.
  - *Contacts* (`contacts-tab.tsx`): the primary contact and everyone cc'd
    or who wrote in, "Mark on the day" (one per booking), add by email,
    remove.
- **Backend**: `booking_contacts.on_site` (migration 012) with
  `PATCH /bookings/:id/contacts/:cid {name?, mobile?, on_site?}`; the
  primary contact is mirrored into booking_contacts on create and update
  (migration 013 backfilled; upsert promotes the role); `GET /bookings/:id`
  carries `contacts` and `pops`. See `docs/booking-system.md`.

Not done here, for the next screens: the old `rail.tsx` and `money-card.tsx`
still back parts of the record (the rail cards are imported individually);
they go when nothing else uses them.
