/**
 * ConversationView — the stream of one conversation plus the docked
 * composer. Shared by Mail (`partyKey` or `thrid`) and the booking record's
 * Conversation tab (`bookingId`); give exactly one.
 *
 *   <ConversationView partyKey="b:124" markDone="default" />    // Needs reply (v3)
 *   <ConversationView thrid="1878302343153220866" markDone="default" />
 *   <ConversationView bookingId={124} />
 *
 * - `partyKey` (v3): GET /inbox/parties/:key — every thread of the PERSON
 *   merged in time order; replies go to POST /inbox/parties/:key/reply and
 *   land on the newest thread unless "Reply in:" picks another. One reply
 *   covers everything they are waiting on.
 * - `thrid`: GET /inbox/conversations/:thrid; replies go to
 *   POST /inbox/conversations/:thrid/reply (with "Send and mark done").
 * - `bookingId`: GET /bookings/:id/conversation (the party stream for
 *   `b:<id>`); replies go to the chosen thread (newest by default), else
 *   POST /bookings/:id/emails/reply when the booking has no mail yet.
 *
 * Each inbound message the person is still waiting on carries an amber
 * "Unanswered" mark; after a reply or Done the marks clear at once. In
 * booking mode a thin amber strip reads "2 messages waiting · Mark handled".
 *
 * Newest at the bottom and open; older messages collapsed to one line;
 * notes and events inline. Keys while mounted (unless `shortcuts={false}`):
 * R reply, N note, ; expand or collapse everything. The composer is
 * controlled here so those keys work from anywhere in the pane. An optional
 * `bridge` (see composer-bridge.ts) lets a sibling panel open the composer
 * or attach a document.
 */

