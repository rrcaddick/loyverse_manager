/**
 * Shapes returned by /api/v1/bookings, /calendar and /days (docs/handoff/bookings.md),
 * plus the inbox message shape the Emails tab reads (docs/handoff/mail.md).
 * Money is a 2dp float; dates are "YYYY-MM-DD"; datetimes are naive SAST ISO.
 */

import type { BookingStatus } from "@/types/api";

export type BookingSource = "form" | "email" | "import" | "manual";
export type PaymentKind = "eft" | "cash" | "card" | "other";
export type ArrivalSource = "loyverse" | "manual";
export type DocumentKind = "proforma" | "invoice" | "final_invoice";
export type ReminderKind = "still_interested" | "deposit_reminder" | "final_details" | "lapse";
export type EmailReminderKind = Exclude<ReminderKind, "lapse">;

/** Every `bookings` column, serialised. */
export interface BookingRow {
  id: number;
  reference: string;
  doc_number: number | null;
  status: BookingStatus;
  group_name: string;
  group_type: string | null;
  area: string | null;
  contact_name: string;
  contact_email: string | null;
  contact_mobile: string | null;
  visit_date: string;
  alternative_date: string | null;
  arrival_time: string | null;
  adults: number;
  children: number;
  people_booked: number;
  vehicles: number;
  gazebos: number;
  price_tier_code: string | null;
  price_per_person: number;
  price_overridden: boolean;
  price_override_reason: string | null;
  deposit_due: number;
  deposit_overridden: boolean;
  deposit_waived: boolean;
  deposit_override_reason: string | null;
  arrived_count: number | null;
  arrived_source: ArrivalSource | null;
  arrived_at: string | null;
  barcode: string | null;
  source: BookingSource;
  enquiry_date: string | null;
  hold_expires_on: string | null;
  customer_notes: string | null;
  internal_notes: string | null;
  /** Gmail thread id. Exceeds JS integer range: never rely on its digits. */
  email_thread_id: number | null;
  proforma_sent_at: string | null;
  invoice_sent_at: string | null;
  final_invoice_sent_at: string | null;
  ticket_sent_at: string | null;
  ticket_emailed_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  lapsed_at: string | null;
  legacy_sheet_row: Record<string, string> | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/** GET /bookings items. */
export interface BookingListItem extends BookingRow {
  paid_total: number;
  total_amount: number;
  balance_due: number;
  deposit_covered: boolean;
  status_label: string;
}

export interface BookingFinance {
  price_per_person: number;
  people_booked: number;
  total_amount: number;
  vat_amount: number;
  vat_rate: number;
  deposit_due: number;
  deposit_waived: boolean;
  paid_total: number;
  deposit_outstanding: number;
  deposit_covered: boolean;
  balance_due: number;
  arrived_count: number | null;
  final_amount: number | null;
  final_vat_amount: number | null;
}

export interface BookingQuestion {
  id: number;
  booking_id: number;
  question: string;
  answer: string | null;
  answered_at: string | null;
  answered_by: number | null;
  answered_by_name: string | null;
  sort_order: number;
  created_at: string;
}

export interface Payment {
  id: number;
  booking_id: number;
  kind: PaymentKind;
  amount: number;
  paid_on: string | null;
  reference: string | null;
  bank_transaction_id: number | null;
  note: string | null;
  recorded_by: number | null;
  recorded_by_name: string | null;
  created_at: string;
}

export type BookingEventKind =
  | "created"
  | "updated"
  | "override"
  | "status_changed"
  | "note"
  | "payment_recorded"
  | "payment_deleted"
  | "arrivals_recorded"
  | "ticket_sent"
  | "document_issued"
  | "email_sent"
  | "email_failed"
  | "email_received"
  | (string & {});

export interface BookingEvent {
  id: number;
  booking_id: number;
  kind: BookingEventKind;
  summary: string;
  data: Record<string, unknown> | null;
  actor_user_id: number | null;
  actor_name: string | null;
  created_at: string;
}

export interface BookingDocument {
  id: number;
  booking_id: number;
  kind: DocumentKind;
  number: string;
  version: number;
  file_path?: string;
  total: number;
  paid: number;
  due: number;
  issued_at: string;
  issued_by: number | null;
  email_message_id: number | null;
  label: string;
  filename: string;
}

/** The email summary rows embedded in a booking detail (no body). */
export interface BookingEmail {
  id: number;
  direction: "inbound" | "outbound";
  kind: string | null;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  sent_at: string;
  snippet: string | null;
  has_attachments: boolean;
  send_status: "sent" | "failed" | null;
  send_error: string | null;
  /** Numeric in this payload (precision lost) - use message ids, not this. */
  gmail_thrid: number | string | null;
  message_id_header: string | null;
}

export interface BookingReminder {
  id: number;
  booking_id: number;
  kind: ReminderKind;
  due_on: string;
  status: "due" | "sent" | "dismissed" | (string & {});
  dismissed_by: number | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DayType = "weekday" | "weekend";

export interface ActionResult {
  email_message_id?: number;
  kind?: string;
  to?: string;
  subject?: string | null;
  document?: BookingDocument | null;
  reminder_kind?: string;
  confirmed?: boolean;
  reason?: string | null;
  success?: boolean;
  conversation_id?: number | string;
  message_id?: number | string;
  [key: string]: unknown;
}

/** GET /bookings/:id and every mutation/action response. */
export interface BookingDetail extends BookingRow {
  status_label: string;
  allowed_transitions: BookingStatus[];
  day_type: DayType;
  is_peak: boolean;
  in_no_discount_window: boolean;
  finance: BookingFinance;
  questions: BookingQuestion[];
  payments: Payment[];
  events: BookingEvent[];
  documents: BookingDocument[];
  emails: BookingEmail[];
  reminders: BookingReminder[];
  action?: string;
  action_result?: ActionResult;
}

// --------------------------------------------------------------- calendar

export interface CalendarDayBooking {
  id: number;
  reference: string;
  group_name: string;
  status: BookingStatus;
  people_booked: number;
  group_type: string | null;
  contact_name: string | null;
  arrival_time: string | null;
  vehicles: number;
}

export interface CalendarDay {
  date: string;
  /** Python weekday: 0 = Monday. */
  weekday: number;
  day_type: DayType;
  is_closed: boolean;
  is_avoid: boolean;
  is_peak: boolean;
  in_no_discount_window: boolean;
  label: string | null;
  total_people: number;
  confirmed_people: number;
  tentative_people: number;
  booking_count: number;
  capacity_warning: boolean;
  bookings: CalendarDayBooking[];
}

export interface CalendarResponse {
  from: string;
  to: string;
  days: CalendarDay[];
}

/** GET /days/:date items: the row plus finance and payments (no list-item roll-ups). */
export interface DayViewBooking extends BookingRow {
  paid_total: number;
  finance: BookingFinance;
  payments: Payment[];
}

export interface DayView {
  date: string;
  weekday: number;
  day_type: DayType;
  is_closed: boolean;
  is_avoid: boolean;
  is_peak: boolean;
  label: string | null;
  public_holiday: string | null;
  capacity_warning: boolean;
  totals: {
    bookings: number;
    total_people: number;
    confirmed_people: number;
    tentative_people: number;
    arrived_total: number;
    paid_total: number;
    balance_due_total: number;
  };
  bookings: DayViewBooking[];
}

// ------------------------------------------------------------------ inbox

export interface InboxAttachment {
  id: number;
  filename: string;
  size_bytes: number;
  content_type: string | null;
  url: string;
}

/** GET /inbox/messages/:id (the fields the Emails tab uses). */
export interface InboxMessage {
  id: number;
  direction: "inbound" | "outbound";
  kind: string | null;
  from_name: string | null;
  from_email: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string | null;
  sent_at: string;
  has_attachments: boolean;
  body_text: string | null;
  body_html: string | null;
  send_status: "sent" | "failed" | null;
  send_error: string | null;
  gmail_thrid: string | null;
  message_id_header: string | null;
  attachments: InboxAttachment[];
}

// -------------------------------------------------------------- requests

export interface ArrivalsCheck {
  booking_id: number;
  visit_date: string;
  count: number;
  source: "loyverse";
  recorded_count: number | null;
  recorded_source: ArrivalSource | null;
}

export interface BookingListParams {
  status?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  page_size?: number;
  sort?: string;
}

/** Fields accepted by POST /bookings and PATCH /bookings/:id. */
export interface BookingInput {
  group_name?: string;
  group_type?: string | null;
  area?: string | null;
  contact_name?: string;
  contact_email?: string | null;
  contact_mobile?: string | null;
  visit_date?: string;
  alternative_date?: string | null;
  arrival_time?: string | null;
  adults?: number;
  children?: number;
  people_booked?: number;
  vehicles?: number;
  gazebos?: number;
  price_tier_code?: string | null;
  price_per_person?: number;
  price_overridden?: boolean;
  price_override_reason?: string | null;
  deposit_due?: number;
  deposit_overridden?: boolean;
  deposit_waived?: boolean;
  deposit_override_reason?: string | null;
  hold_expires_on?: string | null;
  customer_notes?: string | null;
  internal_notes?: string | null;
  enquiry_date?: string | null;
  questions?: string[];
  source?: BookingSource;
}

export interface RecordPaymentInput {
  kind: PaymentKind;
  amount: number;
  paid_on?: string;
  reference?: string;
  note?: string;
}

export interface ReplyInput {
  body_html: string;
  subject?: string;
  attach_document_ids?: number[];
}

export type BookingAction =
  | "send-acknowledgement"
  | "issue-proforma"
  | "send-proforma"
  | "send-invoice"
  | "send-final-invoice"
  | "send-ticket-email"
  | "send-ticket-whatsapp"
  | "send-payment-confirmation"
  | "send-reminder"
  | "send-expiry"
  | "send-answers"
  | "confirm";

export const TENTATIVE_STATUSES: BookingStatus[] = ["enquiry", "proforma_sent"];
export const FIRM_STATUSES: BookingStatus[] = ["confirmed", "completed"];
export const ACTIVE_STATUSES: BookingStatus[] = ["enquiry", "proforma_sent", "confirmed", "completed"];

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  eft: "EFT",
  cash: "Cash",
  card: "Card",
  other: "Other",
};

export const SOURCE_LABELS: Record<BookingSource, string> = {
  form: "Online form",
  email: "Email",
  import: "Booking sheet",
  manual: "Entered manually",
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  proforma: "Proforma",
  invoice: "Invoice",
  final_invoice: "Final invoice",
};

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  still_interested: "Still interested?",
  deposit_reminder: "Deposit reminder",
  final_details: "Final details",
  lapse: "Hold expiry",
};
