/**
 * Public form endpoints. No session, no CSRF: the API client only attaches a
 * CSRF header when the auth store has one, and these routes are exempt anyway.
 * Keys stay under the ["public", …] prefix, which the auth provider never
 * discards on an anonymous 401 (docs/handoff/frontend-foundation-v2.md §7).
 */

import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

import type { BookingRequestInput, BookingRequestResult, FormConfig, RequestSummary } from "./types";

export const publicKeys = {
  formConfig: ["public", "form-config"] as const,
  request: (id: string | number) => ["public", "request", String(id)] as const,
};

export function useFormConfig() {
  return useQuery({
    queryKey: publicKeys.formConfig,
    queryFn: () => api.get<FormConfig>("/public/form-config"),
    staleTime: 60_000,
  });
}

export function useSubmitBookingRequest() {
  return useMutation({
    mutationFn: (input: BookingRequestInput) => api.post<BookingRequestResult>("/public/booking-request", input),
    meta: { silent: true },
  });
}

/** The confirmation page's data; `initialData` lets the page paint before the GET returns. */
export function useRequestSummary(id: string | undefined, token: string | null, initialData?: RequestSummary) {
  return useQuery({
    queryKey: publicKeys.request(id ?? ""),
    queryFn: () => api.get<RequestSummary>(`/public/requests/${id}`, { params: { token } }),
    enabled: !!id && !!token,
    initialData,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
