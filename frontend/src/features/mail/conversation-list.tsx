/**
 * The queue list (spec §7). Two row shapes share one list:
 *
 *   party   (Needs reply, v3) — one row per PERSON: name, booking chip or
 *           amber "Unmatched", "2 messages waiting · oldest 4 Jun", the latest
 *           subject and snippet, a 3 px amber bar when the oldest has waited
 *           more than two days.
 *   thread  (every other view) — counterpart, chip, subject, snippet ("You: …"
 *           when ours), time, unread dot, and "N unanswered" when the person
 *           is still waiting on something in this thread.
 *
 * The page owns the cursor (J / K) and `onOpen`.
 */

import { Paperclip } from "lucide-react";
import { useEffect, useRef } from "react";

import { EmptyState } from "@/components/empty-state";
import { StatusPill } from "@/components/status-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { listTime, partyName, partyWaitingDays, splitSnippet, threadName, waitingDays, waitingLine } from "./lib";
import { isParty, listKey, type MailView, type Party, type Thread } from "./types";

interface ConversationListProps {
  items: (Thread | Party)[];
  view: MailView;
  /** The open row's key: a `party_key` or a `thrid`. */
  openKey: string | null;
  cursor: number;
  onCursor: (index: number) => void;
  onOpen: (item: Thread | Party) => void;
  isLoading: boolean;
  isFetching?: boolean;
  emptyTitle: string;
  emptyHint?: string;
  className?: string;
}

const ROW =
  "flex min-h-row-queue w-full flex-col gap-0.5 px-3 py-2 text-left outline-none transition-colors border-b border-border last:border-b-0 focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:ring-inset";

function rowTone(open: boolean, atCursor: boolean): string {
  return open ? "bg-selection-row" : atCursor ? "bg-nested" : "hover:bg-nested";
}