import { useQueryClient } from "@tanstack/react-query";
import { Check, Inbox } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useShortcut } from "@/hooks/use-keyboard";
import { errorMessage, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import {
  clearUnanswered,
  mailKeys,
  useAddThreadNote,
  useBookingContext,
  useBookingConversation,
  useConversation,
  useParty,
  usePartyDone,
  usePartyReply,
  useReplyOnBooking,
  useReplyToThread,
} from "./api";
import { Composer, type ComposerSend, type ReplyThreadOption } from "./composer";
import type { ComposerBridge } from "./composer-bridge";
import { newestMessageIndex, newestThread, readDraft, replySubjectFor, titleCase, type ComposerMode } from "./lib";
import { EventLine, MessageCard, NoteCard, PendingCard } from "./message-card";
import { OriginalDialog } from "./original-dialog";
import { isMessage, type MessageItem, type StreamItem, type Thread } from "./types";

export interface ConversationViewProps {
  bookingId?: number;
  thrid?: string;
  /** v3: `b:<booking_id>` or `e:<address>` — preferred for Needs reply. */
  partyKey?: string;
  /** "default" makes "Send and mark done" the primary verb (Needs reply). */
  markDone?: "offer" | "default" | "none";
  /** Register R / N / ; while mounted. Default true. */
  shortcuts?: boolean;
  /** Lets a sibling (the context panel) open the composer or attach a document. */
  bridge?: ComposerBridge;
  /** Show "N messages waiting · Mark handled" above the stream. Default: booking mode only. */
  waitingStrip?: boolean;
  className?: string;
}

interface PendingSend {
  to: string[];
  subject: string;
  html: string;
  state: "sending" | "failed";
  error?: string;
  input: ComposerSend;
}

export function ConversationView(props: ConversationViewProps) {
  // Re-mount per conversation so composer state and drafts never bleed across.
  const scope = props.partyKey ? `party:${props.partyKey}` : props.thrid ? `thread:${props.thrid}` : `booking:${props.bookingId ?? "none"}`;
  return <ConversationInner key={scope} scope={scope} {...props} />;
}

function ConversationInner({ bookingId, thrid, partyKey, markDone, shortcuts = true, bridge, waitingStrip, className, scope }: ConversationViewProps & { scope: string }) {
  const qc = useQueryClient();
  const mode: "party" | "thread" | "booking" = partyKey ? "party" : thrid ? "thread" : "booking";
  const byParty = useParty(mode === "party" ? partyKey ?? null : null);
  const byThread = useConversation(mode === "thread" ? thrid ?? null : null);
  const byBooking = useBookingConversation(mode === "booking" ? bookingId ?? null : null);
  const query = mode === "party" ? byParty : mode === "thread" ? byThread : byBooking;

  // ---- what we know about the conversation, whichever way it was loaded
  const items: StreamItem[] = useMemo(() => query.data?.items ?? [], [query.data]);
  const threads: Thread[] = useMemo(() => {
    if (mode === "party") return byParty.data?.threads ?? [];
    if (mode === "booking") return byBooking.data?.threads ?? [];
    return byThread.data?.thread ? [byThread.data.thread] : [];
  }, [mode, byParty.data, byBooking.data, byThread.data]);
  const unansweredCount = mode === "party" ? byParty.data?.unanswered_count ?? 0 : mode === "booking" ? byBooking.data?.unanswered_count ?? 0 : (byThread.data?.thread.unanswered_count ?? 0);

  // Newest thread first: the default reply target.
  const orderedThreads = useMemo(() => {
    const newest = newestThread(threads);
    if (!newest) return [] as Thread[];
    return [newest, ...threads.filter((t) => t.thrid !== newest.thrid)];
  }, [threads]);
  const [chosenThrid, setChosenThrid] = useState<string | null>(null);
  const thread: Thread | null = useMemo(() => {
    if (mode === "thread") return byThread.data?.thread ?? null;
    const chosen = chosenThrid ? orderedThreads.find((t) => t.thrid === chosenThrid) : undefined;
    if (chosen) return chosen;
    if (mode === "booking") {
      const data = byBooking.data;
      const primary = data?.booking.email_thread_id ? orderedThreads.find((t) => t.thrid === data.booking.email_thread_id) : undefined;
      // The booking's own primary thread wins only while nothing newer exists on it.
      if (primary && primary.thrid === orderedThreads[0]?.thrid) return primary;
    }
    return orderedThreads[0] ?? null;
  }, [mode, byThread.data, byBooking.data, orderedThreads, chosenThrid]);

  const bookingRef = mode === "party" ? byParty.data?.booking ?? null : mode === "thread" ? byThread.data?.booking ?? null : byBooking.data?.booking ?? null;
  const resolvedBookingId = bookingId ?? bookingRef?.id ?? null;
  const bookingDetail = useBookingContext(resolvedBookingId);

  const latestInbound = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item && item.type === "inbound" && !item.is_auto_generated && item.from_email) return item;
    }
    return null;
  }, [items]);

  const partyEmail = mode === "party" ? byParty.data?.counterpart_email ?? null : null;
  const counterpartEmail = latestInbound?.from_email ?? partyEmail ?? thread?.counterpart_email ?? byBooking.data?.booking.contact_email ?? bookingDetail.data?.contact_email ?? null;
  const counterpartName =
    titleCase(latestInbound?.from_name) ||
    titleCase(mode === "party" ? byParty.data?.counterpart_name : null) ||
    titleCase(thread?.counterpart_name) ||
    bookingRef?.contact_name ||
    bookingDetail.data?.contact_name ||
    counterpartEmail ||
    "customer";
  // The subject follows the thread the reply lands in; the latest inbound of a single thread wins.
  const latestSubject = thread ? (orderedThreads.length > 1 ? thread.subject : latestInbound?.subject ?? thread.subject) : bookingRef ? `${bookingRef.reference} ${bookingRef.group_name}` : null;
  const defaultSubject = replySubjectFor(latestSubject);
  const replyThrid = thread?.thrid ?? null;
  const canReply = Boolean(counterpartEmail);
  const replyThreads: ReplyThreadOption[] = useMemo(() => orderedThreads.map((t) => ({ thrid: t.thrid, subject: t.subject, last_message_at: t.last_message_at })), [orderedThreads]);

  // ---- composer (controlled so keys and the bridge work from outside it)
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("reply");
  const [docIds, setDocIds] = useState<number[]>(() => readDraft(scope)?.document_ids ?? []);
  const [prefill, setPrefill] = useState<{ body: string; subject?: string } | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [originalId, setOriginalId] = useState<number | null>(null);

  const replyToThread = useReplyToThread();
  const replyToParty = usePartyReply();
  const replyOnBooking = useReplyOnBooking();
  const partyDone = usePartyDone();
  const addNote = useAddThreadNote();

  function openComposer(mode: ComposerMode) {
    if (mode === "reply" && !canReply) return;
    setComposerMode(mode);
    setComposerOpen(true);
  }

  useShortcut("r", () => openComposer("reply"), { enabled: shortcuts && canReply });
  useShortcut("n", () => openComposer("note"), { enabled: shortcuts && !!replyThrid });

  useEffect(() => {
    if (!bridge) return;
    bridge.register({
      open: (mode) => {
        setComposerMode(mode);
        setComposerOpen(true);
      },
      attachDocument: (id) => {
        setDocIds((current) => (current.includes(id) ? current : [...current, id]));
        setComposerMode("reply");
        setComposerOpen(true);
      },
    });
    return () => bridge.register(null);
  }, [bridge]);

  // ---- open / collapsed messages
  const [expandAll, setExpandAll] = useState(false);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const newestIndex = newestMessageIndex(items);
  useShortcut(";", () => setExpandAll((v) => !v), { enabled: shortcuts });

  function isOpen(item: MessageItem, index: number): boolean {
    if (expandAll) return toggled[item.key] ?? true;
    // Unanswered messages stay open: they are what needs reading.
    return toggled[item.key] ?? (index === newestIndex || Boolean(item.unanswered));
  }

  // ---- keep the newest in view
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastKey = items[items.length - 1]?.key ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastKey, pending?.state, query.isSuccess]);

  /** Clear every mark in this view's own cache entry (the refetch confirms). */
  function settleMarks() {
    const key = mode === "party" ? mailKeys.party(partyKey ?? "") : mode === "thread" ? mailKeys.conversation(thrid ?? "") : mailKeys.bookingConversation(bookingId ?? -1);
    qc.setQueryData(key, (current: { items: StreamItem[]; unanswered_count?: number } | undefined) =>
      current ? { ...current, unanswered_count: 0, items: clearUnanswered(current.items) } : current,
    );
  }

  // ---- send / note
  async function send(input: ComposerSend) {
    setPending({ to: input.to, subject: input.subject, html: input.body_html, state: "sending", input });
    const body = {
      body_html: input.body_html,
      body_text: input.body_text,
      subject: input.subject !== defaultSubject ? input.subject : undefined,
      cc: input.cc,
      attach_document_ids: input.attach_document_ids,
      mark_done: input.mark_done,
    };
    try {
      if (mode === "party" && partyKey) {
        await replyToParty.mutateAsync({ partyKey, thrid: replyThrid ?? undefined, ...body });
      } else if (replyThrid) {
        await replyToThread.mutateAsync({ thrid: replyThrid, ...body });
      } else if (bookingId !== undefined) {
        await replyOnBooking.mutateAsync({ bookingId, body_html: input.body_html, subject: input.subject, attach_document_ids: input.attach_document_ids });
      } else {
        throw new Error("Nowhere to send this reply");
      }
      settleMarks();
      setPending(null);
      setPrefill(null);
      setDocIds([]);
    } catch (err) {
      // A 502 means the server stored a failed row: the stream shows it with Retry.
      if (isApiError(err) && err.status === 502) {
        setPending(null);
      } else {
        setPending((current) => (current ? { ...current, state: "failed", error: errorMessage(err, "Could not send") } : current));
      }
      throw err;
    }
  }

  async function note(body: string) {
    if (!replyThrid) throw new Error("This booking has no conversation yet — add the note on the booking record");
    await addNote.mutateAsync({ thrid: replyThrid, body });
  }

  async function markHandled() {
    const key = partyKey ?? (bookingId !== undefined ? `b:${bookingId}` : null);
    if (!key) return;
    await partyDone.mutateAsync({ partyKey: key });
    settleMarks();
  }

  function reopenWith(body: string, subject?: string, documentIds: number[] = []) {
    setPrefill({ body, subject });
    setDocIds(documentIds);
    setComposerKey((k) => k + 1);
    setComposerMode("reply");
    setComposerOpen(true);
  }

  function retryPending() {
    if (!pending) return;
    const input = pending.input;
    setPending(null);
    reopenWith(input.body_text, input.subject, input.attach_document_ids);
  }

  // ---- render
  const empty = query.isSuccess && items.length === 0 && !pending;
  const showStrip = (waitingStrip ?? mode === "booking") && unansweredCount > 0;
  const composerMarkDone = mode === "party" ? markDone ?? "offer" : replyThrid ? markDone ?? "offer" : "none";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      {showStrip ? (
        <div className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-amber-soft px-3 text-sm text-amber-text" role="status" data-testid="waiting-strip">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-amber-solid" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {unansweredCount === 1 ? "1 message waiting on you" : `${unansweredCount} messages waiting on you`}
          </span>
          <Button size="sm" variant="outline" onClick={() => void markHandled()} disabled={partyDone.isPending}>
            <Check data-icon="inline-start" />
            Mark handled
          </Button>
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth pr-1 scrollbar-thin" role="log" aria-label="Conversation" aria-busy={query.isPending}>
        {query.isPending ? (
          <div className="flex flex-col gap-3 py-2" aria-hidden="true">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="ml-11 h-20 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-start gap-3 py-6">
            <p role="alert" className="text-body text-red-text">
              {errorMessage(query.error)}
            </p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : empty ? (
          <EmptyState
            icon={Inbox}
            title="No messages yet"
            hint={bookingId ? "Send the proforma from the booking, or write the first reply below." : "Nothing has been exchanged on this conversation."}
          />
        ) : (
          <ol className="flex flex-col gap-2 py-1">
            {items.length > 1 && newestIndex > 0 ? (
              <li className="flex justify-end px-1">
                <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setExpandAll((v) => !v)}>
                  {expandAll ? "Collapse older messages" : "Expand all"} <span className="ml-1 font-mono text-xs">;</span>
                </Button>
              </li>
            ) : null}
            {items.map((item, index) => (
              <li key={item.key}>
                {isMessage(item) ? (
                  <MessageCard
                    id={index === newestIndex ? "newest-message" : undefined}
                    message={item}
                    open={isOpen(item, index)}
                    onToggle={() => setToggled((t) => ({ ...t, [item.key]: !isOpen(item, index) }))}
                    expandAll={expandAll}
                    unanswered={item.type === "inbound" && Boolean(item.unanswered)}
                    onViewOriginal={(m) => setOriginalId(m.id)}
                    onRetry={(m) => reopenWith(m.body_new_text ?? "", m.subject ?? undefined)}
                  />
                ) : item.type === "note" ? (
                  <NoteCard note={item} />
                ) : (
                  <EventLine event={item} />
                )}
              </li>
            ))}
            {pending ? (
              <li>
                <PendingCard to={pending.to} subject={pending.subject} html={pending.html} state={pending.state} error={pending.error} onRetry={retryPending} />
              </li>
            ) : null}
          </ol>
        )}
      </div>

      {query.isSuccess ? (
        <Composer
          key={`${scope}:${composerKey}`}
          scope={scope}
          open={composerOpen}
          onOpenChange={setComposerOpen}
          mode={composerMode}
          onModeChange={setComposerMode}
          counterpartName={counterpartName}
          defaultTo={counterpartEmail ? [counterpartEmail] : []}
          defaultSubject={defaultSubject}
          documents={bookingDetail.data?.documents ?? []}
          documentIds={docIds}
          onDocumentIdsChange={setDocIds}
          replyThreads={replyThreads}
          replyThrid={replyThrid}
          onReplyThridChange={setChosenThrid}
          canReply={canReply}
          markDone={composerMarkDone}
          prefill={prefill}
          onSend={send}
          onNote={note}
        />
      ) : (
        <div className="flex h-12 shrink-0 items-center rounded-xl bg-card px-4 text-body text-muted-foreground ring-1 ring-border" aria-hidden="true">
          Reply…
        </div>
      )}

      <OriginalDialog messageId={originalId} onClose={() => setOriginalId(null)} />
    </div>
  );
}
