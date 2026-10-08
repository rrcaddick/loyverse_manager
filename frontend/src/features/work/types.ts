/**
 * GET /work, GET /work/counts and the action vocabulary
 * (docs/handoff/work-today.md). Every row has the same anatomy whatever the
 * view: a kind, a booking reference (null for an unmatched bank credit), a
 * title and one context line, and the verbs the UI must render — `primary`
 * is the one filled button, `secondary[0]` the ghost, the rest go under ⋯.
 */

import type { BookingStatus } from "@/types/api";

export type WorkView = "up_next" | "reply" | "new_requests" | "confirm_money" | "send_tickets" | "reminders" | "holds" | "arrivals" | "stale";

export const WORK_VIEWS: WorkView[] = ["up_next", "reply", "new_requests", "confirm_money", "send_tickets", "reminders", "holds", "arrivals", "stale"];

export function isWorkView(value: string | null | undefined): value is WorkView {
  return !!value && (WORK_VIEWS as string[]).includes(value);
}

export type WorkKind = "reply" | "new_request" | "money" | "ticket" | "reminder" | "hold" | "arrival";

export interface WorkBookingRef {
  id: number;
  reference: string;
  group_name: string;
  visit_date: string;
  status: BookingStatus;
  people_booked: number;
}

interface ActionBase {
  /** The button label; fixed per kind so the same word means the same thing everywhere. */
  verb: string;
}

export interface OpenBookingAction extends ActionBase {
  action: "open_booking";
  booking_id: number;
}

export interface OpenConversationAction extends ActionBase {
  action: "open_conversation";
  /** Gmail thread id as a string (exceeds 2^53). */
  thrid: string;
  booking_id: number;
  message_id?: number;
}

export interface OpenTransactionAction extends ActionBase {
  action: "open_transaction";
  tx_id: number;
}

export interface OpenDayAction extends ActionBase {
  action: "open_day";
  date: string;
  booking_id: number;
}

export interface BookingActionAction extends ActionBase {
  action: "booking_action";
  booking_id: number;
  /** POST /bookings/:id/actions/<name>. */
  name: string;
  /** Extra body key for send-reminder. */
  kind?: string;
}

export interface SendReminderAction extends ActionBase {
  action: "send_reminder";
  booking_id: number;
  kind: string;
}

export interface MatchTransactionAction extends ActionBase {
  action: "match_transaction";
  tx_id: number;
  booking_id: number;
}

export interface IgnoreTransactionAction extends ActionBase {
  action: "ignore_transaction";
  tx_id: number;
  /** A fixed reason ("Not a booking") — fire without asking. */
  reason?: string;
}

export interface DismissRemindersAction extends ActionBase {
  action: "dismiss_reminders";
  ids: (number | string)[];
}

export interface ExtendHoldAction extends ActionBase {
  action: "extend_hold";
  booking_id: number;
  hold_expires_on: string | null;
}

export interface SetStatusAction extends ActionBase {
  action: "set_status";
  booking_id: number;
  status: BookingStatus;
}

export type WorkAction =
  | OpenBookingAction
  | OpenConversationAction
  | OpenTransactionAction
  | OpenDayAction
  | BookingActionAction
  | SendReminderAction
  | MatchTransactionAction
  | IgnoreTransactionAction
  | DismissRemindersAction
  | ExtendHoldAction
  | SetStatusAction;

export type WorkActionName = WorkAction["action"];

export interface WorkRow {
  kind: WorkKind;
  /** Kind-prefixed, e.g. "hold:124", "reply:1868…". */
  id: string;
  booking: WorkBookingRef | null;
  title: string;
  context: string;
  amount: number | null;
  age_days: number;
  /** Reminder rows: "Deposit reminder" | "Still interested?" | "Final details" | "Hold expiring". */
  group: string | null;
  primary: WorkAction;
  secondary: WorkAction[];
  sort_key: string;
}

export interface WorkCounts {
  up_next: number;
  reply: number;
  new_requests: number;
  confirm_money: number;
  send_tickets: number;
  reminders: number;
  holds: number;
  arrivals: number;
  stale: number;
  /** The seven live views (stale excluded) — the sidebar badge. */
  total: number;
}

export interface WorkCountsResponse {
  counts: WorkCounts;
  today: string;
}

export interface WorkListResponse {
  view: WorkView;
  items: WorkRow[];
  total: number;
  page: number;
  page_size: number;
  today: string;
  counts: WorkCounts;
}

export interface DismissResponse {
  dismissed: number;
  ids: number[];
  skipped: (number | string)[];
  counts: WorkCounts;
}

/** Reasons accepted by POST /payments/bank-transactions/:id/ignore. */
export type IgnoreReason = "own_transfer" | "card_settlement" | "interest" | "other";

export const IGNORE_REASONS: { value: IgnoreReason; label: string; note?: string }[] = [
  { value: "other", label: "Not a booking", note: "Not a booking" },
  { value: "own_transfer", label: "Own transfer" },
  { value: "card_settlement", label: "Card settlement" },
  { value: "interest", label: "Interest" },
  { value: "other", label: "Other" },
];

export interface IgnoreInput {
  reason: IgnoreReason;
  note?: string;
}

/** The API's four reasons; a fixed label such as "Not a booking" becomes `other` with a note. */
export function fixedIgnoreReason(reason: string | undefined): IgnoreInput | null {
  if (!reason) return null;
  const known = IGNORE_REASONS.find((r) => r.value === reason && !r.note);
  if (known) return { reason: known.value };
  return { reason: "other", note: reason };
}
