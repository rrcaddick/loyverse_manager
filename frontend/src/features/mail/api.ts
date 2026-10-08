/**
 * Mail v2 queries and actions (web/api/inbox.py, docs/handoff/mail-v2.md).
 *
 * Keys live under ["mail", …] so the sidebar badge (["mail","counts"]) and
 * every list refresh together:
 *   ["mail", "conversations", params]      GET /inbox/conversations
 *   ["mail", "conversation", thrid]        GET /inbox/conversations/:thrid
 *   ["mail", "booking-conversation", id]   GET /bookings/:id/conversation
 *   ["mail", "suggestions", thrid]         GET /inbox/conversations/:thrid/suggestions
 *   ["mail", "templates"]                  GET /inbox/templates
 *   ["mail", "original", messageId]        GET /inbox/messages/:id/original
 * Every action invalidates ["mail"], ["inbox"] (first build), ["work"],
 * ["queue"], ["bookings"] and ["today"].
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { BookingDetail } from "@/features/bookings/types";
import { api } from "@/lib/api";

import type {
  BookingConversationResponse,
  ConversationListParams,
  ConversationResponse,
  ConversationsResponse,
  MailTemplate,
  NoteItem,
  OriginalMessage,
  ThreadActionResponse,
  ThreadReplyInput,
  ThreadReplyResponse,
  ThreadSuggestion,
} from "./types";

export const mailKeys = {
  all: ["mail"] as const,
  conversations: (p: ConversationListParams) => ["mail", "conversations", p.view, p.chip, p.q, p.page, p.page_size ?? 25] as const,
  conversation: (thrid: string) => ["mail", "conversation", thrid] as const,
  bookingConversation: (id: number) => ["mail", "booking-conversation", id] as const,
  suggestions: (thrid: string) => ["mail", "suggestions", thrid] as const,
  templates: ["mail", "templates"] as const,
  original: (id: number) => ["mail", "original", id] as const,
};

/** Everything a mail action can change: queues, badges, work, bookings, today. */
export function invalidateMailWorld(qc: QueryClient): void {
  for (const key of [["mail"], ["inbox"], ["work"], ["queue"], ["bookings"], ["today"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

// ----------------------------------------------------------------- queries

export function useConversations(params: ConversationListParams, enabled = true) {
  return useQuery({
    queryKey: mailKeys.conversations(params),
    queryFn: () =>
      api.get<ConversationsResponse>("/inbox/conversations", {
        params: {
          view: params.view,
          chip: params.view === "all" ? params.chip ?? undefined : undefined,
          q: params.q.trim() || undefined,
          page: params.page,
          page_size: params.page_size ?? 25,
        },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    enabled,
  });
}

export function useConversation(thrid: string | null) {
  return useQuery({
    queryKey: mailKeys.conversation(thrid ?? ""),
    queryFn: () => api.get<ConversationResponse>(`/inbox/conversations/${thrid}`),
    enabled: !!thrid,
    refetchInterval: 60_000,
  });
}

export function useBookingConversation(bookingId: number | null) {
  return useQuery({
    queryKey: mailKeys.bookingConversation(bookingId ?? -1),
    queryFn: () => api.get<BookingConversationResponse>(`/bookings/${bookingId}/conversation`),
    enabled: bookingId !== null && Number.isFinite(bookingId),
    refetchInterval: 60_000,
  });
}

export function useThreadSuggestions(thrid: string | null, enabled = true) {
  return useQuery({
    queryKey: mailKeys.suggestions(thrid ?? ""),
    queryFn: () => api.get<{ items: ThreadSuggestion[] }>(`/inbox/conversations/${thrid}/suggestions`).then((r) => r.items),
    enabled: enabled && !!thrid,
  });
}

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: mailKeys.templates,
    queryFn: () => api.get<{ items: MailTemplate[] }>("/inbox/templates").then((r) => r.items),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useOriginalMessage(messageId: number | null) {
  return useQuery({
    queryKey: mailKeys.original(messageId ?? 0),
    queryFn: () => api.get<OriginalMessage>(`/inbox/messages/${messageId}/original`),
    enabled: messageId !== null,
    staleTime: 10 * 60_000,
  });
}

/** The booking behind a conversation, for the context panel (shares ["bookings", id] with the record page). */
export function useBookingContext(id: number | null) {
  return useQuery({
    queryKey: ["bookings", id ?? -1],
    queryFn: () => api.get<BookingDetail>(`/bookings/${id}`),
    enabled: id !== null && Number.isFinite(id),
  });
}

// --------------------------------------------------------------- mutations

function useThreadAction(path: string, meta?: { successMessage?: string; silent?: boolean }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ thrid, body }: { thrid: string; body?: Record<string, unknown> }) =>
      api.post<ThreadActionResponse>(`/inbox/conversations/${thrid}/${path}`, body ?? {}),
    meta,
    onSuccess: (result, { thrid }) => {
      qc.setQueryData(mailKeys.conversation(thrid), (current: ConversationResponse | undefined) =>
        current ? { ...current, thread: result.thread, booking: result.thread.booking } : current,
      );
      invalidateMailWorld(qc);
    },
  });
}

export const useMarkDone = () => useThreadAction("done");
export const useReopen = () => useThreadAction("reopen");
export const useNotBooking = () => useThreadAction("not-booking");
export const useAttachThread = () => useThreadAction("attach");
export const useDetachThread = () => useThreadAction("detach", { successMessage: "Detached from the booking" });

export function useAddThreadNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ thrid, body }: { thrid: string; body: string }) => api.post<{ item: NoteItem }>(`/inbox/conversations/${thrid}/notes`, { body }),
    onSuccess: (result, { thrid }) => {
      qc.setQueryData(mailKeys.conversation(thrid), (current: ConversationResponse | undefined) =>
        current ? { ...current, items: [...current.items, result.item] } : current,
      );
      invalidateMailWorld(qc);
    },
  });
}

export function useReplyToThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ thrid, ...input }: { thrid: string } & ThreadReplyInput) =>
      api.post<ThreadReplyResponse>(`/inbox/conversations/${thrid}/reply`, input),
    meta: { silent: true },
    onSuccess: (result, { thrid }) => {
      qc.setQueryData(mailKeys.conversation(thrid), (current: ConversationResponse | undefined) =>
        current ? { ...current, thread: result.thread, items: [...current.items.filter((i) => i.key !== result.item.key), result.item] } : current,
      );
      invalidateMailWorld(qc);
    },
    onError: () => invalidateMailWorld(qc),
  });
}

/** Reply on a booking with no thread yet: POST /bookings/:id/emails/reply (starts a new thread). */
export function useReplyOnBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, ...input }: { bookingId: number; body_html: string; subject?: string; attach_document_ids?: number[] }) =>
      api.post<BookingDetail>(`/bookings/${bookingId}/emails/reply`, input),
    meta: { silent: true },
    onSuccess: (detail) => {
      qc.setQueryData(["bookings", detail.id], detail);
      invalidateMailWorld(qc);
    },
    onError: () => invalidateMailWorld(qc),
  });
}

/** Legacy per-message bounce-back (the public form link) — POST /inbox/messages/:id/bounce-back. */
export function useBounceBack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) => api.post<{ sent: unknown; message: unknown }>(`/inbox/messages/${messageId}/bounce-back`),
    meta: { successMessage: "Form link sent" },
    onSuccess: () => invalidateMailWorld(qc),
  });
}

export function useSyncMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; inserted?: number; errors?: string[] }>("/inbox/sync"),
    onSuccess: () => invalidateMailWorld(qc),
  });
}
