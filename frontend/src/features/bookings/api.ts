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
  BookingCounts,
  BookingDetail,
  BookingInput,
  BookingListItem,
  BookingListParams,
  BookingContact,
  DocumentKind,
  InboxMessage,
  PaymentSearchParams,
  PaymentSearchResult,
  RecordPaymentInput,
  ReplyInput,
} from "./types";

export const bookingKeys = {
  all: ["bookings"] as const,
  list: (params: BookingListParams) => ["bookings", "list", params] as const,
  counts: ["bookings", "counts"] as const,
  detail: (id: number) => ["bookings", id] as const,
  conversation: (id: number) => ["bookings", id, "conversation"] as const,
  message: (id: number) => ["inbox", "message", id] as const,
};

/**
 * Everything a booking change can affect: the bookings lists and counts, the
 * calendar and day views, Work and Today (and the nav badges they feed), the
 * legacy queue and, when a detail came back, its conversation.
 */
export function invalidateBookingWorld(qc: QueryClient, detail?: BookingDetail) {
  if (detail) qc.setQueryData(bookingKeys.detail(detail.id), detail);
  void qc.invalidateQueries({ queryKey: ["bookings", "list"] });
  void qc.invalidateQueries({ queryKey: bookingKeys.counts });
  void qc.invalidateQueries({ queryKey: ["calendar"] });
  void qc.invalidateQueries({ queryKey: ["day"] });
  void qc.invalidateQueries({ queryKey: ["work"] });
  void qc.invalidateQueries({ queryKey: ["today"] });
  void qc.invalidateQueries({ queryKey: ["queue"] });
  if (detail) {
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    void qc.invalidateQueries({ queryKey: ["mail"] });
    void qc.invalidateQueries({ queryKey: bookingKeys.conversation(detail.id) });
  }
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

/** Per-status counts plus the tab buckets (pending, confirmed, lapsed, past, all). */
export function useBookingCounts() {
  return useQuery({
    queryKey: bookingKeys.counts,
    queryFn: () => api.get<BookingCounts>("/bookings/counts"),
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

// ------------------------------------------------------- requests, contacts

/** Accept a request: it becomes an enquiry on the calendar and, unless told otherwise, the proforma goes out. */
export function useAcceptRequest(id: number) {
  return useDetailMutation<{ send_proforma?: boolean }>(id, (input) => api.post<BookingDetail>(`/bookings/${id}/accept`, input), { silent: true });
}

export function useDeclineRequest(id: number) {
  return useDetailMutation<{ reason?: string }>(id, (input) => api.post<BookingDetail>(`/bookings/${id}/decline`, input), { successMessage: "Request declined" });
}

/** The contact endpoints answer with the list; the detail is refetched for its counts. */
function useContactsMutation<TVariables, TResult extends { items: BookingContact[] } = { items: BookingContact[] }>(id: number, mutationFn: (variables: TVariables) => Promise<TResult>, meta?: { silent?: boolean; successMessage?: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    meta,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bookingKeys.detail(id) });
    },
  });
}

export function useAddContact(id: number) {
  return useContactsMutation<{ email: string; name?: string; mobile?: string }>(id, (input) => api.post<{ items: BookingContact[] }>(`/bookings/${id}/contacts`, input), { successMessage: "Contact added" });
}

export interface ContactUpdate {
  contactId: number;
  name?: string;
  mobile?: string;
  email?: string;
  role?: "primary" | "cc";
  on_site?: boolean;
}

/**
 * Optimistic: the detail's contact row changes first (a tick shows at once),
 * springs back on failure; the server's list replaces it on success. A new
 * number on a primary contact gets the ticket again; the result rides along
 * as `whatsapp`.
 */
export function useUpdateContact(id: number) {
  const qc = useQueryClient();
  const key = bookingKeys.detail(id);
  return useMutation({
    mutationFn: ({ contactId, ...input }: ContactUpdate) => api.patch<{ items: BookingContact[]; whatsapp?: { success?: boolean; error?: string; to?: string } | null }>(`/bookings/${id}/contacts/${contactId}`, input),
    meta: { silent: true },
    onMutate: async ({ contactId, role, on_site, name, mobile, email }) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<BookingDetail>(key);
      if (before) {
        const contacts = before.contacts.map((c) => {
          if (c.id !== contactId) return on_site === true ? { ...c, on_site: 0 } : c;
          return { ...c, ...(role ? { role } : {}), ...(on_site !== undefined ? { on_site: on_site ? 1 : 0 } : {}), ...(name !== undefined ? { name } : {}), ...(mobile !== undefined ? { mobile } : {}), ...(email !== undefined ? { email } : {}) };
        });
        qc.setQueryData<BookingDetail>(key, { ...before, contacts });
      }
      return { before };
    },
    onError: (_err, _vars, context) => {
      if (context?.before) qc.setQueryData(key, context.before);
    },
    onSuccess: (result) => {
      const current = qc.getQueryData<BookingDetail>(key);
      if (current) qc.setQueryData<BookingDetail>(key, { ...current, contacts: result.items });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useDeleteContact(id: number) {
  return useContactsMutation<number>(id, (contactId) => api.delete<{ items: BookingContact[] }>(`/bookings/${id}/contacts/${contactId}`), { successMessage: "Contact removed" });
}

// ----------------------------------------------------- payments: find, pops

export function usePaymentSearch(id: number, params: PaymentSearchParams, enabled: boolean) {
  return useQuery({
    queryKey: ["bookings", id, "payment-search", params] as const,
    queryFn: () => api.get<PaymentSearchResult>(`/bookings/${id}/payment-search`, { params: { ...params } }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** Record the bank credit as this booking's payment. */
export function useAllocateCredit(id: number) {
  return useDetailMutation<{ tx_id: number }>(id, (input) => api.post<BookingDetail>(`/bookings/${id}/payment-search/allocate`, input), { silent: true });
}

export function usePopAllocate(id: number) {
  return useDetailMutation<{ popId: number; tx_id: number }>(id, ({ popId, tx_id }) => api.post<BookingDetail>(`/bookings/${id}/pops/${popId}/allocate`, { tx_id }), { silent: true });
}

export function usePopDismiss(id: number) {
  return useDetailMutation<number>(id, (popId) => api.post<BookingDetail>(`/bookings/${id}/pops/${popId}/dismiss`, {}), { successMessage: "Proof of payment dismissed" });
}

/** Release a bank credit from this booking: the payment goes, the credit is unallocated again. */
export function useReleasePayment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tx_id: number) => api.post(`/payments/bank-transactions/${tx_id}/unmatch`, {}),
    meta: { silent: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bookingKeys.detail(id) });
      invalidateBookingWorld(qc);
    },
  });
}

/** Release here, then record on the booking it belongs to. */
export function useMovePayment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tx_id, to_booking_id }: { tx_id: number; to_booking_id: number }) => {
      await api.post(`/payments/bank-transactions/${tx_id}/unmatch`, {});
      return api.post<BookingDetail>(`/bookings/${to_booking_id}/payment-search/allocate`, { tx_id });
    },
    meta: { silent: true },
    onSuccess: (detail) => {
      void qc.invalidateQueries({ queryKey: bookingKeys.detail(id) });
      invalidateBookingWorld(qc, detail);
    },
  });
}

/** The vehicle ticket PDF (legacy route, session-protected). */
export function ticketPdfUrl(barcode: string, download = false): string {
  return `/group-bookings/${download ? "download" : "ticket"}/${encodeURIComponent(barcode)}`;
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
