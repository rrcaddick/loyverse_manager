/** Contact helpers shared by the record's Overview and Contacts tabs. */

import type { BookingContact, BookingDetail } from "./types";

export const CONTACT_ROLE_LABELS: Record<BookingContact["role"], string> = { primary: "Primary contact", cc: "Cc'd", learned: "Wrote in" };

/** The booking's primary contact row, or one built from the booking's own fields when none is mirrored yet. */
export function primaryContact(booking: BookingDetail): BookingContact {
  return (
    booking.contacts.find((c) => c.role === "primary") ?? {
      id: 0,
      booking_id: booking.id,
      email: booking.contact_email ?? "",
      name: booking.contact_name,
      mobile: booking.contact_mobile,
      role: "primary",
      shared: 0,
      on_site: 0,
      source: "booking",
      created_at: booking.created_at,
    }
  );
}
