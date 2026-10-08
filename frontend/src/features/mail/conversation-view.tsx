/**
 * ConversationView — the stream of one conversation plus the docked
 * composer. Shared by Mail (`thrid`) and the booking record's Conversation
 * tab (`bookingId`); give exactly one.
 *
 *   <ConversationView thrid="1878302343153220866" markDone="default" />
 *   <ConversationView bookingId={124} />
 *
 * - `thrid`: GET /inbox/conversations/:thrid; replies go to
 *   POST /inbox/conversations/:thrid/reply (with "Send and mark done").
 * - `bookingId`: GET /bookings/:id/conversation (every thread on the
 *   booking merged with its events); replies go to the booking's primary
 *   thread when it has one, else POST /bookings/:id/emails/reply.
 *
 * Newest at the bottom and open; older messages collapsed to one line;
 * notes and events inline. Keys while mounted (unless `shortcuts={false}`):
 * R reply, N note, ; expand or collapse everything. The composer is
 * controlled here so those keys work from anywhere in the pane. An optional
 * `bridge` (see composer-bridge.ts) lets a sibling panel open the composer
 * or attach a document.
 */

import { Inbox } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useShortcut } from "@/hooks/use-keyboard";
import { errorMessage, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { useAddThreadNote, useBookingContext, useBookingConversation, useConversation, useReplyOnBooking, useReplyToThread } from "./api";
import { Composer, type ComposerSend } from "./composer";
import type { ComposerBridge } from "./composer-bridge";
import { newestMessageIndex, readDraft, replySubjectFor, titleCase, type ComposerMode } from "./lib";
import { EventLine, MessageCard, NoteCard, PendingCard } from "./message-card";
import { OriginalDialog } from "./original-dialog";
import { isMessage, type MessageItem, type StreamItem, type Thread } from "./types";

export interface ConversationViewProps {
  bookingId?: number;
  thrid?: string;
  /** "default" makes "Send and mark done" the primary verb (Needs reply). Threads only. */
  markDone?: "offer" | "default" | "none";
  /** Register R / N / ; while mounted. Default true. */
  shortcuts?: boolean;
  /** Lets a sibling (the context panel) open the composer or attach a document. */
  bridge?: ComposerBridge;
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
  const scope = props.thrid ? `thread:${props.thrid}` : `booking:${props.bookingId ?? "none"}`;
  return <ConversationInner key={scope} scope={scope} {...props} />;
}

function ConversationInner({ bookingId, thrid, markDone, shortcuts = true, bridge, className, scope }: ConversationViewProps & { scope: string }) {
  const byThread = useConversation(thrid ?? null);
  const byBooking = useBookingConversation(thrid ? null : bookingId ?? null);
  const query = thrid ? byThread : byBooking;

  // ---- what we know about the conversation, whichever way it was loaded
  const items: StreamItem[] = useMemo(() => query.data?.items ?? [], [query.data]);
  const thread: Thread | null = useMemo(() => {
    if (thrid) return byThread.data?.thread ?? null;
    const data = byBooking.data;
    if (!data) return null;
    const primary = data.booking.email_thread_id ? data.threads.find((t) => t.thrid === data.booking.email_thread_id) : undefined;
    return primary ?? data.threads[data.threads.length - 1] ?? null;
  }, [thrid, byThread.data, byBooking.data]);
  const bookingRef = thrid ? byThread.data?.booking ?? null : byBooking.data?.booking ?? null;
  const resolvedBookingId = bookingId ?? bookingRef?.id ?? null;
  const bookingDetail = useBookingContext(resolvedBookingId);

  const latestInbound = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item && item.type === "inbound" && !item.is_auto_generated && item.from_email) return item;
    }
    return null;
  }, [items]);

  const counterpartEmail = latestInbound?.from_email ?? thread?.counterpart_email ?? byBooking.data?.booking.contact_email ?? bookingDetail.data?.contact_email ?? null;
  const counterpartName =
    titleCase(latestInbound?.from_name) || titleCase(thread?.counterpart_name) || bookingRef?.contact_name || bookingDetail.data?.contact_name || counterpartEmail || "customer";
  const latestSubject = latestInbound?.subject ?? thread?.subject ?? (bookingRef ? `${bookingRef.reference} ${bookingRef.group_name}` : null);
  const defaultSubject = replySubjectFor(latestSubject);
  const replyThrid = thrid ?? thread?.thrid ?? null;
  const canReply = Boolean(counterpartEmail);

  // ---- composer (controlled so keys and the bridge work from outside it)
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("reply");
  const [docIds, setDocIds] = useState<number[]>(() => readDraft(scope)?.document_ids ?? []);
  const [prefill, setPrefill] = useState<{ body: string; subject?: string } | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [originalId, setOriginalId] = useState<number | null>(null);

  const replyToThread = useReplyToThread();
  const replyOnBooking = useReplyOnBooking();
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
    return toggled[item.key] ?? index === newestIndex;
  }

  // ---- keep the newest in view
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastKey = items[items.length - 1]?.key ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastKey, pending?.state, query.isSuccess]);

  // ---- send / note
  async function send(input: ComposerSend) {
    setPending({ to: input.to, subject: input.subject, html: input.body_html, state: "sending", input });
    try {
      if (replyThrid) {
        await replyToThread.mutateAsync({
          thrid: replyThrid,
          body_html: input.body_html,
          body_text: input.body_text,
          subject: input.subject !== defaultSubject ? input.subject : undefined,
          cc: input.cc,
          attach_document_ids: input.attach_document_ids,
          mark_done: input.mark_done,
        });
      } else if (bookingId !== undefined) {
        await replyOnBooking.mutateAsync({ bookingId, body_html: input.body_html, subject: input.subject, attach_document_ids: input.attach_document_ids });
      } else {
        throw new Error("Nowhere to send this reply");
      }
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

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
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
        canReply={canReply}
        markDone={replyThrid ? markDone ?? "offer" : "none"}
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
