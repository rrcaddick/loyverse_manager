/**
 * The one rule set for "what happens next" on a booking (spec §6). It drives
 * the header's single primary button *and* the NextStepStrip, so the two
 * never disagree, and it follows the Work verbs (docs/handoff/work-today.md)
 * so a row there and the record here say the same thing.
 *
 *   const step = nextStep(booking);
 *   step.primary   → { kind: "send", action: "send-proforma", label: "Send proforma" }
 *   step.secondary → ghost verbs, in order
 *
 * Order of evaluation: ended statuses → completed → confirmed → tentative.
 * Within a status: urgent things first (overdue arrivals, expired holds),
 * then the move-on action. A send that needs an email address the booking
 * lacks becomes "Add email address" (opens Edit on the contact fields).
 */

import { AlertTriangle, Ban, CheckCircle2, Clock, FileText, Mail, Send, Ticket, UserCheck, Wallet, type LucideIcon } from "lucide-react";

import type { Urgency } from "@/components/next-step-strip";
import { formatDate, formatDateShort, formatMoney, formatNumber, pluralise } from "@/lib/format";
import type { BookingStatus } from "@/types/api";

import { ACTION_LABELS, STATUS_CHANGE_COPY, availability, type ActionId } from "./actions";
import { daysFromToday, holdState, lastStatusReason, relativeDays, relativeTo } from "./lib";
import { REMINDER_KIND_LABELS, type BookingDetail } from "./types";

export type StepVerb =
  | { kind: "send"; action: ActionId; label: string }
  | { kind: "record-payment"; label: string }
  | { kind: "record-arrivals"; label: string }
  | { kind: "edit"; focus: "contact" | "pricing" | null; label: string }
  | { kind: "status"; target: BookingStatus; label: string; destructive?: boolean }
  | { kind: "extend-hold"; label: string };

export interface NextStep {
  urgency: Urgency;
  icon: LucideIcon;
  title: string;
  detail: string;
  primary: StepVerb | null;
  secondary: StepVerb[];
}

const money = (n: number) => formatMoney(n, { compact: true });

const send = (action: ActionId, label = ACTION_LABELS[action]): StepVerb => ({ kind: "send", action, label });
const recordPayment: StepVerb = { kind: "record-payment", label: ACTION_LABELS["record-payment"] };
const recordArrivals: StepVerb = { kind: "record-arrivals", label: ACTION_LABELS["record-arrivals"] };
const addEmail: StepVerb = { kind: "edit", focus: "contact", label: "Add email address" };
const addContact: StepVerb = { kind: "edit", focus: "contact", label: "Add contact details" };
const extendHold: StepVerb = { kind: "extend-hold", label: "Extend hold" };

/** A send verb, or "Add email address" when the booking cannot receive it. */
function sendOr(b: BookingDetail, action: ActionId): StepVerb {
  const av = availability(b, action);
  if (!av.enabled && av.reason && av.reason.toLowerCase().includes("email")) return addEmail;
  return send(action);
}

function statusVerb(b: BookingDetail, target: BookingStatus): StepVerb | null {
  if (!b.allowed_transitions.includes(target)) return null;
  const copy = STATUS_CHANGE_COPY[target];
  return { kind: "status", target, label: copy?.label ?? target, destructive: copy?.destructive };
}

function join(...parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(" · ");
}

