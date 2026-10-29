/**
 * What a booking is waiting on us for: the pure half of the Needs attention
 * tab (components/record/attention.tsx), also used for the tab's badge.
 */

import { availability, type ActionId } from "./actions";
import { daysFromToday } from "./lib";
import { nextStep } from "./next-step";
import type { BookingDetail } from "./types";

interface DueReminder {
  id: number;
  action: ActionId;
  kind: string;
  due_on: string;
}

export function dueReminders(booking: BookingDetail): DueReminder[] {
  const step = nextStep(booking);
  const primaryAction = step.primary?.kind === "send" ? step.primary.action : null;
  const out: DueReminder[] = [];
  for (const r of booking.reminders) {
    if (r.status !== "due" || daysFromToday(r.due_on) > 0) continue;
    const action: ActionId = r.kind === "lapse" ? "send-expiry" : `reminder:${r.kind}`;
    if (action === primaryAction) continue;
    if (availability(booking, action).hidden) continue;
    out.push({ id: r.id, action, kind: r.kind, due_on: r.due_on });
  }
  return out;
}

/** The tab's badge: the request review, the next step, due reminders, proofs waiting. */
export function attentionCount(booking: BookingDetail): number {
  if (booking.status === "requested") return 1 + booking.pops.length;
  const step = nextStep(booking);
  return (step.primary ? 1 : 0) + dueReminders(booking).length + booking.pops.length;
}

