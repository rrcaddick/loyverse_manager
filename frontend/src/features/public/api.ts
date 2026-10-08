/**
 * Public form endpoints. No session, no CSRF: the API client only attaches a
 * CSRF header when the auth store has one, and these routes are exempt anyway.
 */

import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

import type { BookingRequestInput, BookingRequestResult, FormConfig } from "./types";

export function useFormConfig() {
  return useQuery({
    queryKey: ["public", "form-config"],
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
