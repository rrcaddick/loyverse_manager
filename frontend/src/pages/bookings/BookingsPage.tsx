/**
 * /bookings — one list split by status (spec §6): SegmentedTabs with counts
 * from GET /bookings/counts (Pending · Confirmed · Lapsed · Past · All),
 * one search box, an Upcoming / This month / Past / All dates range, a
 * per-tab default sort, 25 rows a page. State lives in the URL
 * (features/bookings/list-params.ts); the header search lands as ?q=.
 * Cards on a phone, a 48 px DataTable otherwise.
 */

import type { SortingState } from "@tanstack/react-table";
import { BookOpenText, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBookingCounts, useBookings } from "@/features/bookings/api";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import { BookingCards } from "@/features/bookings/components/list-cards";
import { columnsFor } from "@/features/bookings/components/list-columns";
import { PAGE_SIZE, RANGE_OPTIONS, SORTABLE_COLUMNS, TAB_DEFAULTS, hasActiveFilters, parseListState, stateForTab, toApiParams, writeListState, type ListState, type RangePreset } from "@/features/bookings/list-params";
import type { BookingBucket } from "@/features/bookings/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useIsMobile } from "@/hooks/use-mobile";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const TAB_LABELS: Record<BookingBucket, string> = { pending: "Pending", confirmed: "Confirmed", lapsed: "Lapsed", past: "Past", all: "All" };

const EMPTY_COPY: Record<BookingBucket, { title: string; hint: string }> = {
  pending: { title: "Nothing pending", hint: "New requests from the form, the inbox or the phone land here until the deposit arrives." },
  confirmed: { title: "No confirmed visits", hint: "A booking moves here when its deposit is recorded or matched from the bank." },
  lapsed: { title: "Nothing lapsed or cancelled", hint: "Holds that expire without a deposit, and cancellations, are kept here." },
  past: { title: "No past visits yet", hint: "Completed visits and no-shows are kept here." },
  all: { title: "No bookings yet", hint: "New requests from the form, the inbox or the phone will show up here." },
};

export default function BookingsPage() {
  useDocumentTitle("Bookings");
  const navigate = useNavigate();
  const isMobile = useIsMobile();
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

  return (
    <>
      <PageHeader
        title="Bookings"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            New booking
          </Button>
        }
      >
        <SegmentedTabs
          aria-label="Booking buckets"
          value={state.tab}
          onChange={(tab) => setParams(writeListState(stateForTab(state, tab), params), { replace: true })}
          items={[
            { value: "pending", label: TAB_LABELS.pending, count: c?.pending },
            { value: "confirmed", label: TAB_LABELS.confirmed, count: c?.confirmed },
            { value: "lapsed", label: TAB_LABELS.lapsed, count: c?.lapsed },
            { value: "past", label: TAB_LABELS.past, count: c?.past },
            { value: "all", label: TAB_LABELS.all, count: c?.all },
          ]}
        />
      </PageHeader>

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

      <Toolbar state={state} onChange={update} summary={list.data ? `${formatNumber(total)} ${total === 1 ? "booking" : "bookings"}` : null} />

      {isMobile ? (
        list.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyBookings state={state} onClear={() => update({ range: TAB_DEFAULTS[state.tab].range, q: "" })} onCreate={() => setCreateOpen(true)} />
        ) : (
          <>
            <BookingCards items={items} tab={state.tab} />
            {total > PAGE_SIZE ? (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <Button variant="outline" size="sm" disabled={state.page <= 1} onClick={() => update({ page: state.page - 1 }, false)}>
                  Previous
                </Button>
                <span className="tabular">
                  Page {state.page} of {Math.ceil(total / PAGE_SIZE)}
                </span>
                <Button variant="outline" size="sm" disabled={state.page * PAGE_SIZE >= total} onClick={() => update({ page: state.page + 1 }, false)}>
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )
      ) : (
        <section className={cn("rounded-xl bg-card px-4 pt-1 pb-3 ring-1 ring-border transition-opacity sm:px-5", list.isPlaceholderData && "opacity-80")} aria-label={`${TAB_LABELS[state.tab]} bookings`}>
          <DataTable
            key={state.tab}
            columns={columns}
            data={items}
            isLoading={list.isPending}
            getRowId={(b) => String(b.id)}
            onRowClick={(b) => navigate(`/bookings/${b.id}`)}
            rowClassName={() => "h-row-lg"}
            manualPagination
            rowCount={total}
            pageSize={PAGE_SIZE}
            pageSizeOptions={[PAGE_SIZE]}
            paginationState={{ pageIndex: state.page - 1, pageSize: PAGE_SIZE }}
            onPaginationChange={(updater) => {
              const current = { pageIndex: state.page - 1, pageSize: PAGE_SIZE };
              const next = typeof updater === "function" ? updater(current) : updater;
              update({ page: next.pageIndex + 1 }, false);
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
            emptyState={<EmptyBookings state={state} onClear={() => update({ range: TAB_DEFAULTS[state.tab].range, q: "" })} onCreate={() => setCreateOpen(true)} />}
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

interface ToolbarProps {
  state: ListState;
  onChange: (patch: Partial<ListState>) => void;
  summary: string | null;
}

function Toolbar({ state, onChange, summary }: ToolbarProps) {
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

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <form
        role="search"
        className="w-full sm:w-80"
        onSubmit={(e) => {
          e.preventDefault();
          onChange({ q: q.trim() });
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, group, contact, phone, area" aria-label="Search bookings" autoComplete="off" />
          {q ? (
            <InputGroupAddon align="inline-end">
              <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection-ring">
                <X className="size-3.5" />
              </button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </form>

      <Select value={state.range} onValueChange={(v) => onChange({ range: v as RangePreset })}>
        <SelectTrigger className="w-full sm:w-40" aria-label="Date range">
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

      {hasActiveFilters(state) ? (
        <Button variant="ghost" size="sm" onClick={() => onChange({ range: TAB_DEFAULTS[state.tab].range, q: "" })}>
          <X data-icon="inline-start" />
          Clear
        </Button>
      ) : null}

      {summary ? (
        <span className="text-sm tabular text-muted-foreground sm:ml-auto" aria-live="polite">
          {summary}
        </span>
      ) : null}
    </div>
  );
}
