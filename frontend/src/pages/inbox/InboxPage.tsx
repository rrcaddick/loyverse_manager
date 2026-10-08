/**
 * /inbox and /inbox/:messageId — list on the left, the selected thread on the
 * right. List state (view, q, page, booking_id) lives in the URL so links and
 * refreshes keep their place; on phones the two panes take turns.
 */

import { Inbox, PenSquare, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useInboxList, useSyncInbox } from "@/features/inbox/api";
import { ComposerDialog } from "@/features/inbox/composer-dialog";
import { MessageList } from "@/features/inbox/message-list";
import { ThreadView } from "@/features/inbox/thread-view";
import type { InboxView } from "@/features/inbox/types";
import { useBookingDetail } from "@/features/queue/bookings";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

const VIEWS: InboxView[] = ["review", "unmatched", "all"];

export default function InboxPage() {
  useDocumentTitle("Inbox");
  const { messageId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const bookingId = params.get("booking_id") ? Number(params.get("booking_id")) || null : null;
  const rawView = params.get("view") as InboxView | null;
  const view: InboxView = bookingId ? "booking" : rawView && VIEWS.includes(rawView) ? rawView : "review";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const selectedId = messageId ? Number(messageId) || null : null;

  const list = useInboxList({ view, page, q, booking_id: bookingId });
  const bookingForFilter = useBookingDetail(bookingId);
  const sync = useSyncInbox();
  const [composeOpen, setComposeOpen] = useState(false);

  const update = useCallback(
    (changes: Partial<{ view: InboxView; q: string; page: number; booking_id: number | null }>) => {
      const next = new URLSearchParams(params);
      if (changes.view !== undefined) next.set("view", changes.view);
      if (changes.q !== undefined) {
        if (changes.q) next.set("q", changes.q);
        else next.delete("q");
      }
      if (changes.booking_id !== undefined) {
        if (changes.booking_id) next.set("booking_id", String(changes.booking_id));
        else next.delete("booking_id");
      }
      const pageValue = changes.page ?? 1;
      if (pageValue > 1) next.set("page", String(pageValue));
      else next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const search = params.toString();
  const hrefFor = useCallback((id: number) => `/inbox/${id}${search ? `?${search}` : ""}`, [search]);
  const listHref = `/inbox${search ? `?${search}` : ""}`;

  const bookingFilter = useMemo(() => {
    if (!bookingId) return null;
    const b = bookingForFilter.data;
    return { id: bookingId, label: b ? `${b.reference} ${b.group_name}` : `booking #${bookingId}` };
  }, [bookingId, bookingForFilter.data]);

  async function runSync() {
    try {
      const result = await sync.mutateAsync();
      const parts = [`${result.fetched} fetched`, `${result.inserted} new`, `${result.matched} matched`];
      toast.success(`Mailbox synced in ${formatDuration(result.duration_s * 1000)}`, { description: parts.join(" · ") });
    } catch {
      // The mutation cache has toasted the error.
    }
  }

  const showList = !isMobile || selectedId === null;
  const showThread = !isMobile || selectedId !== null;

  return (
    <div className="flex min-h-0 flex-col gap-4 md:h-[calc(100svh-6.5rem)] md:min-h-[32rem]">
      <PageHeader
        title="Inbox"
        description="Mail from the bookings mailbox, matched to bookings for review."
        className="shrink-0"
        actions={
          <>
            <Button variant="outline" onClick={() => void runSync()} disabled={sync.isPending} aria-label="Sync the mailbox now">
              <RefreshCw data-icon="inline-start" className={cn(sync.isPending && "animate-spin")} />
              {sync.isPending ? "Syncing…" : "Sync now"}
            </Button>
            <Button onClick={() => setComposeOpen(true)}>
              <PenSquare data-icon="inline-start" />
              Compose
            </Button>
          </>
        }
      />

      <div className={cn("grid min-h-0 flex-1 gap-4", showList && showThread && "md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]")}>
        {showList ? (
          <section aria-label="Message list" className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 md:min-h-0">
            <MessageList
              view={view === "booking" ? "all" : view}
              onViewChange={(v) => update({ view: v, page: 1 })}
              counts={list.data?.counts}
              bookingFilter={bookingFilter}
              onClearBookingFilter={() => update({ booking_id: null, page: 1 })}
              query={q}
              onQueryChange={(value) => update({ q: value, page: 1 })}
              page={page}
              onPageChange={(p) => update({ page: p })}
              data={list.data}
              isPending={list.isPending}
              isFetching={list.isFetching}
              error={list.error}
              onRetry={() => void list.refetch()}
              selectedId={selectedId}
              onSelect={(id) => navigate(hrefFor(id))}
              hrefFor={hrefFor}
            />
          </section>
        ) : null}

        {showThread ? (
          <section aria-label="Conversation" className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 md:min-h-0">
            {selectedId !== null ? (
              <ThreadView key={selectedId} messageId={selectedId} onBack={isMobile ? () => navigate(listHref) : undefined} />
            ) : (
              <EmptyState
                icon={Inbox}
                title="Select a message"
                description="Pick a conversation on the left to read it and act on it."
                action={
                  <p className="text-xs text-muted-foreground">
                    <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> open
                  </p>
                }
              />
            )}
          </section>
        ) : null}
      </div>

      <ComposerDialog target={composeOpen ? { mode: "compose" } : null} open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}
