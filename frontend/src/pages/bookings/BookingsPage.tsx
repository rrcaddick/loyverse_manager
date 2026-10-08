/**
 * /bookings — every group booking, server-paged and sorted, with the filter
 * state in the URL (see features/bookings/list-params.ts). The header search
 * lands here as ?q=.
 */

import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { BookOpenText, Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/section";
import { BOOKING_STATUS_META, StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBookingCounts, useBookings } from "@/features/bookings/api";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import {
  PAGE_SIZES,
  RANGE_OPTIONS,
  SORTABLE_COLUMNS,
  hasActiveFilters,
  parseListState,
  toApiParams,
  writeListState,
  type ListState,
  type RangePreset,
} from "@/features/bookings/list-params";
import { HoldExpiryNotice, ProvenanceBadge } from "@/features/bookings/shared";
import type { BookingListItem } from "@/features/bookings/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatRelativeDay, formatWeekday, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BOOKING_STATUSES, type BookingStatus } from "@/types/api";

export default function BookingsPage() {
  useDocumentTitle("Bookings");
  const navigate = useNavigate();
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

  const columns = useMemo<ColumnDef<BookingListItem>[]>(
    () => [
      {
        accessorKey: "reference",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ref" />,
        cell: ({ row }) => (
          <a
            href={`/bookings/${row.original.id}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(`/bookings/${row.original.id}`);
            }}
            className="font-mono text-sm font-medium text-foreground underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
          >
            {row.original.reference}
          </a>
        ),
        meta: { className: "w-24" },
      },
      {
        accessorKey: "group_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Group" />,
        cell: ({ row }) => (
          <div className="grid min-w-0 leading-tight">
            <span className="truncate font-medium text-foreground">{row.original.group_name}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">
                {row.original.contact_name}
                {row.original.area ? ` · ${row.original.area}` : ""}
              </span>
              <ProvenanceBadge source={row.original.source} iconOnly />
            </span>
          </div>
        ),
        meta: { className: "min-w-56 max-w-[28rem]" },
      },
      {
        accessorKey: "visit_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Visit" />,
        cell: ({ row }) => {
          const relative = formatRelativeDay(row.original.visit_date);
          const isRelative = !/\d{4}/.test(relative);
          return (
            <div className="grid leading-tight whitespace-nowrap">
              <span className="tabular text-foreground">{formatDate(row.original.visit_date)}</span>
              <span className={cn("text-xs", isRelative && relative === "Today" ? "font-medium text-primary" : "text-muted-foreground")}>
                {formatWeekday(row.original.visit_date)}
                {isRelative ? ` · ${relative}` : ""}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "people_booked",
        header: ({ column }) => <DataTableColumnHeader column={column} title="People" align="right" />,
        cell: ({ row }) => formatNumber(row.original.people_booked),
        meta: { align: "right", numeric: true },
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-0.5">
            <StatusBadge status={row.original.status} />
            <HoldExpiryNotice booking={row.original} urgentOnly className="text-[11px] leading-4" />
          </div>
        ),
      },
      {
        id: "deposit_due",
        accessorFn: (b) => b.deposit_due,
        header: "Deposit",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.deposit_waived ? (
            <span className="text-muted-foreground">Waived</span>
          ) : (
            <span className={cn(row.original.deposit_covered && "text-success")}>{formatMoney(row.original.deposit_due, { compact: true })}</span>
          ),
        meta: { align: "right", numeric: true, label: "Deposit due" },
      },
      {
        id: "paid_total",
        accessorFn: (b) => b.paid_total,
        header: "Paid",
        enableSorting: false,
        cell: ({ row }) => (row.original.paid_total > 0 ? formatMoney(row.original.paid_total, { compact: true }) : <span className="text-muted-foreground">—</span>),
        meta: { align: "right", numeric: true },
      },
      {
        id: "balance_due",
        accessorFn: (b) => b.balance_due,
        header: "Balance",
        enableSorting: false,
        cell: ({ row }) => (
          <span className={cn(row.original.balance_due <= 0 && row.original.total_amount > 0 && "text-success")}>
            {formatMoney(row.original.balance_due, { compact: true })}
          </span>
        ),
        meta: { align: "right", numeric: true },
      },
      {
        accessorKey: "updated_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last activity" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground" title={formatDateTime(row.original.updated_at)}>
            {formatRelativeDay(row.original.updated_at)}
          </span>
        ),
      },
    ],
    [navigate],
  );

  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Search and filter every group booking. Click a row to open it."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            New booking
          </Button>
        }
      />

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

      <Section flush className={cn("transition-opacity", list.isPlaceholderData && "opacity-80")}>
        <div className="px-4 pt-4 sm:px-5">
          <DataTable
            columns={columns}
            data={items}
            isLoading={list.isPending}
            getRowId={(b) => String(b.id)}
            onRowClick={(b) => navigate(`/bookings/${b.id}`)}
            manualPagination
            rowCount={total}
            paginationState={{ pageIndex: state.page - 1, pageSize: state.pageSize }}
            onPaginationChange={(updater) => {
              const current = { pageIndex: state.page - 1, pageSize: state.pageSize };
              const next = typeof updater === "function" ? updater(current) : updater;
              const sizeChanged = next.pageSize !== state.pageSize;
              update({ page: sizeChanged ? 1 : next.pageIndex + 1, pageSize: next.pageSize }, false);
            }}
            pageSizeOptions={PAGE_SIZES}
            manualSorting
            sorting={sorting}
            onSortingChange={(updater) => {
              const next = typeof updater === "function" ? updater(sorting) : updater;
              const first = next[0];
              if (!first || !SORTABLE_COLUMNS.has(first.id)) {
                update({ sort: state.range === "upcoming" ? "visit_date" : "-visit_date" });
                return;
              }
              update({ sort: `${first.desc ? "-" : ""}${first.id}` });
            }}
            toolbar={
              <Toolbar
                state={state}
                counts={counts.data}
                onChange={update}
                summary={list.data ? `${formatNumber(total)} ${total === 1 ? "booking" : "bookings"}` : null}
              />
            }
            emptyState={
              <EmptyState
                compact
                icon={BookOpenText}
                title={hasActiveFilters(state) ? "No bookings match these filters" : "No bookings yet"}
                description={hasActiveFilters(state) ? "Try a wider date range or clear the status filter." : "New requests from the form, the inbox or the phone will show up here."}
                action={
                  hasActiveFilters(state) ? (
                    <Button variant="outline" onClick={() => update({ statuses: [], range: "upcoming", q: "", from: "", to: "" })}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button onClick={() => setCreateOpen(true)}>New booking</Button>
                  )
                }
              />
            }
          />
        </div>
      </Section>

      <BookingFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

// ------------------------------------------------------------------ toolbar

interface ToolbarProps {
  state: ListState;
  counts: Partial<Record<BookingStatus, number>> | undefined;
  onChange: (patch: Partial<ListState>) => void;
  summary: string | null;
}

function Toolbar({ state, counts, onChange, summary }: ToolbarProps) {
  const [q, setQ] = useState(state.q);
  const [syncedQ, setSyncedQ] = useState(state.q);
  if (state.q !== syncedQ) {
    // The URL changed underneath us (header search, back button): adopt it.
    setSyncedQ(state.q);
    setQ(state.q);
  }
  useEffect(() => {
    if (q === state.q) return;
    const timer = window.setTimeout(() => onChange({ q: q.trim() }), 350);
    return () => window.clearTimeout(timer);
    // onChange is recreated per render; the debounce only cares about q.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = hasActiveFilters(state);

  return (
    <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
      <form
        role="search"
        className="w-full lg:w-72"
        onSubmit={(e) => {
          e.preventDefault();
          onChange({ q: q.trim() });
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Reference, group, contact, area…"
            aria-label="Search bookings"
            autoComplete="off"
          />
          {q ? (
            <InputGroupAddon align="inline-end">
              <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                <X className="size-3.5" />
              </button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </form>

      <StatusFilter value={state.statuses} counts={counts} onChange={(statuses) => onChange({ statuses })} />

      <Select value={state.range} onValueChange={(v) => onChange({ range: v as RangePreset, sort: v === "upcoming" ? "visit_date" : "-visit_date" })}>
        <SelectTrigger className="w-full lg:w-40" aria-label="Date range">
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

      {state.range === "custom" ? (
        <div className="flex items-center gap-2">
          <Label htmlFor="bookings-from" className="sr-only">
            From
          </Label>
          <Input id="bookings-from" type="date" value={state.from} max={state.to || undefined} onChange={(e) => onChange({ from: e.target.value })} className="w-36 tabular" aria-label="From date" />
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            –
          </span>
          <Label htmlFor="bookings-to" className="sr-only">
            To
          </Label>
          <Input id="bookings-to" type="date" value={state.to} min={state.from || undefined} onChange={(e) => onChange({ to: e.target.value })} className="w-36 tabular" aria-label="To date" />
        </div>
      ) : null}

      {active ? (
        <Button variant="ghost" size="sm" onClick={() => onChange({ statuses: [], range: "upcoming", q: "", from: "", to: "", sort: "visit_date" })}>
          <X data-icon="inline-start" />
          Clear
        </Button>
      ) : null}

      {summary ? (
        <span className="text-sm text-muted-foreground tabular lg:ml-auto" aria-live="polite">
          {summary}
        </span>
      ) : null}
    </div>
  );
}

function StatusFilter({
  value,
  counts,
  onChange,
}: {
  value: BookingStatus[];
  counts: Partial<Record<BookingStatus, number>> | undefined;
  onChange: (next: BookingStatus[]) => void;
}) {
  const label =
    value.length === 0 ? "Any status" : value.length === 1 ? BOOKING_STATUS_META[value[0]!].label : `${value.length} statuses`;
  const activeSet: BookingStatus[] = ["enquiry", "proforma_sent", "confirmed"];
  const isActiveSet = value.length === activeSet.length && activeSet.every((s) => value.includes(s));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("w-full justify-between lg:w-44", value.length > 0 && "border-primary/40 bg-primary/5")} aria-label={`Filter by status: ${label}`}>
          <span className="truncate">{label}</span>
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1 p-2">
        <button
          type="button"
          onClick={() => onChange(isActiveSet ? [] : activeSet)}
          className={cn(
            "flex h-8 items-center justify-between rounded-md px-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
            isActiveSet && "bg-primary/10 font-medium",
          )}
        >
          Active (enquiry, proforma, confirmed)
          {isActiveSet ? <Check aria-hidden="true" className="size-4 text-primary" /> : null}
        </button>
        <div className="my-1 h-px bg-border" role="separator" />
        {BOOKING_STATUSES.map((status) => {
          const id = `status-${status}`;
          const checked = value.includes(status);
          return (
            <div key={status} className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-muted">
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(next) => onChange(next ? [...value, status] : value.filter((s) => s !== status))}
              />
              <Label htmlFor={id} className="flex flex-1 cursor-pointer items-center justify-between font-normal">
                <StatusBadge status={status} />
                <span className="text-xs text-muted-foreground tabular">{counts ? formatNumber(counts[status] ?? 0) : ""}</span>
              </Label>
            </div>
          );
        })}
        {value.length > 0 ? (
          <Button variant="ghost" size="sm" className="mt-1 justify-start" onClick={() => onChange([])}>
            Clear status filter
          </Button>
        ) : null}
        <p className="sr-only">{pluralise(value.length, "status selected", "statuses selected")}</p>
      </PopoverContent>
    </Popover>
  );
}
