/**
 * Inbox shapes from web/api/inbox.py (docs/handoff/mail.md).
 * `gmail_thrid` and `gmail_msgid` are strings: they exceed 2^53.
 * `sent_at` is naive Africa/Johannesburg local time.
 */

import type { BookingStatus } from "@/types/api";

export type InboxView = "review" | "unmatched" | "all" | "booking";
export type Direction = "inbound" | "outbound";
export type ReviewStatus = "none" | "pending" | "resolved" | "not_booking";
export type MatchMethod = "reference" | "thread" | "email" | "phone" | "manual" | "import" | "sent";

export interface MessageBookingRef {
  id: number;
  reference: string;
  group_name: string;
}

export interface InboxListItem {
  id: number;
  direction: Direction;
  /** Set on outbound rows we sent: proforma, reply, bounce_back, custom… */
  kind: string | null;
  from_name: string | null;
  from_email: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string | null;
  sent_at: string;
  has_attachments: boolean;
  booking: MessageBookingRef | null;
  match_method: MatchMethod | null;
  review_status: ReviewStatus;
  is_auto_generated: boolean;
  gmail_thrid: string | null;
  send_status: "sent" | "failed" | null;
  bounce_back_sent_at: string | null;
}

export interface Attachment {
  id: number;
  filename: string;
  size_bytes: number;
  content_type: string | null;
  url: string;
}

export interface AttachmentMeta {
  filename: string;
  size: number;
  content_type: string | null;
  skipped?: boolean;
}

export interface ThreadSummary {
  gmail_thrid: string | null;
  booking_id: number | null;
  count: number;
  inbound: number;
  outbound: number;
  first_at: string | null;
  last_at: string | null;
}

export interface FullMessage extends InboxListItem {
  gmail_msgid: string | null;
  folder: string | null;
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  body_text: string | null;
  body_html: string | null;
  send_error: string | null;
  sent_by: number | null;
  attachments_meta: AttachmentMeta[];
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
  attachments: Attachment[];
  thread?: ThreadSummary | null;
  bounce_back?: { sender_email: string; last_sent_at: string } | null;
}

export interface InboxListResponse {
  items: InboxListItem[];
  total: number;
  page: number;
  page_size: number;
  counts: { review: number; unmatched: number };
}

export interface ThreadResponse {
  gmail_thrid: string;
  booking: MessageBookingRef | null;
  messages: FullMessage[];
  summary: ThreadSummary;
}

export interface BookingSuggestion {
  booking_id: number;
  reference: string;
  group_name: string;
  contact_name: string | null;
  visit_date: string;
  status: BookingStatus;
  /** 0–1 */
  score: number;
  reasons: string[];
}

export interface ExtractedFields {
  group_name: string | null;
  group_type: string | null;
  area: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_mobile: string | null;
  visit_date: string | null;
  alternative_date: string | null;
  adults: number | null;
  children: number | null;
  people_booked: number | null;
  vehicles: number | null;
  gazebos: number | null;
  arrival_time: string | null;
  questions: string[] | null;
  notes: string | null;
}

export interface SyncFolderSummary {
  mode: string;
  fetched: number;
  inserted: number;
  updated: number;
  matched: number;
  pending: number;
  errors: number;
  attachments: number;
}

export interface SyncSummary {
  ok: boolean;
  mode: string;
  duration_s: number;
  fetched: number;
  inserted: number;
  updated: number;
  claimed: number;
  matched: number;
  pending: number;
  rematched: number;
  errors: string[];
  folders: Record<string, SyncFolderSummary>;
  counts: { review: number; unmatched: number };
}

export interface InboxListParams {
  view: InboxView;
  page: number;
  q: string;
  booking_id: number | null;
  page_size?: number;
}
