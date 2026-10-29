/**
 * /bookings — one data table, split by status bucket (owner's notes, 26 Oct
 * 2026; docs/research/08): Requests · Pending · Confirmed · Lapsed · Past ·
 * All as filters over the same columns, one search box, a date range
 * (upcoming, this week, this month, next month, past, all), a page size,
 * zebra rows, the full page width. State lives in the URL
 * (features/bookings/list-params.ts); the header search lands as ?q=.
 * Cards on a phone.
 */

import type { SortingState } from "@tanstack/react-table";
import { BookOpenText, Plus, Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBookingCounts, useBookings } from "@/features/bookings/api";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import { BookingCards } from "@/features/bookings/components/list-cards";
import { columnsFor } from "@/features/bookings/components/list-columns";
import { PAGE_SIZES, RANGE_OPTIONS, SORTABLE_COLUMNS, TAB_DEFAULTS, hasActiveFilters, parseListState, stateForTab, toApiParams, writeListState, type ListState, type RangePreset } from "@/features/bookings/list-params";
import { BOOKING_BUCKETS, type BookingBucket } from "@/features/bookings/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useMediaBelow } from "@/hooks/use-media-below";
import { useIsMobile } from "@/hooks/use-mobile";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const TAB_LABELS: Record<BookingBucket, string> = { requests: "Requests", pending: "Pending", confirmed: "Confirmed", lapsed: "Lapsed", past: "Past", all: "All" };

const EMPTY_COPY: Record<BookingBucket, { title: string; hint: string }> = {
  requests: { title: "No requests to review", hint: "Requests from the public form wait here until they are accepted or declined." },
  pending: { title: "Nothing pending", hint: "Accepted requests and enquiries stay here until the deposit arrives." },
  confirmed: { title: "No confirmed visits", hint: "A booking moves here when its deposit is recorded or matched from the bank." },
  lapsed: { title: "Nothing lapsed, cancelled or declined", hint: "Holds that expire without a deposit, cancellations and declined requests are kept here." },
  past: { title: "No past visits yet", hint: "Completed visits and no-shows are kept here." },
  all: { title: "No bookings yet", hint: "Requests from the form, the inbox or the phone will show up here." },
};

