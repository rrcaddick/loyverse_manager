/** Presentation helpers for inbox rows and headers (no components). */

import { formatDateTime, formatRelativeDay, formatTime } from "@/lib/format";

import type { InboxListItem } from "./types";

/** "Today, 15:35" / "Yesterday, 09:12" / "12 Aug 2026, 11:32". */
export function messageTime(sentAt: string): string {
  const rel = formatRelativeDay(sentAt);
  return rel === "Today" || rel === "Yesterday" ? `${rel}, ${formatTime(sentAt)}` : formatDateTime(sentAt);
}

/** Who a row is "from" in the reader's eyes: the sender, or the recipient for mail we sent. */
export function counterpart(item: Pick<InboxListItem, "direction" | "to_emails" | "from_name" | "from_email">): { name: string; email: string | null; outbound: boolean } {
  if (item.direction === "outbound") {
    const email = item.to_emails[0] ?? null;
    return { name: email ?? "(no recipient)", email, outbound: true };
  }
  return { name: item.from_name || item.from_email || "Unknown sender", email: item.from_email, outbound: false };
}

