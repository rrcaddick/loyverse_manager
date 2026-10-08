/**
 * The queue list (spec §7): one row per conversation — counterpart, booking
 * chip or amber "Unmatched", subject, snippet of the latest new text ("You: …"
 * when ours), time, unread dot, a 3 px amber bar when a reply has waited
 * more than two days. The page owns the cursor (J / K) and `onOpen`.
 */

import { Paperclip } from "lucide-react";
import { useEffect, useRef } from "react";

import { EmptyState } from "@/components/empty-state";
import { StatusPill } from "@/components/status-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { listTime, splitSnippet, threadName, waitingDays } from "./lib";
import type { MailView, Thread } from "./types";

interface ConversationListProps {
  threads: Thread[];
  view: MailView;
  openThrid: string | null;
  cursor: number;
  onCursor: (index: number) => void;
  onOpen: (thread: Thread) => void;
  isLoading: boolean;
  isFetching?: boolean;
  emptyTitle: string;
  emptyHint?: string;
  className?: string;
}

export function ConversationList({ threads, view, openThrid, cursor, onCursor, onOpen, isLoading, emptyTitle, emptyHint, className }: ConversationListProps) {
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
  if (threads.length === 0) {
    return <EmptyState className={className} title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <ol ref={listRef} className={cn("flex flex-col", className)} aria-label="Conversations">
      {threads.map((thread, index) => {
        const open = thread.thrid === openThrid;
        const atCursor = index === cursor;
        const name = threadName(thread);
        const snippet = splitSnippet(thread.last_snippet);
        const waiting = view === "needs_reply" || view === "all" ? waitingDays(thread) : 0;
        const unread = thread.unread && thread.status === "open";
        return (
          <li key={thread.thrid} data-index={index} className={cn("relative", waiting > 2 && "edge-amber")}>
            <button
              type="button"
              onClick={() => {
                onCursor(index);
                onOpen(thread);
              }}
              onFocus={() => onCursor(index)}
              aria-current={open ? "true" : undefined}
              tabIndex={atCursor ? 0 : -1}
              className={cn(
                "flex min-h-row-queue w-full flex-col gap-0.5 px-3 py-2 text-left outline-none transition-colors",
                "border-b border-border last:border-b-0",
                open ? "bg-selection-row" : atCursor ? "bg-nested" : "hover:bg-nested",
                "focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:ring-inset",
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span aria-label={unread ? "Unread" : undefined} className={cn("size-2 shrink-0 rounded-full", unread ? "bg-direction-in" : "bg-transparent")} />
                <span className={cn("min-w-0 flex-1 truncate text-body", unread ? "font-semibold text-foreground" : "font-medium text-foreground")}>{name}</span>
                {thread.has_attachments ? <Paperclip aria-label="Has attachments" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                <time dateTime={thread.last_message_at ?? undefined} className={cn("shrink-0 text-xs tabular", unread ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {listTime(thread.last_message_at)}
                </time>
              </div>
              <div className="flex min-w-0 items-center gap-2 pl-4">
                {thread.booking ? (
                  <span className="inline-flex h-5 max-w-[55%] shrink-0 items-center gap-1 truncate rounded-md bg-nested px-1.5 text-xs font-medium text-foreground ring-1 ring-border">
                    <span className="tabular">{thread.booking.reference}</span>
                    <span className="truncate text-muted-foreground">· {thread.booking.group_name}</span>
                  </span>
                ) : thread.not_booking ? (
                  <StatusPill tone="neutral" label="Not a booking" size="sm" />
                ) : thread.has_automated_only ? (
                  <StatusPill tone="neutral" label="Automated" size="sm" />
                ) : (
                  <StatusPill tone="amber" label="Unmatched" size="sm" />
                )}
                <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "text-foreground" : "text-muted-foreground")}>{thread.subject || "(no subject)"}</span>
              </div>
              <div className="min-w-0 truncate pl-4 text-sm text-muted-foreground">
                {snippet.ours ? <span className="text-faint-foreground">You: </span> : null}
                {snippet.text || " "}
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
