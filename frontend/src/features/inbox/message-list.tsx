/**
 * Left pane: view tabs, search, the message rows and compact paging.
 * Rows are links (middle-click works); Arrow/J/K move the selection when the
 * list has focus, Enter opens, and the current row carries aria-current.
 */

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/api";
import { formatNumber, formatRelativeDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { counterpart } from "./format";
import { BookingChip, RowMarkers } from "./message-meta";
import type { InboxListItem, InboxListResponse, InboxView } from "./types";

interface MessageListProps {
  view: InboxView;
  onViewChange: (view: InboxView) => void;
  counts: { review: number; unmatched: number } | undefined;
  bookingFilter: { id: number; label: string } | null;
  onClearBookingFilter: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  data: InboxListResponse | undefined;
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Build the href for a row, preserving the list state. */
  hrefFor: (id: number) => string;
}

export function MessageList({
  view,
  onViewChange,
  counts,
  bookingFilter,
  onClearBookingFilter,
  query,
  onQueryChange,
  page,
  onPageChange,
  data,
  isPending,
  isFetching,
  error,
  onRetry,
  selectedId,
  onSelect,
  hrefFor,
}: MessageListProps) {
  const [draft, setDraft] = useState(query);
  const [lastQuery, setLastQuery] = useState(query);
  const listRef = useRef<HTMLUListElement>(null);

  // The URL is the source of truth; when it changes from outside, follow it.
  if (query !== lastQuery) {
    setLastQuery(query);
    setDraft(query);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft.trim() !== query.trim()) onQueryChange(draft.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, query, onQueryChange]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 25;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (items.length === 0) return;
    const keys: Record<string, number> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 };
    const delta = keys[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const index = items.findIndex((m) => m.id === selectedId);
    const next = index === -1 ? (delta > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, index + delta));
    const target = items[next];
    if (!target) return;
    onSelect(target.id);
    const row = listRef.current?.querySelector<HTMLAnchorElement>(`[data-message-id="${target.id}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-3 pt-3 pb-3">
        {bookingFilter ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-primary/8 px-2.5 py-1.5 text-sm ring-1 ring-inset ring-primary/15">
            <span className="truncate">
              Mail for <span className="font-medium tabular">{bookingFilter.label}</span>
            </span>
            <Button variant="ghost" size="icon-xs" aria-label="Clear booking filter" onClick={onClearBookingFilter}>
              <X />
            </Button>
          </div>
        ) : (
          <Tabs value={view} onValueChange={(v) => onViewChange(v as InboxView)}>
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="review" className="flex-none">
                Review
                <TabCount count={counts?.review} emphasise />
              </TabsTrigger>
              <TabsTrigger value="unmatched" className="flex-none">
                Unmatched
                <TabCount count={counts?.unmatched} />
              </TabsTrigger>
              <TabsTrigger value="all" className="flex-none">
                All
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <InputGroup className="h-8">
          <InputGroupAddon>
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search sender, subject or text"
            aria-label="Search messages"
            autoComplete="off"
          />
          {draft ? (
            <InputGroupAddon align="inline-end">
              <Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setDraft("")}>
                <X />
              </Button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>

      <div className={cn("min-h-0 flex-1 overflow-y-auto scrollbar-thin", isFetching && !isPending && "opacity-80 transition-opacity")} aria-busy={isFetching}>
        {isPending ? (
          <ListSkeleton />
        ) : error ? (
          <EmptyState compact title="Could not load messages" description={errorMessage(error)} action={<Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>} />
        ) : items.length === 0 ? (
          <EmptyState compact title={query ? "No messages match" : view === "review" ? "Nothing to review" : "No messages"} description={query ? `Nothing in this view matches “${query}”.` : view === "review" ? "Every recent email is linked or resolved." : undefined} />
        ) : (
          <ul ref={listRef} role="list" aria-label="Messages" onKeyDown={onKeyDown} className="divide-y divide-border">
            {items.map((item) => (
              <MessageRow key={item.id} item={item} selected={item.id === selectedId} href={hrefFor(item.id)} onSelect={() => onSelect(item.id)} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground tabular">
        <span aria-live="polite">{total === 0 ? "No messages" : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft />
          </Button>
          <span>
            {formatNumber(page)} / {formatNumber(pageCount)}
          </span>
          <Button variant="ghost" size="icon-xs" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabCount({ count, emphasise }: { count: number | undefined; emphasise?: boolean }) {
  if (count === undefined) return null;
  return (
    <span className={cn("rounded-full px-1.5 text-xs tabular", emphasise && count > 0 ? "bg-status-amber-bg text-status-amber-fg" : "bg-muted text-muted-foreground")}>
      {formatNumber(count)}
    </span>
  );
}

function MessageRow({ item, selected, href, onSelect }: { item: InboxListItem; selected: boolean; href: string; onSelect: () => void }) {
  const who = counterpart(item);
  const unread = item.review_status === "pending";
  const rel = formatRelativeDay(item.sent_at);
  const when = rel === "Today" ? formatTime(item.sent_at) : rel;
  return (
    <li>
      <Link
        to={href}
        data-message-id={item.id}
        aria-current={selected ? "page" : undefined}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onSelect();
        }}
        className={cn(
          "block px-3 py-2.5 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
          selected && "bg-primary/6 shadow-[inset_2px_0_0_var(--primary)]",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("min-w-0 truncate text-sm", unread ? "font-semibold text-foreground" : "font-medium text-foreground")}>
            {who.outbound ? <span className="text-muted-foreground">To: </span> : null}
            {who.name}
          </span>
          <time dateTime={item.sent_at} className="shrink-0 text-xs text-muted-foreground tabular">
            {when}
          </time>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className={cn("min-w-0 truncate text-sm", unread ? "text-foreground" : "text-foreground/90")}>{item.subject || "(no subject)"}</span>
          <RowMarkers item={item} />
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{item.snippet}</span>
          {item.booking ? <BookingChip booking={item.booking} link={false} className="shrink-0" /> : unread ? <span className="size-1.5 shrink-0 rounded-full bg-status-amber-fg" aria-label="Awaiting review" /> : null}
        </div>
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-2 px-3 py-3">
          <div className="flex justify-between">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}
