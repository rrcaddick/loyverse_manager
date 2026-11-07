import { formatRelativeDay } from "@/lib/format";

import type { Enquiry } from "./types";

export function senderLabel(e: Enquiry): string {
  return (e.sender_name || "").trim() || e.sender_email;
}

/** "Waiting 3 d" for an open one; the last activity otherwise. */
export function waitingLabel(e: Enquiry): string {
  const since = e.last_inbound_at ?? e.first_message_at ?? e.created_at;
  return formatRelativeDay(since);
}
