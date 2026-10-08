/**
 * Bank queries and actions (web/api/payments.py).
 *
 * Keys live under ["bank", …] so the sidebar badge (["bank","counts"]) and
 * the page refresh together:
 *   ["bank", "summary"]                 GET /payments/summary
 *   ["bank", "transactions", params]    GET /payments/bank-transactions?view=…
 *   ["bank", "transaction", id]         GET /payments/bank-transactions/:id
 *   ["bank", "rules"]                   GET /payments/ignore-rules
 * Every action invalidates ["bank"], ["payments"] (first build), ["work"],
 * ["queue"], ["bookings"] and ["today"], because a match records a payment
 * and may confirm a booking.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { BookingDetail } from "@/features/bookings/types";
import { api } from "@/lib/api";

import type { BankListParams, BankListResponse, BankSummary, BankSyncResult, BankTransaction, IgnoreInput, IgnoreResponse, IgnoreRule, MatchResponse, UnmatchResponse } from "./types";

export const bankKeys = {
  all: ["bank"] as const,
  summary: ["bank", "summary"] as const,
  transactions: (p: BankListParams) => ["bank", "transactions", p] as const,
  transaction: (id: number) => ["bank", "transaction", id] as const,
  rules: ["bank", "rules"] as const,
};

export function invalidateBankWorld(qc: QueryClient): void {
  for (const key of [["bank"], ["payments"], ["work"], ["queue"], ["bookings"], ["today"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

// ----------------------------------------------------------------- queries

export function useBankSummary() {
  return useQuery({
    queryKey: bankKeys.summary,
    queryFn: () => api.get<BankSummary>("/payments/summary"),
    refetchInterval: 60_000,
  });
}

export function useBankTransactions(params: BankListParams) {
  return useQuery({
    queryKey: bankKeys.transactions(params),
    queryFn: () =>
      api.get<BankListResponse>("/payments/bank-transactions", {
        params: {
          view: params.view,
          q: params.q.trim() || undefined,
          page: params.page,
          page_size: params.page_size,
          status: params.status || undefined,
          type: params.type || undefined,
          from: params.from || undefined,
          to: params.to || undefined,
        },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useBankTransaction(id: number | null) {
  return useQuery({
    queryKey: bankKeys.transaction(id ?? 0),
    queryFn: () => api.get<BankTransaction>(`/payments/bank-transactions/${id}`),
    enabled: id !== null,
  });
}

export function useIgnoreRules(enabled = true) {
  return useQuery({
    queryKey: bankKeys.rules,
    queryFn: () => api.get<{ items: IgnoreRule[]; total: number }>("/payments/ignore-rules"),
    enabled,
  });
}

/** The booking after a match, to decide whether the deposit is now covered. */
export function fetchBooking(id: number): Promise<BookingDetail> {
  return api.get<BookingDetail>(`/bookings/${id}`);
}

// --------------------------------------------------------------- mutations

function useSettle() {
  const qc = useQueryClient();
  return (tx?: BankTransaction) => {
    if (tx) qc.setQueryData(bankKeys.transaction(tx.id), (current: BankTransaction | undefined) => (current ? { ...current, ...tx } : tx));
    invalidateBankWorld(qc);
  };
}

export function useMatchTransaction() {
  const settle = useSettle();
  return useMutation({
    mutationFn: ({ id, booking_id }: { id: number; booking_id: number }) => api.post<MatchResponse>(`/payments/bank-transactions/${id}/match`, { booking_id }),
    onSuccess: (result) => settle(result.transaction),
  });
}

export function useUnmatchTransaction() {
  const settle = useSettle();
  return useMutation({
    mutationFn: (id: number) => api.post<UnmatchResponse>(`/payments/bank-transactions/${id}/unmatch`),
    onSuccess: (result) => settle(result.transaction),
  });
}

export function useIgnoreTransaction() {
  const settle = useSettle();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & IgnoreInput) => api.post<IgnoreResponse>(`/payments/bank-transactions/${id}/ignore`, input),
    onSuccess: (result) => settle(result.transaction),
  });
}

export function useDeleteIgnoreRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ deleted: IgnoreRule }>(`/payments/ignore-rules/${id}`),
    meta: { successMessage: "Rule removed" },
    onSuccess: () => void qc.invalidateQueries({ queryKey: bankKeys.rules }),
  });
}

export function useCreateIgnoreRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { pattern: string; reason: string; note?: string }) => api.post<{ rule: IgnoreRule; created: boolean; applied: number }>("/payments/ignore-rules", input),
    onSuccess: () => invalidateBankWorld(qc),
  });
}

export function usePollBank() {
  const settle = useSettle();
  return useMutation({
    mutationFn: () => api.post<BankSyncResult>("/payments/sync"),
    onSuccess: () => settle(),
  });
}

export function useSendPaymentConfirmation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, attachInvoice }: { bookingId: number; attachInvoice?: boolean }) =>
      api.post<BookingDetail>(`/bookings/${bookingId}/actions/send-payment-confirmation`, { attach_invoice: Boolean(attachInvoice) }),
    onSuccess: (detail) => {
      qc.setQueryData(["bookings", detail.id], detail);
      for (const key of [["bookings"], ["mail"], ["inbox"], ["work"], ["today"]]) void qc.invalidateQueries({ queryKey: key });
    },
  });
}
