/**
 * What a booking is waiting on us for: the pure half of the Needs attention
 * tab (components/record/attention.tsx), also used for the tab's badge.
 */

import { availability, type ActionId } from "./actions";
import { daysFromToday, holdState } from "./lib";
import { nextStep } from "./next-step";
import type { BookingDetail, Payment } from "./types";

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

/** Deposits recorded from the old booking sheet that no bank credit has matched and nobody has checked (2 Nov 2026). */
export const SHEET_DEPOSIT_REF = "Imported from booking sheet";

export function sheetDepositsToCheck(booking: BookingDetail): Payment[] {
  if (booking.status !== "proforma_sent" && booking.status !== "confirmed") return [];
  return booking.payments.filter((p) => p.reference === SHEET_DEPOSIT_REF && !p.bank_transaction_id && !p.verified_at);
}

/** What a request still lacks before a proforma can go out; empty when it is complete. */
export function requestGaps(booking: BookingDetail): string[] {
  if (booking.status !== "requested") return [];
  const gaps: string[] = [];
  if (!booking.contact_email) gaps.push("email address");
  if (!booking.contact_mobile) gaps.push("mobile number");
  if (!booking.group_type) gaps.push("kind of group");
  if (!booking.area) gaps.push("area");
  if (!booking.visit_date) gaps.push("visit date");
  if (!(booking.people_booked > 0)) gaps.push("number of visitors");
  return gaps;
}

/** The tab's badge: the request review, the next step, a message waiting on us, due reminders, the lapse notice, proofs waiting, sheet deposits to check, missing details. */
export function attentionCount(booking: BookingDetail, unanswered = 0): number {
  const waiting = unanswered > 0 ? 1 : 0;
  if (booking.status === "requested") return 1 + booking.pops.length + waiting + (requestGaps(booking).length > 0 ? 1 : 0);
  const step = nextStep(booking);
  return (step.primary ? 1 : 0) + waiting + dueReminders(booking).length + (lapseNoticeDue(booking) ? 1 : 0) + booking.pops.length + sheetDepositsToCheck(booking).length + (emailMissing(booking) ? 1 : 0) + (onSiteMissing(booking) ? 1 : 0);
}