export default function BookingsPage() {
  useDocumentTitle("Bookings");
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // Card screens come in two forms: with room, the chips stay and the pager
  // and New booking share a row; narrower, dropdowns and a floating plus.
  const isPhone = useMediaBelow(480);
  const layout: ToolbarLayout = !isMobile ? "table" : isPhone ? "phone" : "cards";
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseListState(params), [params]);
  const apiParams = useMemo(() => toApiParams(state), [state]);
  const list = useBookings(apiParams);
  const counts = useBookingCounts();
  const [createOpen, setCreateOpen] = useState(false);

  function update(patch: Partial<ListState>, resetPage = true) {
    const next = { ...state, ...patch, page: resetPage ? 1 : (patch.page ?? state.page) };
    setParams(writeListState(next, params), { replace: true });
  }

  const sorting: SortingState = useMemo(() => {
    const desc = state.sort.startsWith("-");
    return [{ id: desc ? state.sort.slice(1) : state.sort, desc }];
  }, [state.sort]);

  const columns = useMemo(() => columnsFor(state.tab), [state.tab]);
  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];
  const c = counts.data;
  const clear = () => update({ range: TAB_DEFAULTS[state.tab].range, q: "" });

  return (
    <>
      {/* No title row: the nav says where you are, the buckets are the header
          and the primary action sits on their row. Card screens: the action
          moves to the pager row, and on narrow phones the buckets and date
          ranges become two dropdowns and the action a floating plus
          (owner's notes, 29 Oct 2026). */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sr-only">Bookings</h1>
        {layout === "phone" ? (
          <div className="grid w-full grid-cols-2 gap-2">
            <Select value={state.tab} onValueChange={(tab) => setParams(writeListState(stateForTab(state, tab as BookingBucket), params), { replace: true })}>
              <SelectTrigger className="w-full" aria-label="Bucket">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOOKING_BUCKETS.map((tab) => {
                  const n = tab === "requests" ? (c?.requests ?? 0) : (c?.[tab] ?? 0);
                  return (
                    <SelectItem key={tab} value={tab}>
                      {TAB_LABELS[tab]}
                      {n > 0 ? ` (${formatNumber(n)})` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select value={state.range} onValueChange={(range) => update({ range: range as RangePreset })}>
              <SelectTrigger className="w-full" aria-label="Date range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <SegmentedTabs
            aria-label="Booking buckets"
            value={state.tab}
            onChange={(tab) => setParams(writeListState(stateForTab(state, tab), params), { replace: true })}
            items={[
              { value: "requests", label: TAB_LABELS.requests, count: c?.requests ?? null },
              { value: "pending", label: TAB_LABELS.pending, count: c?.pending },
              { value: "confirmed", label: TAB_LABELS.confirmed, count: c?.confirmed },
              { value: "lapsed", label: TAB_LABELS.lapsed, count: c?.lapsed },
              { value: "past", label: TAB_LABELS.past, count: c?.past },
              { value: "all", label: TAB_LABELS.all, count: c?.all },
            ]}
          />
        )}
        {layout === "table" ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            New booking
          </Button>
        ) : null}
      </header>
      {layout === "phone" ? (
        <Button size="icon" aria-label="New booking" className="fixed right-4 bottom-4 z-30 size-14 rounded-full shadow-lg" onClick={() => setCreateOpen(true)}>
          <Plus className="size-6" />
        </Button>
      ) : null}

      {list.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load bookings</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{errorMessage(list.error)}</span>
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Toolbar
        state={state}
        onChange={update}
        total={list.data ? total : null}
        layout={layout}
        action={
          layout === "cards" ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus data-icon="inline-start" />
              New booking
            </Button>
          ) : null
        }
      />

      {isMobile ? (
        // The cards scroll in their own box so the buckets, filters and pager
        // stay on screen (owner's note, 29 Oct 2026).
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin">
          {list.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <EmptyBookings state={state} onClear={clear} onCreate={() => setCreateOpen(true)} />
          ) : (
            <BookingCards items={items} tab={state.tab} />
          )}
        </div>
      ) : (
        // Desktop: the card takes the remaining height and only the table body
        // scrolls, so the buckets and filters never leave the screen.
        <section
          className={cn("@container/table overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border transition-opacity md:flex md:min-h-0 md:flex-1 md:flex-col", list.isPlaceholderData && "opacity-80")}
          aria-label={`${TAB_LABELS[state.tab]} bookings`}
        >
          <DataTable
            key={state.tab}
            fill
            pagination={false}
            columns={columns}
            data={items}
            isLoading={list.isPending}
            getRowId={(b) => String(b.id)}
            onRowClick={(b) => navigate(`/bookings/${b.id}`)}
            rowClassName={() => "h-row-lg"}
            className="[&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5"
            manualPagination
            rowCount={total}
            pageSize={state.size}
            pageSizeOptions={[...PAGE_SIZES]}
            paginationState={{ pageIndex: state.page - 1, pageSize: state.size }}
            onPaginationChange={(updater) => {
              const current = { pageIndex: state.page - 1, pageSize: state.size };
              const next = typeof updater === "function" ? updater(current) : updater;
              if (next.pageSize !== state.size) update({ size: next.pageSize, page: 1 });
              else update({ page: next.pageIndex + 1 }, false);
            }}
            manualSorting
            sorting={sorting}
            onSortingChange={(updater) => {
              const next = typeof updater === "function" ? updater(sorting) : updater;
              const first = next[0];
              if (!first || !SORTABLE_COLUMNS.has(first.id)) {
                update({ sort: TAB_DEFAULTS[state.tab].sort });
                return;
              }
              update({ sort: `${first.desc ? "-" : ""}${first.id}` });
            }}
            emptyState={<EmptyBookings state={state} onClear={clear} onCreate={() => setCreateOpen(true)} />}
          />
        </section>
      )}

      <BookingFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function EmptyBookings({ state, onClear, onCreate }: { state: ListState; onClear: () => void; onCreate: () => void }) {
  const filtered = hasActiveFilters(state);
  const copy = EMPTY_COPY[state.tab];
  return (
    <EmptyState
      variant="card"
      icon={BookOpenText}
      title={filtered ? "No bookings match" : copy.title}
      hint={filtered ? "Try a wider date range or clear the search." : copy.hint}
      action={
        filtered ? (
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        ) : (
          <Button onClick={onCreate}>New booking</Button>
        )
      }
      link={state.tab !== "all" && !filtered ? { to: "/bookings?tab=all", label: "All bookings" } : undefined}
    />
  );
}

// ------------------------------------------------------------------ toolbar

type ToolbarLayout = "table" | "cards" | "phone";

interface ToolbarProps {
  state: ListState;
  onChange: (patch: Partial<ListState>, resetPage?: boolean) => void;
  total: number | null;
  /**
   * table: one wrapping row. cards: the search, the range chips on centred
   * lines, then the pager on the left and the action on the right. phone:
   * the ranges are a dropdown in the header, so only the search and pager.
   */
  layout?: ToolbarLayout;
  /** The primary action for the cards layout (a floating plus covers phone). */
  action?: ReactNode;
}

function Toolbar({ state, onChange, total, layout = "table", action }: ToolbarProps) {
  const pageCount = total === null ? 1 : Math.max(1, Math.ceil(total / state.size));
  const from = !total ? 0 : (state.page - 1) * state.size + 1;
  const to = total === null ? 0 : Math.min(total, state.page * state.size);
  const [q, setQ] = useState(state.q);
  const [syncedQ, setSyncedQ] = useState(state.q);
  if (state.q !== syncedQ) {
    // The URL changed underneath us (header search, back button): adopt it.
    setSyncedQ(state.q);
    setQ(state.q);
  }
  useEffect(() => {
    if (q.trim() === state.q) return;
    const timer = window.setTimeout(() => onChange({ q: q.trim() }), 350);
    return () => window.clearTimeout(timer);
    // onChange is recreated per render; the debounce only cares about q.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const stacked = layout !== "table";
  return (
    <div className={cn("flex w-full gap-2", stacked ? "flex-col" : "flex-wrap items-center")}>
      <form
        role="search"
        className={stacked ? "w-full" : "w-80"}
        onSubmit={(e) => {
          e.preventDefault();
          onChange({ q: q.trim() });
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput data-list-search type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, group, contact, phone, area" aria-label="Search bookings" autoComplete="off" />
          {q ? (
            <InputGroupAddon align="inline-end">
              <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection-ring">
                <X className="size-3.5" />
              </button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </form>

      {layout !== "phone" ? (
        <div role="group" aria-label="Date range" className={cn("flex flex-wrap items-center gap-1", layout === "cards" && "w-full justify-center")}>
          {RANGE_OPTIONS.map((o) => (
            <Button key={o.value} type="button" size="sm" variant={state.range === o.value ? "secondary" : "ghost"} aria-pressed={state.range === o.value} className={cn(state.range === o.value && "ring-1 ring-border")} onClick={() => onChange({ range: o.value as RangePreset })}>
              {o.label}
            </Button>
          ))}
          {hasActiveFilters(state) ? (
            <Button variant="ghost" size="sm" onClick={() => onChange({ range: TAB_DEFAULTS[state.tab].range, q: "" })}>
              <X data-icon="inline-start" />
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* The pager lives here, Gmail-style, so no row is lost to a footer
          (owner's note, 29 Oct 2026). */}
      <div className={cn("flex items-center gap-1", stacked ? "w-full" : "ml-auto")}>
        {total !== null ? (
          <span className="mr-1 text-sm tabular text-muted-foreground" aria-live="polite">
            {total === 0 ? "No bookings" : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
          </span>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={state.page <= 1} onClick={() => onChange({ page: state.page - 1 }, false)}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={state.page >= pageCount} onClick={() => onChange({ page: state.page + 1 }, false)}>
          <ChevronRight />
        </Button>
        <Select value={String(state.size)} onValueChange={(v) => onChange({ size: Number(v) })}>
          <SelectTrigger size="sm" className="ml-2 w-28" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n === 500 ? "All rows" : `${n} rows`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
    </div>
  );
}
