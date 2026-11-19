/** Pure helpers for the Work list. */

import type { WorkRow } from "./types";

/** Where the row goes: the tab of the booking where that work is done, or the enquiry. */
export function destinationFor(row: WorkRow): string | null {
  const p = row.primary;
  if (p.action === "open_enquiry") return `/enquiries/${p.enquiry_id}`;
  if (row.booking) {
    const tab = row.kind === "reply" || row.kind === "allocate" ? "conversation" : row.kind === "pop" ? "payments" : row.kind === "ticket" ? "documents" : "attention";
    return `/bookings/${row.booking.id}?tab=${tab}`;
  }
  if (p.action === "open_booking") return p.tab ? `/bookings/${p.booking_id}?tab=${p.tab}` : `/bookings/${p.booking_id}`;
  if (p.action === "open_conversation") {
    if (p.party_key?.startsWith("e:")) return `/enquiries?q=${encodeURIComponent(p.party_key.slice(2))}`;
    return `/bookings/${p.booking_id}?tab=conversation`;
  }
  return null;
}
