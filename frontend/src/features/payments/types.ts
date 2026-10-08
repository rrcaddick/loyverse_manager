/**
 * Bank transaction shapes from web/api/payments.py (docs/handoff/payments.md).
 * Money is a number with 2 dp; dates are YYYY-MM-DD; datetimes ISO seconds.
 */

import type { BookingStatus } from "@/types/api";

export type MatchStatus = "unmatched" | "suggested" | "matched" | "ignored";
export type MatchMethod = "reference" | "reference_amount" | "manual";
export type CreditDebit = "CREDIT" | "DEBIT";

export const MATCH_STATUSES: MatchStatus[] = ["unmatched", "suggested", "matched", "ignored"];

/** One candidate booking for a credit, as stored in bank_transactions.suggestions. */
export interface BankSuggestion {
  booking_id: number;
  reference: string;
  group_name: string;
  contact_name: string | null;
  visit_date: string;
  status: BookingStatus;
  total_amount: number;
  deposit_due: number;
  paid_total: number;
  balance_due: number;
  /** 0–100 */
  score: number;
  reasons: string[];
}

export interface MatchedBookingRef {
  id: number;
  reference: string;
  group_name: string;
}

export interface BankTransaction {
  id: number;
  fingerprint: string;
  account_number: string;
  entry_id: string | null;
  booking_date: string;
  value_date: string | null;
  description: string;
  end_to_end_id: string | null;
  amount: number;
  credit_debit: CreditDebit;
  balance_after: number | null;
  first_seen_at: string;
  match_status: MatchStatus;
  matched_booking: MatchedBookingRef | null;
  matched_booking_id: number | null;
  matched_at: string | null;
  matched_by: number | null;
  match_method: MatchMethod | null;
  suggestions: BankSuggestion[];
  ignore_reason: string | null;
  /** Only on GET /payments/bank-transactions/:id — the FNB entry as received. */
  raw?: Record<string, unknown> | null;
}

export interface BankPoll {
  id: number;
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  window_from: string | null;
  window_to: string | null;
  entries: number | null;
  new_entries: number | null;
  error: string | null;
}

export interface PaymentsSummary {
  counts: Record<MatchStatus, number>;
  unmatched_credits_30d: { count: number; amount: number };
  last_poll: BankPoll | null;
}

export interface BankSyncResult {
  poll_id: number;
  status: string;
  window_from: string;
  window_to: string;
  entries: number;
  new_entries: number;
  new_credits: number;
  new_debits: number;
  chain_breaks: number;
  http_calls: number;
  matching: { checked: number; matched: number; suggested: number; unmatched: number; failed: number };
}

export interface TransactionFilters {
  status: MatchStatus | "";
  type: "credit" | "debit" | "";
  from: string;
  to: string;
  q: string;
  page: number;
  page_size: number;
}

export const MATCH_STATUS_META: Record<MatchStatus, { label: string; tone: "neutral" | "amber" | "green" | "red-muted" }> = {
  unmatched: { label: "Unmatched", tone: "neutral" },
  suggested: { label: "Suggested", tone: "amber" },
  matched: { label: "Matched", tone: "green" },
  ignored: { label: "Ignored", tone: "red-muted" },
};
