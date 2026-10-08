/**
 * Bank shapes (web/api/payments.py; docs/handoff/backend-v2-misc.md §1 on
 * top of docs/handoff/payments.md). Money is a number with 2 dp; dates are
 * YYYY-MM-DD; datetimes are naive SAST ISO strings.
 *
 * Suggestions come in two shapes: the v2 one with a confidence sentence,
 * tone, rank, arithmetic and `preselected`, and the first build's with a
 * `score`. Rows matched by an older poll still carry the old shape, so every
 * v2 field is optional here and `lib.describeSuggestion` fills the gaps.
 */

import type { BookingStatus } from "@/types/api";

export type MatchStatus = "unmatched" | "suggested" | "matched" | "ignored";
export type MatchMethod = "reference" | "reference_amount" | "manual" | (string & {});
export type CreditDebit = "CREDIT" | "DEBIT";
export type BankView = "needs_attention" | "matched" | "all";
export type IgnoreReason = "own_transfer" | "card_settlement" | "interest" | "other";
export type ConfidenceKey = "equals_deposit" | "equals_balance" | "part_of_balance" | "exceeds_balance" | "name_matches";
export type ConfidenceTone = "green" | "grey";

export const BANK_VIEWS: BankView[] = ["needs_attention", "matched", "all"];
export const RULE_REASONS: IgnoreReason[] = ["own_transfer", "card_settlement", "interest"];

export const IGNORE_REASON_LABELS: Record<IgnoreReason, string> = {
  own_transfer: "Own transfer",
  card_settlement: "Card settlement",
  interest: "Interest",
  other: "Other…",
};

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
  reasons: string[];
  // v2
  confidence?: string;
  confidence_key?: ConfidenceKey;
  tone?: ConfidenceTone;
  rank?: number;
  arithmetic?: string;
  preselected?: boolean;
  // first build
  score?: number;
}

export interface MatchedBookingRef {
  id: number;
  reference: string;
  group_name: string;
}

export interface IgnoreInfo {
  reason: IgnoreReason | string;
  label: string;
  note: string | null;
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
  ignore?: IgnoreInfo | null;
  preselected_booking_id?: number | null;
  /** Only on GET /payments/bank-transactions/:id. */
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

export interface BankSummary {
  counts: Record<MatchStatus, number>;
  to_confirm?: number;
  unmatched_credits_30d: { count: number; amount: number };
  needs_attention?: number;
  last_poll: BankPoll | null;
}

export interface IgnoreRule {
  id: number;
  pattern: string;
  reason: IgnoreReason | string;
  note: string | null;
  created_by: number | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface IgnoreInput {
  reason: IgnoreReason;
  note?: string;
  create_rule?: boolean;
  pattern?: string;
}

export interface IgnoreResponse {
  transaction: BankTransaction;
  rule: null | { rule: IgnoreRule; created: boolean; applied: number };
}

export interface UnmatchResponse {
  transaction: BankTransaction;
  booking_reverted: null | { id: number; reference: string; from: BookingStatus; to: BookingStatus; deposit_due: number; paid_total: number };
}

export interface MatchResponse {
  transaction: BankTransaction;
  payment: { id?: number; amount?: number; booking_id?: number } & Record<string, unknown>;
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
  matching: { checked: number; matched: number; suggested: number; unmatched: number; failed: number; ignored?: number };
}

export interface BankListParams {
  view: BankView;
  q: string;
  page: number;
  page_size: number;
  status?: MatchStatus | "";
  type?: "credit" | "debit" | "";
  from?: string;
  to?: string;
}

export interface BankListResponse {
  items: BankTransaction[];
  total: number;
  page: number;
  page_size: number;
}