export function ConversationList({ items, view, openKey, cursor, onCursor, onOpen, isLoading, emptyTitle, emptyHint, className }: ConversationListProps) {
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the cursor row in view as J / K move it.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (isLoading) {
    return (
      <div className={cn("flex flex-col gap-1 p-2", className)} aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[4.5rem] rounded-lg" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return <EmptyState className={className} title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <ol ref={listRef} className={cn("flex flex-col", className)} aria-label="Conversations">
      {items.map((item, index) => {
        const key = listKey(item);
        const open = key === openKey;
        const atCursor = index === cursor;
        const select = () => {
          onCursor(index);
          onOpen(item);
        };
        return isParty(item) ? (
          <PartyRow key={key} party={item} index={index} open={open} atCursor={atCursor} onSelect={select} onFocus={() => onCursor(index)} />
        ) : (
          <ThreadRow key={key} thread={item} view={view} index={index} open={open} atCursor={atCursor} onSelect={select} onFocus={() => onCursor(index)} />
        );
      })}
    </ol>
  );
}

interface RowProps {
  index: number;
  open: boolean;
  atCursor: boolean;
  onSelect: () => void;
  onFocus: () => void;
}

/** The booking chip or the amber Unmatched pill under a name. */
function BookingChip({ booking, fallback }: { booking: Thread["booking"]; fallback: React.ReactNode }) {
  if (booking) {
    return (
      <span className="inline-flex h-5 max-w-[55%] shrink-0 items-center gap-1 truncate rounded-md bg-nested px-1.5 text-xs font-medium text-foreground ring-1 ring-border">
        <span className="tabular">{booking.reference}</span>
        <span className="truncate text-muted-foreground">· {booking.group_name}</span>
      </span>
    );
  }
  return <>{fallback}</>;
}

function PartyRow({ party, index, open, atCursor, onSelect, onFocus }: RowProps & { party: Party }) {
  const name = partyName(party);
  const snippet = splitSnippet(party.last_snippet);
  const waiting = partyWaitingDays(party);
  return (
    <li data-index={index} data-party-key={party.party_key} className={cn("relative", waiting > 2 && "edge-amber")}>
      <button type="button" onClick={onSelect} onFocus={onFocus} aria-current={open ? "true" : undefined} tabIndex={atCursor ? 0 : -1} className={cn(ROW, rowTone(open, atCursor))}>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-direction-in" />
          <span className="min-w-0 flex-1 truncate text-body font-semibold text-foreground">{name}</span>
          {party.has_attachments ? <Paperclip aria-label="Has attachments" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
          <time dateTime={party.last_message_at ?? undefined} className="shrink-0 text-xs font-medium text-foreground tabular">
            {listTime(party.last_message_at)}
          </time>
        </div>
        <div className="flex min-w-0 items-center gap-2 pl-4">
          <BookingChip booking={party.booking} fallback={<StatusPill tone="amber" label="Unmatched" size="sm" />} />
          <span className={cn("min-w-0 flex-1 truncate text-sm", waiting > 2 ? "font-medium text-amber-text" : "text-foreground")}>{waitingLine(party)}</span>
        </div>
        <div className="min-w-0 truncate pl-4 text-sm text-muted-foreground">
          {party.thread_count > 1 ? <span className="text-faint-foreground">{pluralise(party.thread_count, "conversation")} · </span> : null}
          <span className="text-foreground">{party.subject || "(no subject)"}</span>
          {snippet.text ? <span> — {snippet.ours ? "You: " : ""}{snippet.text}</span> : null}
        </div>
      </button>
    </li>
  );
}

function ThreadRow({ thread, view, index, open, atCursor, onSelect, onFocus }: RowProps & { thread: Thread; view: MailView }) {
  const name = threadName(thread);
  const snippet = splitSnippet(thread.last_snippet);
  const waiting = view === "needs_reply" || view === "all" ? waitingDays(thread) : 0;
  const unread = thread.unread && thread.status === "open";
  const unanswered = thread.unanswered_count ?? 0;
  return (
    <li data-index={index} data-thrid={thread.thrid} className={cn("relative", waiting > 2 && "edge-amber")}>
      <button type="button" onClick={onSelect} onFocus={onFocus} aria-current={open ? "true" : undefined} tabIndex={atCursor ? 0 : -1} className={cn(ROW, rowTone(open, atCursor))}>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-label={unread ? "Unread" : undefined} className={cn("size-2 shrink-0 rounded-full", unread ? "bg-direction-in" : "bg-transparent")} />
          <span className={cn("min-w-0 flex-1 truncate text-body", unread ? "font-semibold text-foreground" : "font-medium text-foreground")}>{name}</span>
          {unanswered > 0 ? <StatusPill tone="amber" size="sm" label={`${unanswered} unanswered`} /> : null}
          {thread.has_attachments ? <Paperclip aria-label="Has attachments" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
          <time dateTime={thread.last_message_at ?? undefined} className={cn("shrink-0 text-xs tabular", unread ? "font-medium text-foreground" : "text-muted-foreground")}>
            {listTime(thread.last_message_at)}
          </time>
        </div>
        <div className="flex min-w-0 items-center gap-2 pl-4">
          <BookingChip
            booking={thread.booking}
            fallback={
              thread.not_booking ? (
                <StatusPill tone="neutral" label="Not a booking" size="sm" />
              ) : thread.has_automated_only ? (
                <StatusPill tone="neutral" label="Automated" size="sm" />
              ) : (
                <StatusPill tone="amber" label="Unmatched" size="sm" />
              )
            }
          />
          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "text-foreground" : "text-muted-foreground")}>{thread.subject || "(no subject)"}</span>
        </div>
        <div className="min-w-0 truncate pl-4 text-sm text-muted-foreground">
          {snippet.ours ? <span className="text-faint-foreground">You: </span> : null}
          {snippet.text || " "}
        </div>
      </button>
    </li>
  );
}