export function nextStep(b: BookingDetail): NextStep {
  const f = b.finance;
  const toVisit = daysFromToday(b.visit_date);
  const visit = `visit ${formatDateShort(b.visit_date)} ${relativeTo(b.visit_date)}`;
  const unanswered = b.questions.filter((q) => !q.answer).length;
  const questions = unanswered ? `${pluralise(unanswered, "question")} to answer` : null;

  // ---- ended
  if (b.status === "cancelled" || b.status === "lapsed" || b.status === "no_show") {
    const stamp = b.status === "cancelled" ? b.cancelled_at : b.status === "lapsed" ? b.lapsed_at : b.updated_at;
    const reason = lastStatusReason(b);
    return {
      urgency: "neutral",
      icon: Ban,
      title: `${b.status_label}${stamp ? ` ${formatDate(stamp)}` : ""}${reason ? ` — ${reason}` : ""}`,
      detail: join(visit, f.paid_total > 0 ? `${money(f.paid_total)} paid` : null, "nothing more is due"),
      primary: statusVerb(b, "enquiry"),
      secondary: [],
    };
  }

  // ---- completed: the tax invoice closes the file
  if (b.status === "completed") {
    const arrived = b.arrived_count ?? 0;
    const arrivedLine = `Arrived ${formatNumber(arrived)} of ${formatNumber(b.people_booked)}`;
    if (!b.final_invoice_sent_at) {
      return {
        urgency: "amber",
        icon: FileText,
        title: `${arrivedLine} — send the tax invoice`,
        detail: join(f.final_amount !== null ? `Final ${money(f.final_amount)}` : null, `paid ${money(f.paid_total)}`, f.balance_due > 0 ? `balance ${money(f.balance_due)}` : f.balance_due < 0 ? `credit ${money(-f.balance_due)}` : "paid in full"),
        primary: sendOr(b, "send-final-invoice"),
        secondary: f.balance_due > 0 ? [recordPayment] : [],
      };
    }
    return {
      urgency: f.balance_due > 0 ? "amber" : "green",
      icon: f.balance_due > 0 ? Wallet : CheckCircle2,
      title: f.balance_due > 0 ? `Tax invoice sent — ${money(f.balance_due)} still owed` : "Done — tax invoice sent, paid in full",
      detail: join(arrivedLine, `tax invoice ${formatDate(b.final_invoice_sent_at)}`, `paid ${money(f.paid_total)}`),
      primary: f.balance_due > 0 ? recordPayment : null,
      secondary: f.balance_due > 0 ? [send("send-payment-confirmation")] : [],
    };
  }

  // ---- confirmed: ticket, then the day, then the money
  if (b.status === "confirmed") {
    const ticketSent = !!(b.ticket_sent_at || b.ticket_emailed_at);
    const balance = f.balance_due > 0 ? `balance ${money(f.balance_due)} on the day` : "paid in full";
    if (toVisit < 0 && b.arrived_count === null) {
      return {
        urgency: "red",
        icon: UserCheck,
        title: `Visited ${formatDateShort(b.visit_date)} — record the arrivals`,
        detail: join(`${relativeDays(toVisit)}`, `${formatNumber(b.people_booked)} booked`, balance),
        primary: recordArrivals,
        secondary: [statusVerb(b, "no_show")].filter((v): v is StepVerb => !!v),
      };
    }
    if (toVisit === 0) {
      return {
        urgency: "blue",
        icon: UserCheck,
        title: `Visiting today — ${pluralise(b.people_booked, "visitor")}${b.arrival_time ? ` from ${b.arrival_time}` : ""}`,
        detail: join(ticketSent ? "ticket sent" : "ticket not sent", `paid ${money(f.paid_total)}`, balance),
        primary: recordArrivals,
        secondary: ticketSent ? [] : [sendOr(b, "send-ticket-email")],
      };
    }
    if (!ticketSent) {
      const email = !!b.contact_email;
      const mobile = !!b.contact_mobile;
      const primary: StepVerb = email ? send("send-ticket-email", "Send ticket") : mobile ? send("send-ticket-whatsapp", "WhatsApp ticket") : addContact;
      const secondary: StepVerb[] = email && mobile ? [send("send-ticket-whatsapp")] : [];
      return {
        urgency: "amber",
        icon: Ticket,
        title: "Confirmed — send the vehicle ticket",
        detail: join(`deposit ${money(f.paid_total)} paid`, visit, balance, !email && !mobile ? "no email or mobile on the booking" : !email ? "no email — WhatsApp only" : null),
        primary,
        secondary,
      };
    }
    if (f.balance_due > 0) {
      return {
        urgency: "neutral",
        icon: Clock,
        title: `Ticket sent — ${money(f.balance_due)} due on the day`,
        detail: join(visit, `paid ${money(f.paid_total)} of ${money(f.total_amount)}`),
        primary: recordPayment,
        secondary: [sendOr(b, "reminder:final_details")],
      };
    }
    return {
      urgency: "green",
      icon: CheckCircle2,
      title: "Paid in full — ticket sent",
      detail: join(visit, `${formatNumber(b.people_booked)} booked`),
      primary: sendOr(b, "reminder:final_details"),
      secondary: [],
    };
  }

  // ---- tentative (enquiry, proforma_sent)
  const hold = holdState(b);
  const holdLine = b.hold_expires_on ? `hold until ${formatDateShort(b.hold_expires_on)}` : null;
  const depositLine = f.deposit_waived ? "deposit waived" : `deposit ${money(f.deposit_due)}`;
  const totalLine = `${money(f.total_amount)} (${formatNumber(b.people_booked)} × ${money(f.price_per_person)})`;

  if (!b.contact_email) {
    return {
      urgency: "amber",
      icon: Mail,
      title: "No email address — add one to send the proforma and documents",
      detail: join(depositLine, holdLine, visit, totalLine, questions),
      primary: addEmail,
      secondary: [recordPayment],
    };
  }
  if (b.status === "enquiry" || !b.proforma_sent_at) {
    return {
      urgency: "amber",
      icon: Send,
      title: "New enquiry — send the proforma",
      detail: join(depositLine, holdLine, visit, totalLine, questions),
      primary: send("send-proforma"),
      secondary: unanswered > 0 ? [send("send-answers")] : [recordPayment],
    };
  }
  if (f.deposit_waived || (f.deposit_covered && f.paid_total > 0)) {
    return {
      urgency: "amber",
      icon: CheckCircle2,
      title: f.deposit_waived ? "Deposit waived — confirm the booking" : "Deposit covered — confirm the booking",
      detail: join(`paid ${money(f.paid_total)}`, visit, questions),
      primary: send("confirm"),
      secondary: [recordPayment],
    };
  }
  const sentAgo = b.proforma_sent_at ? `proforma sent ${formatDate(b.proforma_sent_at)}` : null;
  const outstanding = f.deposit_outstanding > 0 ? f.deposit_outstanding : f.deposit_due;
  if (hold && hold.daysLeft < 0) {
    return {
      urgency: "red",
      icon: AlertTriangle,
      title: `Hold expired ${hold.relative} — ${money(outstanding)} deposit not received`,
      detail: join(sentAgo, visit, questions),
      primary: b.contact_email ? send("send-expiry") : statusVerb(b, "lapsed"),
      secondary: [extendHold, recordPayment],
    };
  }
  if (hold && hold.daysLeft <= 3) {
    return {
      urgency: hold.daysLeft === 0 ? "red" : "amber",
      icon: Clock,
      title: `Hold expires ${hold.relative} — ${money(outstanding)} deposit not received`,
      detail: join(sentAgo, visit, questions),
      primary: recordPayment,
      secondary: [send("reminder:deposit_reminder"), extendHold],
    };
  }
  if (f.paid_total > 0) {
    return {
      urgency: "amber",
      icon: Wallet,
      title: `Deposit ${money(f.deposit_due)} — ${money(f.paid_total)} received, ${money(f.deposit_outstanding)} short`,
      detail: join(holdLine, sentAgo, visit, questions),
      primary: recordPayment,
      secondary: [send("send-payment-confirmation")],
    };
  }
  const dueReminder = b.reminders.find((r) => r.status === "due" && (r.kind === "deposit_reminder" || r.kind === "still_interested") && daysFromToday(r.due_on) <= 0);
  const dueBy = b.hold_expires_on ? `due by ${formatDateShort(b.hold_expires_on)}` : "due";
  if (dueReminder) {
    const action: ActionId = dueReminder.kind === "still_interested" ? "reminder:still_interested" : "reminder:deposit_reminder";
    return {
      urgency: "amber",
      icon: Clock,
      title: `Deposit ${money(f.deposit_due)} ${dueBy} — nothing received`,
      detail: join(`${REMINDER_KIND_LABELS[dueReminder.kind]} reminder due ${relativeTo(dueReminder.due_on)}`, sentAgo, visit, questions),
      primary: send(action),
      secondary: [recordPayment],
    };
  }
  return {
    urgency: "amber",
    icon: Clock,
    title: `Deposit ${money(f.deposit_due)} ${dueBy} — nothing received`,
    detail: join(sentAgo, visit, questions),
    primary: recordPayment,
    secondary: [send("reminder:deposit_reminder")],
  };
}
