/**
 * Mail v2 shapes (docs/handoff/mail-v2.md): one row per Gmail thread, work
 * queues over conversations, and a stream that merges messages, notes and
 * booking events. Every `thrid` / `gmail_thrid` is a string (it exceeds
 * 2^53). Timestamps are naive Africa/Johannesburg ISO strings.
 */

import type { BookingStatus } from "@/types/api";

export type MailView = "needs_reply" | "unmatched" | "waiting" | "done" | "all";
export type MailChip = "inbound" | "sent" | "failed" | "automated";
export type Direction = "inbound" | "outbound";

export const MAIL_VIEWS: MailView[] = ["needs_reply", "unmatched", "waiting", "done", "all"];
export const MAIL_CHIPS: MailChip[] = ["inbound", "sent", "failed", "automated"];

export interface ThreadBooking {
  id: number;
  reference: string;
  group_name: string;
  status: BookingStatus;
  /** ISO date on most responses; thread rows may carry an RFC-1123 string. */
  visit_date: string | null;
  contact_name: string | null;
}

export interface Thread {
  thrid: string;
  booking: ThreadBooking | null;
  counterpart_name: string | null;
  counterpart_email: string | null;
  subject: string | null;
  last_snippet: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_direction: Direction | null;
  message_count: number;
  status: "open" | "done";
  not_booking: boolean;
  unread: boolean;
  has_attachments: boolean;
  has_automated_only: boolean;
  done_at: string | null;
  done_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationCounts {
  needs_reply: number;
  unmatched: number;
  waiting: number;
  done: number;
  all: number;
}

export interface ConversationsResponse {
  items: Thread[];
  total: number;
  page: number;
  page_size: number;
  view: MailView;
  chip: MailChip | null;
  counts: ConversationCounts;
}

export interface MessageAttachment {
  id: number;
  filename: string;
  size_bytes: number;
  content_type: string | null;
  url: string;
}

export interface MessageBookingRef {
  id: number;
  reference: string;
  group_name: string;
}

export interface MessageItem {
  type: Direction;
  key: string;
  id: number;
  at: string;
  gmail_thrid: string | null;
  from_name: string | null;
  from_email: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  /** Outbound only: proforma, invoice, final_invoice, reply, bounce_back, ticket… */
  kind: string | null;
  snippet: string | null;
  /** Null only for text-only mail → render body_new_text. */
  body_new_html: string | null;
  body_new_text: string | null;
  body_quoted_html: string | null;
  has_quoted: boolean;
  quoted_lines: number;
  signature_text: string | null;
  has_signature: boolean;
  has_original_html: boolean;
  split_version: number;
  attachments: MessageAttachment[];
  has_attachments: boolean;
  send_status: "sent" | "failed" | null;
  send_error: string | null;
  sent_by: number | null;
  sent_by_name: string | null;
  is_auto_generated: boolean;
  booking: MessageBookingRef | null;
  match_method: string | null;
  review_status: string;
  message_id_header: string | null;
}

export interface NoteItem {
  type: "note";
  key: string;
  id: number;
  at: string;
  body: string;
  author_user_id: number | null;
  author_name: string | null;
  source: "thread" | "booking";
  gmail_thrid: string | null;
  booking_id: number | null;
}

export interface EventLink {
  kind: "document" | "payment" | "message" | "booking";
  id: number | null;
  bank_transaction_id?: number | null;
  booking_id?: number | null;
}

export interface EventItem {
  type: "event";
  key: string;
  id: number;
  at: string;
  kind: string;
  summary: string;
  data: Record<string, unknown> | null;
  actor_user_id: number | null;
  actor_name: string | null;
  booking_id: number | null;
  link: EventLink | null;
}

export type StreamItem = MessageItem | NoteItem | EventItem;

export function isMessage(item: StreamItem): item is MessageItem {
  return item.type === "inbound" || item.type === "outbound";
}

export interface ConversationResponse {
  thread: Thread;
  booking: ThreadBooking | null;
  items: StreamItem[];
}

export interface BookingConversationBooking {
  id: number;
  reference: string;
  group_name: string;
  status: BookingStatus;
  visit_date: string | null;
  contact_name: string | null;
  contact_email: string | null;
  email_thread_id: string | null;
}

export interface BookingConversationResponse {
  booking: BookingConversationBooking;
  threads: Thread[];
  items: StreamItem[];
}

/** GET /inbox/conversations/:thrid/suggestions — the matcher's candidates (0–1 score). */
export interface ThreadSuggestion {
  booking_id: number;
  reference: string;
  group_name: string;
  contact_name: string | null;
  visit_date: string | null;
  status: BookingStatus;
  score: number;
  reasons: string[];
}

export interface MailTemplate {
  key: string;
  label: string;
  subject: string | null;
  body_html: string;
  body_text: string;
}

export interface OriginalMessage {
  id: number;
  gmail_thrid: string | null;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  split_version: number;
}

export interface ThreadReplyInput {
  body_html: string;
  body_text?: string;
  subject?: string;
  cc?: string[];
  attach_document_ids?: number[];
  mark_done?: boolean;
}

export interface ThreadReplyResponse {
  item: MessageItem;
  thread: Thread;
  counts: ConversationCounts;
}

export interface ThreadActionResponse {
  thread: Thread;
  counts: ConversationCounts;
}

export interface ConversationListParams {
  view: MailView;
  chip: MailChip | null;
  q: string;
  page: number;
  page_size?: number;
}
