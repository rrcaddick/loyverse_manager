/**
 * /mail and /mail/:thrid — queues over conversations (spec §7).
 *
 * Left: the queue rail (Needs reply · Unmatched · Waiting on customer ·
 * Done · All mail with chips), search, and the list. Middle: the
 * ConversationView (stream + docked composer). Right (wide layouts): the
 * booking context or the attach panel. Below ~1150 px of content width the
 * context becomes a one-line strip; below ~768 px the page stacks and a
 * thread opens full-screen with a back button.
 *
 * URL: /mail/:thrid?view=needs_reply&chip=&q=&page=
 * Keys: J K move the cursor (and flip the open conversation), Enter opens,
 * E done, A attach, R reply, N note, / search, ; expand all.
 */

import { ArrowLeft, Check, Link2, Link2Off, MoreHorizontal, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { KeyboardHint } from "@/components/keyboard-hint";
import { PageHeader } from "@/components/layout/page-header";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useComposerBridge } from "@/features/mail/composer-bridge";
import { ConversationList } from "@/features/mail/conversation-list";
import { ConversationView } from "@/features/mail/conversation-view";
import { AttachPanel, BookingContextPanel, ContextStrip, PanelEmpty } from "@/features/mail/context-panel";
import { useConversation, useConversations, useMarkDone, useNotBooking, useReopen, useSyncMail } from "@/features/mail/api";
import { threadName } from "@/features/mail/lib";
import { OriginalDialog } from "@/features/mail/original-dialog";
import { MAIL_CHIPS, MAIL_VIEWS, type MailChip, type MailView, type Thread } from "@/features/mail/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShortcut } from "@/hooks/use-keyboard";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { pluralise } from "@/lib/format";
import { toastWithUndo } from "@/lib/toast";
import { cn } from "@/lib/utils";

const VIEW_LABELS: Record<MailView, string> = {
  needs_reply: "Needs reply",
  unmatched: "Unmatched",
  waiting: "Waiting on customer",
  done: "Done",
  all: "All mail",
};

const CHIP_LABELS: Record<MailChip, string> = { inbound: "Inbound", sent: "Sent", failed: "Failed", automated: "Automated" };

const EMPTY_COPY: Record<MailView, { title: string; hint: string }> = {
  needs_reply: { title: "Nothing waiting on you", hint: "Mail is checked every minute; customer replies land here." },
  unmatched: { title: "Every conversation is attached to a booking", hint: "New mail from an unknown sender appears here until you attach it." },
  waiting: { title: "Nobody is waiting on a customer", hint: "Conversations where the last word was ours show here." },
  done: { title: "Nothing marked done yet", hint: "Press E on a conversation to finish it; a new reply reopens it." },
  all: { title: "No mail yet", hint: "Everything synced from Gmail shows here." },
};

const PAGE_SIZE = 25;

