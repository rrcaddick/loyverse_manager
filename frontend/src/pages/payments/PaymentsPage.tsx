/**
 * /payments — bank transactions with their match state. Filters and the open
 * transaction live in the URL (?status&type&from&to&q&page&tx) so the queue
 * can deep-link into a row.
 */

import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { AlertCircle, Banknote, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePaymentsSummary, useSyncBank, useTransactions } from "@/features/payments/api";
import { DateRangeFilter } from "@/features/payments/date-range-filter";
import { MatchStatusBadge } from "@/features/payments/match-status-badge";
import { TransactionDrawer } from "@/features/payments/transaction-drawer";
import { MATCH_STATUSES, MATCH_STATUS_META, type BankTransaction, type MatchStatus, type PaymentsSummary, type TransactionFilters } from "@/features/payments/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatRelativeDay, formatTime, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

export default function PaymentsPage() {
  useDocumentTitle("Payments");
  const [params, setParams] = useSearchParams();

  const filters: TransactionFilters = useMemo(() => {
    const status = params.get("status") ?? "";
    const type = params.get("type") ?? "";
    return {
      status: (MATCH_STATUSES as string[]).includes(status) ? (status as MatchStatus) : "",
      type: type === "credit" || type === "debit" ? type : "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      q: params.get("q") ?? "",
      page: Math.max(1, Number(params.get("page") ?? "1") || 1),
      page_size: PAGE_SIZE,
    };
  }, [params]);
  const openId = params.get("tx") ? Number(params.get("tx")) || null : null;

  const update = useCallback(
    (changes: Partial<Record<"status" | "type" | "from" | "to" | "q" | "page" | "tx", string | number | null>>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "" || value === undefined || (key === "page" && Number(value) <= 1)) next.delete(key);
        else next.set(key, String(value));
      }
      if (!("page" in changes) && !("tx" in changes)) next.delete("page");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const summary = usePaymentsSummary();
  const list = useTransactions(filters);
  const sync = useSyncBank();
  const [pollOpen, setPollOpen] = useState(false);
  const [draft, setDraft] = useState(filters.q);
  const [lastQ, setLastQ] = useState(filters.q);
  if (filters.q !== lastQ) {
    setLastQ(filters.q);
    setDraft(filters.q);
  }

  const columns = useMemo<ColumnDef<BankTransaction>[]>(
    () => [
      {
        accessorKey: "booking_date",
        header: "Date",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular" title={row.original.value_date ? `Value date ${formatDate(row.original.value_date)}` : undefined}>
            {formatDate(row.original.booking_date)}
          </span>
        ),
        meta: { className: "w-28" },
      },
      {
        id: "description",
        header: "Description",
        cell: ({ row }) => (
          <div className="min-w-0 max-w-md">
            <button
              type="button"
              data-no-row-click
              onClick={() => update({ tx: row.original.id })}
              className="block max-w-full truncate rounded-sm text-left font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              title={row.original.description}
            >
              {row.original.description}
            </button>
            {row.original.end_to_end_id ? <span className="block truncate font-mono text-xs text-muted-foreground">{row.original.end_to_end_id}</span> : null}
          </div>
        ),
      },
      {
        accessorKey: "amount",
        header: "Amount",
        meta: { align: "right", className: "w-32" },
        cell: ({ row }) => {
          const credit = row.original.credit_debit === "CREDIT";
          return <span className={cn("whitespace-nowrap font-medium", credit ? "text-primary" : "text-muted-foreground")}>{credit ? "" : "−"}{formatMoney(row.original.amount)}</span>;
        },
      },
      {
        accessorKey: "balance_after",
        header: "Balance",
        meta: { align: "right", className: "hidden w-32 xl:table-cell" },
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatMoney(row.original.balance_after)}</span>,
      },
      {
        accessorKey: "match_status",
        header: "Status",
        meta: { className: "w-36" },
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <MatchStatusBadge status={row.original.match_status} />
            {row.original.match_status === "suggested" && row.original.suggestions.length > 1 ? (
              <span className="text-xs text-muted-foreground tabular">{row.original.suggestions.length}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: "booking",
        header: "Booking",
        cell: ({ row }) => {
          const t = row.original;
          if (t.matched_booking) {
            return (
              <Link to={`/bookings/${t.matched_booking.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                <span className="font-medium tabular">{t.matched_booking.reference}</span>
                <span className="truncate text-muted-foreground">{t.matched_booking.group_name}</span>
              </Link>
            );
          }
          if (t.match_status === "suggested" && t.suggestions[0]) {
            return (
              <span className="inline-flex max-w-full items-center gap-1.5 text-muted-foreground">
                <span className="tabular">{t.suggestions[0].reference}?</span>
                <span className="truncate">{t.suggestions[0].group_name}</span>
              </span>
            );
          }
          if (t.match_status === "ignored") return <span className="truncate text-xs text-muted-foreground">{t.ignore_reason || "Ignored"}</span>;
          return <span className="text-muted-foreground">—</span>;
        },
      },
    ],
    [update],
  );

  const pagination: PaginationState = { pageIndex: filters.page - 1, pageSize: PAGE_SIZE };
  const activeFilters = [filters.status, filters.type, filters.from, filters.to, filters.q].filter(Boolean).length;

  async function poll() {
    const result = await sync.mutateAsync();
    toast.success(`Bank polled: ${formatNumber(result.new_entries)} new of ${formatNumber(result.entries)}`, {
      description: `${result.matching.matched} matched · ${result.matching.suggested} suggested · ${result.matching.unmatched} unmatched`,
    });
  }

  return (
    <>
      <PageHeader
        title="Payments"
        description="Bank credits matched against deposits and balances. The account is polled every five minutes; strong reference matches record themselves."
        actions={
          <Button variant="outline" onClick={() => setPollOpen(true)} disabled={sync.isPending}>
            <RefreshCw data-icon="inline-start" className={cn(sync.isPending && "animate-spin")} />
            {sync.isPending ? "Polling…" : "Poll now"}
          </Button>
        }
      />

      <SummaryRow summary={summary.data} isPending={summary.isPending} error={summary.error} onFilter={(status) => update({ status: filters.status === status ? "" : status })} activeStatus={filters.status} onRetry={() => void summary.refetch()} />

      <Section flush>
        <DataTable
          columns={columns}
          data={list.data?.items ?? []}
          isLoading={list.isPending}
          getRowId={(t) => String(t.id)}
          onRowClick={(t) => update({ tx: t.id })}
          isRowActive={(t) => t.id === openId}
          manualPagination
          rowCount={list.data?.total ?? 0}
          paginationState={pagination}
          onPaginationChange={(updater) => {
            const next = typeof updater === "function" ? updater(pagination) : updater;
            update({ page: next.pageIndex + 1 });
          }}
          pageSizeOptions={[PAGE_SIZE]}
          emptyState={
            list.isError ? (
              <EmptyState compact icon={AlertCircle} title="Could not load transactions" description={errorMessage(list.error)} action={<Button variant="outline" size="sm" onClick={() => void list.refetch()}>Try again</Button>} />
            ) : (
              <EmptyState compact icon={Banknote} title="No transactions match" description={activeFilters ? "Try widening the filters." : "Nothing has been polled from the bank yet."} action={activeFilters ? <Button variant="outline" size="sm" onClick={() => update({ status: "", type: "", from: "", to: "", q: "" })}>Clear filters</Button> : undefined} />
            )
          }
          toolbar={
            <div className="flex w-full flex-wrap items-center gap-2 px-4 pt-3">
              <Select value={filters.status || "all"} onValueChange={(v) => update({ status: v === "all" ? "" : v })}>
                <SelectTrigger size="sm" className="w-40" aria-label="Match status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {MATCH_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {MATCH_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex h-7 items-center gap-2 rounded-lg border border-border px-2.5">
                <Switch id="credits-only" size="sm" checked={filters.type === "credit"} onCheckedChange={(v) => update({ type: v ? "credit" : "" })} />
                <Label htmlFor="credits-only" className="text-[0.8rem] font-normal">
                  Credits only
                </Label>
              </div>
              <DateRangeFilter from={filters.from} to={filters.to} onChange={(r) => update({ from: r.from, to: r.to })} />
              <form
                role="search"
                className="ml-auto w-full sm:w-64"
                onSubmit={(e) => {
                  e.preventDefault();
                  update({ q: draft.trim() });
                }}
              >
                <InputGroup className="h-7">
                  <InputGroupAddon>
                    <Search aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="search"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => draft.trim() !== filters.q && update({ q: draft.trim() })}
                    placeholder="Description, reference or exact amount"
                    aria-label="Search transactions"
                    className="text-[0.8rem]"
                  />
                  {draft ? (
                    <InputGroupAddon align="inline-end">
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => { setDraft(""); update({ q: "" }); }}>
                        <X />
                      </Button>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
              </form>
              {activeFilters > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => { setDraft(""); update({ status: "", type: "", from: "", to: "", q: "" }); }}>
                  <X data-icon="inline-start" />
                  Clear
                </Button>
              ) : null}
            </div>
          }
        />
      </Section>

      <TransactionDrawer id={openId} onClose={() => update({ tx: null, page: filters.page })} />
      <ConfirmDialog
        open={pollOpen}
        onOpenChange={setPollOpen}
        title="Poll the bank now?"
        description="Fetches the latest FNB transactions. Credits with a clear booking reference are recorded as payments automatically; everything else lands in the queue."
        confirmLabel="Poll now"
        onConfirm={poll}
      />
    </>
  );
}

// ----------------------------------------------------------------- summary

function SummaryRow({
  summary,
  isPending,
  error,
  onFilter,
  activeStatus,
  onRetry,
}: {
  summary: PaymentsSummary | undefined;
  isPending: boolean;
  error: unknown;
  onFilter: (status: MatchStatus) => void;
  activeStatus: MatchStatus | "";
  onRetry: () => void;
}) {
  if (isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
        <span>Summary unavailable: {errorMessage(error)}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  const poll = summary.last_poll;
  const pollTone = !poll ? "neutral" : poll.error || poll.status === "failed" ? "red" : "green";
  const pollLabel = !poll ? "Never polled" : poll.error || poll.status === "failed" ? "Failed" : humanise(poll.status ?? "ok");
  const pollWhen = poll?.finished_at ?? poll?.started_at ?? null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {(["suggested", "unmatched", "matched", "ignored"] as MatchStatus[]).map((status) => (
        <StatTile key={status} label={MATCH_STATUS_META[status].label} value={formatNumber(summary.counts[status])} active={activeStatus === status} onClick={() => onFilter(status)} />
      ))}
      <div className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
        <span className="text-xs text-muted-foreground">Unmatched credits, 30 days</span>
        <span className="text-xl font-semibold leading-tight text-foreground">{formatMoney(summary.unmatched_credits_30d.amount, { compact: true })}</span>
        <span className="text-xs text-muted-foreground tabular">{formatNumber(summary.unmatched_credits_30d.count)} credits</span>
      </div>
      <div className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
        <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          Last poll
          <StatusBadge status={pollLabel} label={pollLabel} tone={pollTone} />
        </span>
        <span className="text-xl font-semibold leading-tight text-foreground" title={pollWhen ? formatDateTime(pollWhen) : undefined}>
          {pollWhen ? `${formatRelativeDay(pollWhen)}, ${formatTime(pollWhen)}` : "—"}
        </span>
        <span className="truncate text-xs text-muted-foreground tabular">
          {poll?.error
            ? poll.error
            : poll
              ? `${formatNumber(poll.entries)} entries, ${formatNumber(poll.new_entries)} new · ${formatDate(poll.window_from)} – ${formatDate(poll.window_to)}`
              : "Run a poll to fetch transactions"}
        </span>
      </div>
    </div>
  );
}

function StatTile({ label, value, active, onClick }: { label: string; value: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col gap-1 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-foreground/10 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60",
        active && "bg-primary/5 ring-primary/40",
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold leading-tight text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{active ? "Filtering · click to clear" : "Click to filter"}</span>
    </button>
  );
}
