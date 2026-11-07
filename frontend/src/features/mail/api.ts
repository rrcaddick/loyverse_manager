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
 *   ["mail", "party", partyKey]            GET /inbox/parties/:party_key   (v3)
 *   ["mail", "ignored-senders"]            GET /inbox/ignored-senders      (v3)
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
  IgnoredSender,
  MailTemplate,
  NotBookingInput,
  NotBookingResponse,
  NoteItem,
  OriginalMessage,
  PartyActionResponse,
  PartyResponse,
  StreamItem,
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
  party: (partyKey: string) => ["mail", "party", partyKey] as const,
  ignoredSenders: ["mail", "ignored-senders"] as const,
};

/** `b:12` → `b%3A12`: the key travels as one path segment. */
function partyPath(partyKey: string): string {
  return `/inbox/parties/${encodeURIComponent(partyKey)}`;
}

/** Clear every unanswered mark in a stream (after a reply or Done, before the refetch confirms). */
export function clearUnanswered(items: StreamItem[]): StreamItem[] {
  return items.map((item) => ((item.type === "inbound" || item.type === "outbound") && item.unanswered ? { ...item, unanswered: false } : item));
}

/** Write the cleared marks into every cached stream that could show this party. */
function settleParty(qc: QueryClient, partyKey: string | null, bookingId: number | null) {
  if (partyKey) {
    qc.setQueryData(mailKeys.party(partyKey), (current: PartyResponse | undefined) =>
      current ? { ...current, unanswered_count: 0, items: clearUnanswered(current.items) } : current,
    );
  }
  if (bookingId !== null) {
    qc.setQueryData(mailKeys.bookingConversation(bookingId), (current: BookingConversationResponse | undefined) =>
      current ? { ...current, unanswered_count: 0, items: clearUnanswered(current.items) } : current,
    );
  }
}

/** `b:<id>` → the booking id, else null. */
export function bookingIdOfParty(partyKey: string | null | undefined): number | null {
  if (!partyKey || !partyKey.startsWith("b:")) return null;
  const id = Number(partyKey.slice(2));
  return Number.isInteger(id) && id > 0 ? id : null;
}

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

/** v3: one person's conversations merged — GET /inbox/parties/:party_key. */
export function useParty(partyKey: string | null) {
  return useQuery({
    queryKey: mailKeys.party(partyKey ?? ""),
    queryFn: () => api.get<PartyResponse>(partyPath(partyKey ?? "")),
    enabled: !!partyKey,
    refetchInterval: 60_000,
  });
}

export function useIgnoredSenders(enabled = true) {
  return useQuery({
    queryKey: mailKeys.ignoredSenders,
    queryFn: () => api.get<{ items: IgnoredSender[] }>("/inbox/ignored-senders").then((r) => r.items),
    enabled,
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
export const useAttachThread = () => useThreadAction("attach");

/**
 * v3: POST /inbox/conversations/:thrid/not-booking {learn, scope?} marks every
 * thread of the sender not-a-booking + done and, with `learn`, adds the sender
 * to the ignored list; the response carries the rule so the toast can undo it.
 */
export function useNotBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ thrid, body }: { thrid: string; body: NotBookingInput }) => api.post<NotBookingResponse>(`/inbox/conversations/${thrid}/not-booking`, body),
    onSuccess: (result, { thrid }) => {
      if (result.thread) {
        const thread = result.thread;
        qc.setQueryData(mailKeys.conversation(thrid), (current: ConversationResponse | undefined) => (current ? { ...current, thread, booking: thread.booking } : current));
      }
      invalidateMailWorld(qc);
    },
  });
}

function usePartyAction(path: "done" | "reopen") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partyKey }: { partyKey: string }) => api.post<PartyActionResponse>(`${partyPath(partyKey)}/${path}`, {}),
    onSuccess: (_result, { partyKey }) => {
      if (path === "done") settleParty(qc, partyKey, bookingIdOfParty(partyKey));
      invalidateMailWorld(qc);
    },
  });
}

/** v3: POST /inbox/parties/:key/done — every thread of the person is handled. */
export const usePartyDone = () => usePartyAction("done");
export const usePartyReopen = () => usePartyAction("reopen");

/**
 * v3: POST /inbox/parties/:key/reply — one reply covers the whole person; it
 * lands on the newest thread unless `thrid` picks another. The sent item is
 * appended to the party stream (and the booking's, for `b:` keys) and every
 * unanswered mark clears at once.
 */
export function usePartyReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partyKey, ...input }: { partyKey: string } & ThreadReplyInput) => api.post<ThreadReplyResponse>(`${partyPath(partyKey)}/reply`, input),
    meta: { silent: true },
    onSuccess: (result, { partyKey }) => {
      const append = (items: StreamItem[]) => [...clearUnanswered(items).filter((i) => i.key !== result.item.key), result.item];
      qc.setQueryData(mailKeys.party(partyKey), (current: PartyResponse | undefined) =>
        current ? { ...current, unanswered_count: 0, items: append(current.items), threads: current.threads.map((t) => (t.thrid === result.thread?.thrid ? result.thread : t)) } : current,
      );
      const bookingId = bookingIdOfParty(partyKey);
      if (bookingId !== null) {
        qc.setQueryData(mailKeys.bookingConversation(bookingId), (current: BookingConversationResponse | undefined) =>
          current ? { ...current, unanswered_count: 0, items: append(current.items) } : current,
        );
      }
      if (result.thread) {
        qc.setQueryData(mailKeys.conversation(result.thread.thrid), (current: ConversationResponse | undefined) =>
          current ? { ...current, thread: result.thread, items: append(current.items) } : current,
        );
      }
      invalidateMailWorld(qc);
    },
    onError: () => invalidateMailWorld(qc),
  });
}

export function useAddIgnoredSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { pattern: string; reason?: string }) =>
      api.post<{ item?: IgnoredSender; rule?: IgnoredSender } & Partial<IgnoredSender>>("/inbox/ignored-senders", input).then((r) => r.item ?? r.rule ?? (r as IgnoredSender)),
    meta: { silent: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mailKeys.ignoredSenders });
    },
  });
}

export function useDeleteIgnoredSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<unknown>(`/inbox/ignored-senders/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mailKeys.ignoredSenders });
    },
  });
}
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
