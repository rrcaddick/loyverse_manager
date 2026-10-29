/**
 * What a booking is waiting on us for: the pure half of the Needs attention
 * tab (components/record/attention.tsx), also used for the tab's badge.
 */

import { availability, type ActionId } from "./actions";
import { daysFromToday, holdState } from "./lib";
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

/** The hold has run out and no lapse reminder carries the notice already. */
export function lapseNoticeDue(booking: BookingDetail): boolean {
  if (holdState(booking)?.tone !== "red") return false;
  if (availability(booking, "send-expiry").hidden) return false;
  const step = nextStep(booking);
  if (step.primary?.kind === "send" && step.primary.action === "send-expiry") return false;
  return !dueReminders(booking).some((r) => r.action === "send-expiry");
}

/** No email address on the booking, unless the next step is already "add one". */
export function emailMissing(booking: BookingDetail): boolean {
  if (booking.contact_email) return false;
  const step = nextStep(booking);
  return step.primary?.kind !== "edit";
}

export function onSiteMissing(booking: BookingDetail): boolean {
  const ended = booking.status === "cancelled" || booking.status === "lapsed" || booking.status === "no_show" || booking.status === "declined" || booking.status === "completed";
  return !ended && !booking.contacts.some((c) => c.on_site);
}

/** The tab's badge: the request review, the next step, due reminders, the lapse notice, proofs waiting, missing details. */
export function attentionCount(booking: BookingDetail): number {
  if (booking.status === "requested") return 1 + booking.pops.length;
  const step = nextStep(booking);
  return (step.primary ? 1 : 0) + dueReminders(booking).length + (lapseNoticeDue(booking) ? 1 : 0) + booking.pops.length + (emailMissing(booking) ? 1 : 0) + (onSiteMissing(booking) ? 1 : 0);
}

