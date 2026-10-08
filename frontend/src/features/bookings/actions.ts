/**
 * Which actions a booking allows right now, with the reason when it does not.
 * Mirrors the preconditions in docs/handoff/bookings.md so the UI never
 * offers something the API will refuse (and explains why in a tooltip).
 */

import type { BookingStatus } from "@/types/api";

import { ACTIVE_STATUSES, FIRM_STATUSES, TENTATIVE_STATUSES, type BookingDetail, type BookingDocument, type EmailReminderKind } from "./types";

export type ActionId =
  | "send-proforma"
  | "send-invoice"
  | "send-final-invoice"
  | "send-ticket-email"
  | "send-ticket-whatsapp"
  | "send-payment-confirmation"
  | "send-acknowledgement"
  | "send-answers"
  | "send-expiry"
  | "reminder:still_interested"
  | "reminder:deposit_reminder"
  | "reminder:final_details"
  | "confirm"
  | "record-payment"
  | "record-arrivals";

export interface Availability {
  enabled: boolean;
  /** Shown in a tooltip when disabled. */
  reason?: string;
}

const NO_EMAIL = "Add a contact email address first";
const NO_MOBILE = "Add a contact mobile number first";

function requireEmail(b: BookingDetail): Availability | null {
  return b.contact_email ? null : { enabled: false, reason: NO_EMAIL };
}

function requireStatus(b: BookingDetail, allowed: BookingStatus[], reason: string): Availability | null {
  return allowed.includes(b.status) ? null : { enabled: false, reason };
}

const OK: Availability = { enabled: true };

export function availability(b: BookingDetail, action: ActionId): Availability {
  switch (action) {
    case "send-proforma":
    case "send-acknowledgement":
      return requireStatus(b, ACTIVE_STATUSES, `Not available while the booking is ${b.status_label.toLowerCase()}`) ?? requireEmail(b) ?? OK;
    case "send-invoice":
      if (b.finance.paid_total <= 0) return { enabled: false, reason: "Record a payment first — an invoice follows money received" };
      return requireEmail(b) ?? OK;
    case "send-final-invoice":
      if (b.arrived_count === null) return { enabled: false, reason: "Record the arrivals first — the final invoice bills the people who came" };
      return requireEmail(b) ?? OK;
    case "send-ticket-email":
      return requireStatus(b, FIRM_STATUSES, "The vehicle ticket is only sent once the booking is confirmed") ?? requireEmail(b) ?? OK;
    case "send-ticket-whatsapp":
      return (
        requireStatus(b, FIRM_STATUSES, "The vehicle ticket is only sent once the booking is confirmed") ??
        (b.contact_mobile ? OK : { enabled: false, reason: NO_MOBILE })
      );
    case "send-payment-confirmation":
      if (b.payments.length === 0) return { enabled: false, reason: "No payment has been recorded yet" };
      return requireEmail(b) ?? OK;
    case "send-answers":
      if (!b.questions.some((q) => q.answer)) return { enabled: false, reason: "Answer at least one question first" };
      return requireEmail(b) ?? OK;
    case "send-expiry":
      return requireStatus(b, TENTATIVE_STATUSES, "Only tentative bookings can lapse") ?? requireEmail(b) ?? OK;
    case "reminder:still_interested":
    case "reminder:deposit_reminder":
      return requireStatus(b, TENTATIVE_STATUSES, "Only for tentative bookings") ?? requireEmail(b) ?? OK;
    case "reminder:final_details":
      return requireStatus(b, FIRM_STATUSES, "Only for confirmed bookings") ?? requireEmail(b) ?? OK;
    case "confirm":
      return requireStatus(b, TENTATIVE_STATUSES, b.status === "confirmed" ? "Already confirmed" : `Cannot confirm a ${b.status_label.toLowerCase()} booking`) ?? OK;
    case "record-payment":
      return OK;
    case "record-arrivals":
      return requireStatus(b, FIRM_STATUSES, "Arrivals are recorded against confirmed bookings") ?? OK;
    default:
      return OK;
  }
}

/** Reason rule for the manual Confirm action. */
export function confirmNeedsReason(b: BookingDetail): boolean {
  if (b.deposit_waived) return false;
  return !(b.finance.deposit_covered && b.finance.paid_total > 0);
}

export function latestDocument(b: BookingDetail, kind: BookingDocument["kind"]): BookingDocument | null {
  return b.documents.find((d) => d.kind === kind) ?? null;
}

/** True when the stored proforma no longer matches the booking's money. */
export function proformaIsStale(b: BookingDetail): boolean {
  const latest = latestDocument(b, "proforma");
  if (!latest) return true;
  return Math.abs(latest.total - b.finance.total_amount) > 0.005;
}

export const REMINDER_COPY: Record<EmailReminderKind, { label: string; description: string }> = {
  still_interested: { label: "Still interested?", description: "A friendly nudge a week after the proforma, with the proforma attached again." },
  deposit_reminder: { label: "Deposit reminder", description: "Reminds them the deposit is due before the hold lapses; attaches the proforma." },
  final_details: { label: "Final details", description: "Arrival instructions a few days before the visit. Attaches the vehicle ticket if it has not been emailed yet." },
};

/** Reasons required when changing status by hand. */
export function statusChangeNeedsReason(target: BookingStatus): boolean {
  return target === "cancelled" || target === "lapsed" || target === "no_show";
}

export const STATUS_CHANGE_COPY: Partial<Record<BookingStatus, { label: string; description: string; destructive?: boolean }>> = {
  proforma_sent: { label: "Mark proforma sent", description: "Records that a proforma went out by other means. Nothing is emailed." },
  confirmed: { label: "Confirm", description: "Confirms without a recorded deposit. Give the reason." },
  completed: { label: "Mark completed", description: "Closes the booking as visited. Normally this happens when arrivals are recorded." },
  cancelled: { label: "Cancel booking", description: "The customer is not coming. Nothing is emailed; the day frees up on the calendar.", destructive: true },
  lapsed: { label: "Mark lapsed", description: "The hold expired without a deposit. To email the customer as well, use “Send expiry notice” instead.", destructive: true },
  no_show: { label: "Mark no-show", description: "Confirmed but nobody arrived on the day.", destructive: true },
  enquiry: { label: "Reopen as enquiry", description: "Brings a cancelled or lapsed booking back as a live enquiry." },
};
