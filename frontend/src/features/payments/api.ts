/**
 * Bank transaction queries and actions (web/api/payments.py).
 *
 * Keys: ["payments", "transactions", params] / ["payments", "transaction", id] /
 * ["payments", "summary"]. Every action invalidates ["payments"], ["queue"] and
 * ["bookings"] because a match records a payment (and may confirm a booking).
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Paginated } from "@/types/api";

import type { BankSyncResult, BankTransaction, PaymentsSummary, TransactionFilters } from "./types";

export const paymentKeys = {
  all: ["payments"] as const,
  summary: ["payments", "summary"] as const,
  transactions: (params: Partial<TransactionFilters>) => ["payments", "transactions", params] as const,
  transaction: (id: number) => ["payments", "transaction", id] as const,
};

export function usePaymentsSummary() {
  return useQuery({
    queryKey: paymentKeys.summary,
    queryFn: () => api.get<PaymentsSummary>("/payments/summary"),
    refetchInterval: 120_000,
  });
}

export function useTransactions(filters: TransactionFilters) {
  const params = {
    status: filters.status || undefined,
    type: filters.type || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    q: filters.q.trim() || undefined,
    page: filters.page,
    page_size: filters.page_size,
  };
  return useQuery({
    queryKey: paymentKeys.transactions(params),
    queryFn: () => api.get<Paginated<BankTransaction>>("/payments/bank-transactions", { params }),
    placeholderData: keepPreviousData,
  });
}

export function useTransaction(id: number | null) {
  return useQuery({
    queryKey: paymentKeys.transaction(id ?? 0),
    queryFn: () => api.get<BankTransaction>(`/payments/bank-transactions/${id}`),
    enabled: id !== null,
  });
}

function useInvalidateAfterAction() {
  const qc = useQueryClient();
  return (tx?: BankTransaction) => {
    if (tx) qc.setQueryData(paymentKeys.transaction(tx.id), (current: BankTransaction | undefined) => (current ? { ...current, ...tx } : tx));
    void qc.invalidateQueries({ queryKey: paymentKeys.all });
    void qc.invalidateQueries({ queryKey: ["queue"] });
    void qc.invalidateQueries({ queryKey: ["bookings"] });
  };
}

export function useMatchTransaction() {
  const settle = useInvalidateAfterAction();
  return useMutation({
    mutationFn: ({ id, booking_id }: { id: number; booking_id: number }) =>
      api.post<{ transaction: BankTransaction; payment: Record<string, unknown> }>(`/payments/bank-transactions/${id}/match`, { booking_id }),
    meta: { successMessage: "Payment recorded on the booking" },
    onSuccess: (result) => settle(result.transaction),
  });
}

export function useUnmatchTransaction() {
  const settle = useInvalidateAfterAction();
  return useMutation({
    mutationFn: (id: number) => api.post<{ transaction: BankTransaction }>(`/payments/bank-transactions/${id}/unmatch`),
    meta: { successMessage: "Match removed" },
    onSuccess: (result) => settle(result.transaction),
  });
}

export function useIgnoreTransaction() {
  const settle = useInvalidateAfterAction();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.post<{ transaction: BankTransaction }>(`/payments/bank-transactions/${id}/ignore`, { reason }),
    meta: { successMessage: "Transaction ignored" },
    onSuccess: (result) => settle(result.transaction),
  });
}

export function useSyncBank() {
  const settle = useInvalidateAfterAction();
  return useMutation({
    mutationFn: () => api.post<BankSyncResult>("/payments/sync"),
    onSuccess: () => settle(),
  });
}
