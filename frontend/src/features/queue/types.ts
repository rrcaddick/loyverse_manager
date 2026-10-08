/**
 * GET /queue (web/api/queue.py, docs/handoff/ops.md). Sections arrive in a
 * fixed order, every key present even when empty.
 */

import type { BankSuggestion } from "@/features/payments/types";

import type { BookingSummary, ReminderKind } from "./bookings";

export type QueueSectionKey =
  | "needs_reply"
  | "unmatched_emails"
  | "new_requests"
  | "payments_to_confirm"
  | "unmatched_credits"
  | "reminders_due"
  | "tickets_to_send"
  | "visits_this_week"
  | "arrivals_to_record"
  | "lapsing";

export interface QueueMessageRef {
  id: number;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  sent_at: string;
  snippet: string | null;
  has_attachments: boolean;
}

export interface NeedsReplyItem {
  booking: BookingSummary;
  message: QueueMessageRef;
}

export interface UnmatchedEmailItem extends QueueMessageRef {
  /** Arrives as a raw integer beyond 2^53 — never use it; navigate by `id`. */
  gmail_thrid: string | number | null;
}

export interface NewRequestItem {
  booking: BookingSummary;
  source: string;
  created_at: string;
  enquiry_date: string | null;
  contact_email: string | null;
  contact_mobile: string | null;
  group_type: string | null;
  alternative_date: string | null;
  questions_count: number;
  unanswered_count: number;
}

export interface CreditItem {
  id: number;
  amount: number;
  description: string;
  booking_date: string;
  value_date: string | null;
  first_seen_at: string;
}

export interface PaymentToConfirmItem extends CreditItem {
  suggestions: BankSuggestion[];
}

export interface ReminderItem {
  reminder_id: number;
  kind: ReminderKind;
  due_on: string;
  days_overdue: number;
  booking: BookingSummary;
  contact_email: string | null;
  hold_expires_on: string | null;
  deposit_due: number | null;
}

export interface ReminderGroup {
  kind: ReminderKind;
  title: string;
  count: number;
  items: ReminderItem[];
}

export interface TicketItem {
  booking: BookingSummary;
  contact_mobile: string | null;
  contact_email: string | null;
  vehicles: number;
  confirmed_at: string | null;
  days_to_visit: number;
}

export interface VisitFinance {
  price_per_person: number;
  total_amount: number;
  deposit_due: number;
  deposit_waived: boolean;
  paid_total: number;
  balance_due: number;
}

export interface VisitItem {
  booking: BookingSummary;
  group_type: string | null;
  arrival_time: string | null;
  vehicles: number;
  gazebos: number;
  contact_mobile: string | null;
  arrived_count: number | null;
  ticket_sent: boolean;
  finance: VisitFinance;
}

export interface ArrivalItem {
  booking: BookingSummary;
  barcode: string | null;
  days_ago: number;
}

export interface LapsingItem {
  booking: BookingSummary;
  hold_expires_on: string | null;
  days_left: number;
  deposit_due: number | null;
  proforma_sent_at: string | null;
  contact_email: string | null;
}

interface SectionBase<K extends QueueSectionKey, T> {
  key: K;
  title: string;
  count: number;
  items: T[];
}

export type QueueSection =
  | SectionBase<"needs_reply", NeedsReplyItem>
  | SectionBase<"unmatched_emails", UnmatchedEmailItem>
  | SectionBase<"new_requests", NewRequestItem>
  | SectionBase<"payments_to_confirm", PaymentToConfirmItem>
  | SectionBase<"unmatched_credits", CreditItem>
  | SectionBase<"reminders_due", ReminderGroup>
  | SectionBase<"tickets_to_send", TicketItem>
  | SectionBase<"visits_this_week", VisitItem>
  | SectionBase<"arrivals_to_record", ArrivalItem>
  | SectionBase<"lapsing", LapsingItem>;

export interface QueueResponse {
  sections: QueueSection[];
  total: number;
  today: string;
  generated_at: string;
}

export interface DismissedReminder {
  id: number;
  booking_id: number;
  kind: ReminderKind;
  due_on: string;
  status: "dismissed";
}
