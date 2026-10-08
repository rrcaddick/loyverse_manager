/**
 * Inbox queries and actions (web/api/inbox.py).
 *
 * Keys follow the shell convention: ["inbox", view, page, q, bookingId],
 * ["inbox", "message", id], ["inbox", "thread", thrid],
 * ["inbox", "suggestions", id]. Actions invalidate ["inbox"] as a whole plus
 * ["queue"] and ["bookings"] (attaching writes a booking event).
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { BookingDetail } from "@/features/queue/bookings";

import type { BookingSuggestion, ExtractedFields, FullMessage, InboxListParams, InboxListResponse, SyncSummary, ThreadResponse } from "./types";

export const inboxKeys = {
  all: ["inbox"] as const,
  list: (p: InboxListParams) => ["inbox", p.view, p.page, p.q, p.booking_id] as const,
  message: (id: number) => ["inbox", "message", id] as const,
  thread: (thrid: string) => ["inbox", "thread", thrid] as const,
  suggestions: (id: number) => ["inbox", "suggestions", id] as const,
};

export function useInboxList(params: InboxListParams) {
  return useQuery({
    queryKey: inboxKeys.list(params),
    queryFn: () =>
      api.get<InboxListResponse>("/inbox/messages", {
        params: {
          view: params.view,
          page: params.page,
          page_size: params.page_size ?? 25,
          q: params.q.trim() || undefined,
          booking_id: params.booking_id ?? undefined,
        },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 120_000,
  });
}

export function useMessage(id: number | null) {
  return useQuery({
    queryKey: inboxKeys.message(id ?? 0),
    queryFn: () => api.get<FullMessage>(`/inbox/messages/${id}`),
    enabled: id !== null,
  });
}

export function useThread(thrid: string | null) {
  return useQuery({
    queryKey: inboxKeys.thread(thrid ?? ""),
    queryFn: () => api.get<ThreadResponse>(`/inbox/threads/${thrid}`),
    enabled: !!thrid,
  });
}

export function useSuggestions(id: number | null, enabled = true) {
  return useQuery({
    queryKey: inboxKeys.suggestions(id ?? 0),
    queryFn: () => api.get<{ items: BookingSuggestion[] }>(`/inbox/messages/${id}/suggestions`).then((r) => r.items),
    enabled: enabled && id !== null,
  });
}

function useSettleInbox() {
  const qc = useQueryClient();
  return (message?: FullMessage) => {
    if (message) qc.setQueryData(inboxKeys.message(message.id), (current: FullMessage | undefined) => (current ? { ...current, ...message } : message));
    void qc.invalidateQueries({ queryKey: inboxKeys.all });
    void qc.invalidateQueries({ queryKey: ["queue"] });
    void qc.invalidateQueries({ queryKey: ["bookings"] });
  };
}

export function useAttachMessage() {
  const settle = useSettleInbox();
  return useMutation({
    mutationFn: ({ id, booking_id, whole_thread }: { id: number; booking_id: number; whole_thread: boolean }) =>
      api.post<{ linked_ids: number[]; message: FullMessage }>(`/inbox/messages/${id}/attach`, { booking_id, whole_thread }),
    onSuccess: (result) => settle(result.message),
  });
}

export function useDetachMessage() {
  const settle = useSettleInbox();
  return useMutation({
    mutationFn: (id: number) => api.post<{ message: FullMessage }>(`/inbox/messages/${id}/detach`),
    meta: { successMessage: "Detached from the booking" },
    onSuccess: (result) => settle(result.message),
  });
}

export function useResolveMessage() {
  const settle = useSettleInbox();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: "resolved" | "not_booking" | "pending" }) =>
      api.post<{ message: FullMessage; counts: { review: number; unmatched: number } }>(`/inbox/messages/${id}/resolve`, { status }),
    onSuccess: (result) => settle(result.message),
  });
}

export function useExtractMessage() {
  return useMutation({
    mutationFn: (id: number) => api.post<{ fields: ExtractedFields; message_id: number }>(`/inbox/messages/${id}/extract`),
    meta: { silent: true },
  });
}

export function useBounceBack() {
  const settle = useSettleInbox();
  return useMutation({
    mutationFn: (id: number) => api.post<{ sent: FullMessage; message: FullMessage }>(`/inbox/messages/${id}/bounce-back`),
    meta: { successMessage: "Form link sent" },
    onSuccess: (result) => settle(result.message),
  });
}

export function useSyncInbox() {
  const settle = useSettleInbox();
  return useMutation({
    mutationFn: () => api.post<SyncSummary>("/inbox/sync"),
    onSuccess: () => settle(),
  });
}

export interface ComposeInput {
  to: string[];
  cc?: string[];
  subject: string;
  body_html: string;
  booking_id?: number | null;
}

export function useCompose() {
  const settle = useSettleInbox();
  return useMutation({
    mutationFn: (input: ComposeInput) => api.post<{ message: FullMessage }>("/inbox/compose", input),
    meta: { silent: true },
    onSuccess: () => settle(),
  });
}

export interface ReplyInput {
  booking_id: number;
  subject?: string;
  body_html: string;
  attach_document_ids?: number[];
}

/** Reply on a booking's thread: POST /bookings/:id/emails/reply. */
export function useReplyOnBooking() {
  const settle = useSettleInbox();
  return useMutation({
    mutationFn: ({ booking_id, ...body }: ReplyInput) => api.post<BookingDetail>(`/bookings/${booking_id}/emails/reply`, body),
    meta: { silent: true },
    onSuccess: () => settle(),
  });
}

/** Escape text and turn blank-line separated paragraphs into simple HTML. */
export function paragraphsToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** "Re: subject" unless it already starts with Re:/RE:/Fwd handled as-is. */
export function replySubject(subject: string | null | undefined): string {
  const base = (subject ?? "").trim();
  if (!base) return "Re: your enquiry";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

/** "1.2 MB" / "640 KB" / "12 B" */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
