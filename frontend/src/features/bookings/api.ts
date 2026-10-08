/**
 * Queries and mutations for bookings (docs/handoff/bookings.md).
 *
 *   const list = useBookings({ status: "active", page: 1 });   // ["bookings", "list", params]
 *   const detail = useBooking(42);                             // ["bookings", 42]
 *   const act = useBookingAction(42); act.mutateAsync({ action: "send-proforma" });
 *
 * Every mutation returns the full detail, which is written straight into
 * ["bookings", id]; the list, calendar, day and queue caches are invalidated.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { API_BASE, ApiError, api, buildQuery } from "@/lib/api";
import { getCsrfToken } from "@/lib/auth-store";
import type { BookingStatus, Paginated } from "@/types/api";

import type {
  ArrivalSource,
  ArrivalsCheck,
  BookingAction,
  BookingDetail,
  BookingInput,
  BookingListItem,
  BookingListParams,
  DocumentKind,
  InboxMessage,
  RecordPaymentInput,
  ReplyInput,
} from "./types";

export const bookingKeys = {
  all: ["bookings"] as const,
  list: (params: BookingListParams) => ["bookings", "list", params] as const,
  counts: ["bookings", "counts"] as const,
  detail: (id: number) => ["bookings", id] as const,
  message: (id: number) => ["inbox", "message", id] as const,
};

/** Everything a booking change can affect. */
export function invalidateBookingWorld(qc: QueryClient, detail?: BookingDetail) {
  if (detail) qc.setQueryData(bookingKeys.detail(detail.id), detail);
  void qc.invalidateQueries({ queryKey: ["bookings", "list"] });
  void qc.invalidateQueries({ queryKey: bookingKeys.counts });
  void qc.invalidateQueries({ queryKey: ["calendar"] });
  void qc.invalidateQueries({ queryKey: ["day"] });
  void qc.invalidateQueries({ queryKey: ["queue"] });
  if (detail) void qc.invalidateQueries({ queryKey: ["inbox"] });
}

// ----------------------------------------------------------------- queries

export function useBookings(params: BookingListParams, enabled = true) {
  return useQuery({
    queryKey: bookingKeys.list(params),
    queryFn: () => api.get<Paginated<BookingListItem>>("/bookings", { params: { ...params } }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useBookingCounts() {
  return useQuery({
    queryKey: bookingKeys.counts,
    queryFn: () => api.get<{ counts: Partial<Record<BookingStatus, number>> }>("/bookings/counts").then((r) => r.counts),
  });
}

export function useBooking(id: number | null) {
  return useQuery({
    queryKey: bookingKeys.detail(id ?? -1),
    queryFn: () => api.get<BookingDetail>(`/bookings/${id}`),
    enabled: id !== null && Number.isFinite(id),
  });
}

/** Full message (body, attachments) for one row of the booking's thread. */
export function useInboxMessage(id: number, enabled: boolean) {
  return useQuery({
    queryKey: bookingKeys.message(id),
    queryFn: () => api.get<InboxMessage>(`/inbox/messages/${id}`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

// --------------------------------------------------------------- mutations

function useDetailMutation<TVariables>(
  _id: number,
  mutationFn: (variables: TVariables) => Promise<BookingDetail>,
  meta?: { silent?: boolean; successMessage?: string },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    meta,
    // The detail response carries its own id; `_id` only documents the call site.
    onSuccess: (detail) => invalidateBookingWorld(qc, detail),
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingInput) => api.post<BookingDetail>("/bookings", { source: "manual", ...input }),
    meta: { silent: true },
    onSuccess: (detail) => invalidateBookingWorld(qc, detail),
  });
}

export function useUpdateBooking(id: number) {
  return useDetailMutation<BookingInput>(id, (input) => api.patch<BookingDetail>(`/bookings/${id}`, input), { silent: true });
}

export function useSetStatus(id: number) {
  return useDetailMutation<{ status: BookingStatus; reason?: string }>(id, (input) =>
    api.post<BookingDetail>(`/bookings/${id}/status`, input),
  );
}

export function useAddNote(id: number) {
  return useDetailMutation<{ text: string }>(id, (input) => api.post<BookingDetail>(`/bookings/${id}/notes`, input), {
    successMessage: "Note added",
  });
}

export function useAddQuestion(id: number) {
  return useDetailMutation<{ question: string }>(id, (input) => api.post<BookingDetail>(`/bookings/${id}/questions`, input), {
    successMessage: "Question added",
  });
}

export function useAnswerQuestion(id: number) {
  return useDetailMutation<{ questionId: number; answer: string }>(
    id,
    ({ questionId, answer }) => api.post<BookingDetail>(`/bookings/${id}/questions/${questionId}`, { answer }),
    { successMessage: "Answer saved" },
  );
}

export function useRecordPayment(id: number) {
  return useDetailMutation<RecordPaymentInput>(id, (input) => api.post<BookingDetail>(`/bookings/${id}/payments`, input), {
    silent: true,
  });
}

export function useDeletePayment(id: number) {
  return useDetailMutation<number>(id, (paymentId) => api.delete<BookingDetail>(`/bookings/${id}/payments/${paymentId}`), {
    successMessage: "Payment removed",
  });
}

export function useRecordArrivals(id: number) {
  return useDetailMutation<{ count: number; source: ArrivalSource }>(id, (input) =>
    api.post<BookingDetail>(`/bookings/${id}/arrivals`, input),
  );
}

/** Asks Loyverse for today's arrivals; records nothing. */
export function useFetchArrivals(id: number) {
  return useMutation({
    mutationFn: () => api.get<ArrivalsCheck>(`/bookings/${id}/arrivals`),
    meta: { silent: true },
  });
}

export interface ActionVariables {
  action: BookingAction;
  body?: Record<string, unknown>;
}

export function useBookingAction(id: number) {
  return useDetailMutation<ActionVariables>(
    id,
    ({ action, body }) => api.post<BookingDetail>(`/bookings/${id}/actions/${action}`, body ?? {}),
    { silent: true },
  );
}

export function useReplyEmail(id: number) {
  return useDetailMutation<ReplyInput>(id, (input) => api.post<BookingDetail>(`/bookings/${id}/emails/reply`, input), {
    silent: true,
  });
}

// --------------------------------------------------------------- documents

export function documentPdfUrl(documentId: number, download = false): string {
  return `${API_BASE}/documents/${documentId}/pdf${buildQuery(download ? { download: 1 } : undefined)}`;
}

/** POST /bookings/:id/documents/preview → PDF bytes (nothing is stored). */
export async function fetchDocumentPreview(bookingId: number, kind: DocumentKind): Promise<Blob> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/pdf" };
  const token = getCsrfToken();
  if (token) headers["X-CSRF-Token"] = token;
  const response = await fetch(`${API_BASE}/bookings/${bookingId}/documents/preview`, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify({ kind }),
  });
  if (!response.ok) {
    let message = `Preview failed (${response.status})`;
    let code = "http_error";
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      message = body.error?.message ?? message;
      code = body.error?.code ?? code;
    } catch {
      // not JSON
    }
    throw new ApiError(response.status, code, message);
  }
  return response.blob();
}

/**
 * Open a PDF blob in a new tab. The tab is opened synchronously (inside the
 * click) so popup blockers allow it, then pointed at the blob once it arrives.
 */
export function openBlobInNewTab(work: () => Promise<Blob>): Promise<void> {
  const tab = window.open("", "_blank");
  if (tab) tab.document.title = "Preparing preview…";
  return work().then(
    (blob) => {
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    (error: unknown) => {
      tab?.close();
      throw error;
    },
  );
}