export default function MailPage() {
  useDocumentTitle("Mail");
  useSidebarCollapsed();
  const navigate = useNavigate();
  const { thrid: openThrid = null } = useParams<{ thrid: string }>();
  const [params, setParams] = useSearchParams();

  const rawView = params.get("view");
  const view: MailView = MAIL_VIEWS.includes(rawView as MailView) ? (rawView as MailView) : "needs_reply";
  const rawChip = params.get("chip");
  const chip: MailChip | null = MAIL_CHIPS.includes(rawChip as MailChip) ? (rawChip as MailChip) : null;
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  function update(changes: Partial<Record<"view" | "chip" | "q" | "page", string | null>>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || (key === "view" && value === "needs_reply") || (key === "page" && value === "1")) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  }

  // ---- list
  const list = useConversations({ view, chip, q, page, page_size: PAGE_SIZE });
  const threads = useMemo(() => list.data?.items ?? [], [list.data]);
  const counts = list.data?.counts;
  const total = list.data?.total ?? 0;
  const [cursor, setCursor] = useState(0);
  const openIndex = threads.findIndex((t) => t.thrid === openThrid);
  const effectiveCursor = Math.min(Math.max(0, openIndex >= 0 && cursor === 0 ? openIndex : cursor), Math.max(0, threads.length - 1));

  // ---- the open conversation (shares the cache with the ConversationView)
  const conversation = useConversation(openThrid);
  const thread: Thread | null = conversation.data?.thread ?? threads.find((t) => t.thrid === openThrid) ?? null;
  const booking = conversation.data?.booking ?? thread?.booking ?? null;
  const latestInbound = useMemo(() => {
    const items = conversation.data?.items ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item && item.type === "inbound" && !item.is_auto_generated) return item;
    }
    return null;
  }, [conversation.data]);

  const bridge = useComposerBridge();
  const markDone = useMarkDone();
  const reopen = useReopen();
  const notBooking = useNotBooking();
  const sync = useSyncMail();
  const [attachOpen, setAttachOpen] = useState(false);
  const [originalId, setOriginalId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(q);

  // Debounce the search into the URL.
  useEffect(() => {
    if (search === q) return;
    const timer = window.setTimeout(() => update({ q: search }), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function open(t: Thread) {
    navigate({ pathname: `/mail/${t.thrid}`, search: params.toString() ? `?${params.toString()}` : "" });
  }

  function openNext(after: string | null) {
    const index = threads.findIndex((t) => t.thrid === after);
    const next = threads[index + 1] ?? threads[index - 1] ?? null;
    if (next && next.thrid !== after) open(next);
    else navigate({ pathname: "/mail", search: params.toString() ? `?${params.toString()}` : "" });
  }

  async function finish(t: Thread) {
    await markDone.mutateAsync({ thrid: t.thrid });
    toastWithUndo("Marked done", { description: `${threadName(t)} · ${t.subject ?? ""}`, onUndo: () => reopen.mutateAsync({ thrid: t.thrid }) });
    if (view !== "done" && view !== "all") openNext(t.thrid);
  }

  async function setNotBooking(t: Thread, value: boolean) {
    await notBooking.mutateAsync({ thrid: t.thrid, body: { value } });
    if (value) {
      toastWithUndo("Marked as not a booking", { description: "It leaves every queue.", onUndo: () => notBooking.mutateAsync({ thrid: t.thrid, body: { value: false } }) });
      if (view !== "done" && view !== "all") openNext(t.thrid);
    }
  }

  // ---- keys
  function moveCursor(delta: number) {
    if (!threads.length) return;
    const next = Math.min(Math.max(0, effectiveCursor + delta), threads.length - 1);
    setCursor(next);
    const target = threads[next];
    if (openThrid && target && target.thrid !== openThrid) open(target);
  }
  useShortcut("j", () => moveCursor(1));
  useShortcut("k", () => moveCursor(-1));
  useShortcut("enter", () => {
    const target = threads[effectiveCursor];
    if (target) open(target);
  });
  useShortcut("e", () => {
    if (thread && thread.status === "open") void finish(thread);
  });
  useShortcut("a", () => {
    if (thread && !booking) setAttachOpen(true);
  });
  useShortcut("/", () => searchRef.current?.focus());

  const empty = EMPTY_COPY[view];
  const showList = !openThrid; // on narrow layouts the list hides while a thread is open
  const tabItems = MAIL_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v], count: v === "done" ? null : counts?.[v] ?? null }));

  return (
    <div className="@container flex h-[calc(100dvh-var(--spacing-header)-2.5rem)] min-h-0 flex-col gap-3">
      <PageHeader
        title="Mail"
        className={cn("shrink-0 gap-3", openThrid && "hidden @3xl:flex")}
        actions={
          <Button variant="ghost" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending} aria-label="Check for new mail now">
            <RefreshCw data-icon="inline-start" className={cn(sync.isPending && "animate-spin")} />
            Check now
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SegmentedTabs aria-label="Mail queues" value={view} onChange={(v) => update({ view: v, chip: null })} items={tabItems} />
          {view === "all" ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter all mail">
              {MAIL_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={chip === c}
                  onClick={() => update({ chip: chip === c ? null : c })}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-sm transition-colors",
                    chip === c ? "bg-primary text-primary-foreground" : "bg-nested text-muted-foreground hover:text-foreground",
                  )}
                >
                  {chip === c ? <X aria-hidden="true" className="size-3" /> : null}
                  {CHIP_LABELS[c]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 @3xl:flex-row @3xl:gap-4">
        {/* List */}
        <section aria-label={`${VIEW_LABELS[view]} conversations`} className={cn("flex min-h-0 flex-col rounded-xl bg-card ring-1 ring-border @3xl:w-[21.25rem] @3xl:shrink-0", !showList && "hidden @3xl:flex")}>
          <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${VIEW_LABELS[view].toLowerCase()}`}
                aria-label="Search conversations"
                className="h-9 pl-8 text-sm"
              />
            </div>
            <KeyboardHint keys={["/"]} className="hidden @3xl:flex" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            <ConversationList
              threads={threads}
              view={view}
              openThrid={openThrid}
              cursor={effectiveCursor}
              onCursor={setCursor}
              onOpen={open}
              isLoading={list.isPending}
              emptyTitle={q ? `Nothing matches “${q}”` : empty.title}
              emptyHint={q ? undefined : empty.hint}
            />
          </div>
          {total > PAGE_SIZE ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground tabular">
              <span>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {pluralise(total, "conversation")}
              </span>
              <span className="flex gap-1">
                <Button variant="ghost" size="xs" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                  Newer
                </Button>
                <Button variant="ghost" size="xs" disabled={page * PAGE_SIZE >= total} onClick={() => update({ page: String(page + 1) })}>
                  Older
                </Button>
              </span>
            </div>
          ) : null}
        </section>

        {/* Reading pane */}
        <section aria-label="Conversation" className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-3", !openThrid && "hidden @3xl:flex")}>
          {openThrid ? (
            <>
              <header className="flex shrink-0 items-center gap-2 border-b border-border pb-2">
                <Button variant="ghost" size="icon-sm" className="@3xl:hidden" aria-label="Back to the list" onClick={() => navigate({ pathname: "/mail", search: params.toString() ? `?${params.toString()}` : "" })}>
                  <ArrowLeft />
                </Button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-section">{thread?.subject || "(no subject)"}</h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {thread ? threadName(thread) : ""}
                    {thread?.counterpart_email ? ` · ${thread.counterpart_email}` : ""}
                    {thread ? ` · ${pluralise(thread.message_count, "message")}` : ""}
                  </p>
                </div>
                {thread ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {thread.status === "done" ? (
                      <Button variant="outline" size="sm" onClick={() => reopen.mutate({ thrid: thread.thrid })} disabled={reopen.isPending}>
                        <RotateCcw data-icon="inline-start" />
                        Reopen
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => void finish(thread)} disabled={markDone.isPending}>
                        <Check data-icon="inline-start" />
                        Done
                        <KeyboardHint keys={["E"]} className="ml-1 hidden text-primary-foreground/80 @3xl:flex" />
                      </Button>
                    )}
                    {booking ? (
                      <Button variant="ghost" size="sm" className="hidden @6xl:inline-flex" onClick={() => navigate(`/bookings/${booking.id}`)}>
                        <Link2 data-icon="inline-start" />
                        {booking.reference}
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setAttachOpen(true)}>
                        <Link2 data-icon="inline-start" />
                        Attach
                        <KeyboardHint keys={["A"]} className="ml-1 hidden @3xl:flex" />
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="More actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {thread.not_booking ? (
                          <DropdownMenuItem onSelect={() => void setNotBooking(thread, false)}>Undo “not a booking”</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => void setNotBooking(thread, true)}>Not a booking</DropdownMenuItem>
                        )}
                        {booking ? (
                          <DropdownMenuItem onSelect={() => setAttachOpen(true)}>
                            <Link2Off />
                            Attach to a different booking…
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem disabled={!latestInbound} onSelect={() => latestInbound && setOriginalId(latestInbound.id)}>
                          View original
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={!latestInbound} onSelect={() => setAttachOpen(true)}>
                          Send form link…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </header>
              <ContextStrip booking={booking} onAttach={() => setAttachOpen(true)} className="shrink-0 @6xl:hidden" />
              <ConversationView thrid={openThrid} bridge={bridge} markDone={view === "needs_reply" ? "default" : "offer"} className="min-h-0" />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-xl bg-card ring-1 ring-border">
              <PanelEmpty />
            </div>
          )}
        </section>

        {/* Context panel */}
        <aside aria-label="Context" className={cn("hidden min-h-0 w-72 shrink-0 overflow-y-auto scrollbar-thin @6xl:block", !openThrid && "@6xl:hidden")}>
          {openThrid && thread ? (
            booking ? (
              <BookingContextPanel booking={booking} thread={thread} onAttachDocument={(id) => bridge.attachDocument(id)} onDetach={() => undefined} />
            ) : (
              <AttachPanel thread={thread} latestInbound={latestInbound} onNotBooking={() => openNext(thread.thrid)} />
            )
          ) : null}
        </aside>
      </div>

      {/* Attach dialog (the A key, narrow layouts, and "attach to a different booking") */}
      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Attach to a booking</DialogTitle>
            <DialogDescription>{thread ? `${threadName(thread)} · ${thread.subject ?? ""}` : null}</DialogDescription>
          </DialogHeader>
          {thread ? (
            <AttachPanel
              thread={thread}
              latestInbound={latestInbound}
              autoFocus
              onAttached={() => setAttachOpen(false)}
              onNotBooking={() => {
                setAttachOpen(false);
                openNext(thread.thrid);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <OriginalDialog messageId={originalId} onClose={() => setOriginalId(null)} />
    </div>
  );
}
