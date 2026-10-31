/**
 * Enquiries: conversations that matched no booking and wait on us
 * (docs/handoff/migration-and-inbound.md §4; /api/v1/enquiries).
 */

import type { StatusTone } from "@/components/status-pill";
import type { Paginated } from "@/types/api";

export type EnquiryStatus = "open" | "replied" | "converted" | "attached" | "resolved" | "not_booking";

export interface Enquiry {
  id: number;
  /** Gmail thread id as a string (it exceeds JS integer range). */
  gmail_thrid: string | number | null;
  sender_email: string;
  sender_name: string | null;
  subject: string | null;
  status: EnquiryStatus;
  booking_id: number | null;
  convert_sent_at: string | null;
  first_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  message_count: number;
  snippet: string | null;
  extracted: Record<string, unknown> | null;
  resolved_at: string | null;
  resolved_by: number | null;
  created_at: string;
  updated_at: string;
  /** Open or replied: still ours to deal with. */
  waiting: boolean;
}

export interface EnquiryCounts {
  open: number;
  replied: number;
  converted: number;
  attached: number;
  resolved: number;
  not_booking: number;
  /** open + replied */
  waiting: number;
}

export interface EnquiryList extends Paginated<Enquiry> {
  counts: EnquiryCounts;
}

export interface EnquiryDetail {
  enquiry: Enquiry;
  form_link: string;
}

/** What the mail says, for Create request (GET /enquiries/:id/prefill). */
export interface EnquiryPrefill {
  contact_email?: string | null;
  contact_name?: string | null;
  contact_mobile?: string | null;
  group_name?: string | null;
  group_type?: string | null;
  area?: string | null;
  visit_date?: string | null;
  alternative_date?: string | null;
  adults?: number | null;
  children?: number | null;
  people_booked?: number | null;
  questions?: string[] | null;
  notes?: string | null;
}

export type EnquiryBucket = "open" | "resolved" | "not_booking" | "all";
export const ENQUIRY_BUCKETS: EnquiryBucket[] = ["open", "resolved", "not_booking", "all"];
export const BUCKET_LABELS: Record<EnquiryBucket, string> = {
  open: "Open",
  resolved: "Resolved",
  not_booking: "Not an enquiry",
  all: "All",
};

export const ENQUIRY_STATUS_META: Record<EnquiryStatus, { label: string; tone: StatusTone }> = {
  open: { label: "Waiting", tone: "amber" },
  replied: { label: "Replied", tone: "blue" },
  converted: { label: "Converted", tone: "green" },
  attached: { label: "Attached", tone: "green-muted" },
  resolved: { label: "Resolved", tone: "neutral" },
  not_booking: { label: "Not an enquiry", tone: "neutral" },
};

export interface EnquiryListParams {
  status: EnquiryBucket;
  q?: string;
  page: number;
  page_size: number;
}
