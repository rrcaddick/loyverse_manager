/**
 * TanStack Query hooks for /api/v1/enquiries.
 *
 *   useEnquiries(params)         the list for a bucket (+ counts)
 *   useEnquiry(id)               one enquiry
 *   useEnquiryPrefill(id)        what the mail says, for Create request
 *   useEnquiryAction(id)         resolve | reopen | not-booking | convert
 *   useCreateRequest(id)         a booking request on the customer's behalf
 *   useAttachEnquiry(id)         attach the conversation to a booking
 *
 * Every write refreshes the enquiries, Work and the bookings caches: an
 * enquiry that converts or attaches shows up on a booking at once.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BookingDetail } from "@/features/bookings/types";
import type { BookingInput } from "@/features/bookings/types";
import { api } from "@/lib/api";

import type { Enquiry, EnquiryDetail, EnquiryList, EnquiryListParams, EnquiryPrefill } from "./types";

export const enquiryKeys = {
  all: ["enquiries"] as const,
  list: (params: EnquiryListParams) => ["enquiries", "list", params] as const,
  detail: (id: number) => ["enquiries", id] as const,
  prefill: (id: number) => ["enquiries", id, "prefill"] as const,
};

export function useEnquiries(params: EnquiryListParams) {
  return useQuery({
    queryKey: enquiryKeys.list(params),
    queryFn: () => api.get<EnquiryList>("/enquiries", { params: { status: params.status, q: params.q || undefined, page: params.page, page_size: params.page_size } }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useEnquiry(id: number | null) {
  return useQuery({
    queryKey: enquiryKeys.detail(id ?? -1),
    queryFn: () => api.get<EnquiryDetail>(`/enquiries/${id}`),
    enabled: id !== null && Number.isFinite(id),
  });
}

export function useEnquiryPrefill(id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: enquiryKeys.prefill(id ?? -1),
    queryFn: () => api.get<EnquiryPrefill>(`/enquiries/${id}/prefill`),
    enabled: enabled && id !== null,
    staleTime: 5 * 60_000,
  });
}

function invalidateAfterWrite(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: enquiryKeys.all });
  void qc.invalidateQueries({ queryKey: ["work"] });
  void qc.invalidateQueries({ queryKey: ["bookings"] });
  void qc.invalidateQueries({ queryKey: ["mail"] });
}

export type EnquiryAction = "resolve" | "reopen" | "not-booking" | "convert";

/** One of the status actions; convert also sends the form link. */
export function useEnquiryAction(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: EnquiryAction) => api.post<Enquiry | { enquiry: Enquiry; form_link: string }>(`/enquiries/${id}/${action}`, {}),
    meta: { silent: true },
    onSuccess: () => invalidateAfterWrite(qc),
  });
}

export function useCreateRequest(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingInput) => api.post<{ enquiry: Enquiry; booking_id: number }>(`/enquiries/${id}/create-request`, input),
    meta: { silent: true },
    onSuccess: () => invalidateAfterWrite(qc),
  });
}

export function useAttachEnquiry(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: number) => api.post<{ enquiry: Enquiry; booking_id: number }>(`/enquiries/${id}/attach`, { booking_id: bookingId }),
    meta: { silent: true },
    onSuccess: () => invalidateAfterWrite(qc),
  });
}

/** The booking an enquiry became or was attached to, for the record's link. */
export function useEnquiryBooking(bookingId: number | null) {
  return useQuery({
    queryKey: ["bookings", bookingId ?? -1],
    queryFn: () => api.get<BookingDetail>(`/bookings/${bookingId}`),
    enabled: bookingId !== null,
  });
}
