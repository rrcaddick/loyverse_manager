/**
 * Public form endpoints. No session, no CSRF: the API client only attaches a
 * CSRF header when the auth store has one, and these routes are exempt anyway.
 * Keys stay under the ["public", …] prefix, which the auth provider never
 * discards on an anonymous 401 (docs/handoff/frontend-foundation-v2.md §7).
 */

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

import type { BookingRequestInput, BookingRequestResult, FormConfig, GroupSuggestions, RequestSummary } from "./types";

export const publicKeys = {
  formConfig: ["public", "form-config"] as const,
  request: (id: string | number) => ["public", "request", String(id)] as const,
  groups: (q: string, email: string, mobile: string) => ["public", "groups", q, email, mobile] as const,
};

/**
 * "Did you mean": the groups this address or number booked for before, and
 * organisations whose name starts with what was typed (three letters on).
 * Names and areas only; the server hides families and limits lookups.
 */
export function useGroupSuggestions(q: string, email: string, mobile: string, enabled = true) {
  const text = q.trim();
  const e = email.trim().toLowerCase();
  const m = mobile.trim();
  return useQuery({
    queryKey: publicKeys.groups(text.length >= 3 ? text : "", e, m),
    queryFn: () => api.get<GroupSuggestions>("/public/groups/suggest", { params: { q: text.length >= 3 ? text : undefined, email: e || undefined, mobile: m || undefined } }),
    enabled: enabled && (text.length >= 3 || !!e || !!m),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

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
