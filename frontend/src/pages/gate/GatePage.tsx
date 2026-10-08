/**
 * /gate — the POS tooling shared by admin and manager (spec §1): today's
 * arrivals (the same table as Today, compact), the open tickets at the
 * tills, and the morning Loyverse sync with a "Run morning sync" button
 * for admins. Data: GET /gate (every 30 s), POST /ops/run {add_inventory}.
 */

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Car, DoorOpen, Play, ReceiptText, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { BigNumber, BigNumberRow } from "@/components/big-number";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { KeyValue, type KeyValueItem } from "@/components/key-value";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/section-header";
import { StatusPill, type StatusTone } from "@/components/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { rowsFromGate, useGate } from "@/features/gate/api";
import type { GateSync, OpenTicket, SyncStatus } from "@/features/gate/types";
import { useRunJob } from "@/features/ops/api";
import { sortDayRows } from "@/features/today/api";
import { DayTable } from "@/features/today/components/day-table";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatDuration, formatMoney, formatNumber, formatRelativeDay, formatTime, pluralise, todayIso } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export default function GatePage() {
  useDocumentTitle("Gate");
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const date = todayIso();
  const gate = useGate(date);
  const run = useRunJob();
  const [runOpen, setRunOpen] = useState(false);
  const data = gate.data;
  const rows = useMemo(() => sortDayRows(rowsFromGate(data?.arrivals.bookings ?? [])), [data]);
  const t = data?.arrivals.totals;

  return (
    <>
      <PageHeader
        title="Gate"
        description="Arrivals today, open tickets at the tills and the morning Loyverse sync."
        actions={
          <>
            <Button variant="outline" onClick={() => gate.refetch()} disabled={gate.isFetching}>
              <RefreshCw data-icon="inline-start" className={cn(gate.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button variant="outline" asChild>
              <Link to="/today">
                Today
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </>
        }
      />

      {gate.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load the gate</AlertTitle>
          <AlertDescription>{errorMessage(gate.error)}</AlertDescription>
        </Alert>
      ) : null}

      <BigNumberRow columns={isAdmin ? 4 : 3}>
        <BigNumber label="Groups today" value={t ? formatNumber(t.groups) : ""} detail={t ? `${formatNumber(t.arrived_groups)} arrived` : undefined} loading={!t} />
        <BigNumber label="Expected" value={t ? formatNumber(t.expected_people) : ""} detail={t ? `${formatNumber(t.confirmed_people)} confirmed` : undefined} loading={!t} />
        <BigNumber label="Arrived" value={t ? formatNumber(t.arrived_people) : ""} detail={t ? `of ${formatNumber(t.expected_people)} expected` : undefined} tone={t && t.arrived_people > 0 ? "green" : "neutral"} loading={!t} />
        {isAdmin ? (
          <BigNumber label="Owed at the gate" value={t ? formatMoney(t.balance_due_total, { compact: true }) : ""} detail={t ? "balances to collect" : undefined} tone={t && t.balance_due_total > 0 ? "amber" : "neutral"} loading={!t} />
        ) : null}
      </BigNumberRow>

      <section className="overflow-hidden rounded-xl bg-card ring-1 ring-border" aria-labelledby="gate-arrivals">
        <div className="px-card pt-2">
          <SectionHeader
            id="gate-arrivals"
            icon={DoorOpen}
            tone="accent"
            title="Arrivals"
            count={t?.groups}
            description={data?.arrivals.is_closed ? "The park is closed today." : undefined}
            rule={false}
          />
        </div>
        <DayTable
          rows={rows}
          loading={!data}
          compact
          showMoney={isAdmin}
          canOpenBooking={isAdmin}
          emptyState={<EmptyState variant="inline" title="No groups today." link={{ to: "/today", label: "Open Today" }} />}
        />
      </section>

      <div className="grid items-start gap-card-gap lg:grid-cols-2">
        <OpenTicketsCard tickets={data?.open_tickets} loading={!data} showMoney={isAdmin} />
        <SyncCard sync={data?.sync} loading={!data} canRun={isAdmin} running={run.isPending} onRun={() => setRunOpen(true)} />
      </div>

      <ConfirmDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        title="Run the morning sync now?"
        description="Hides today's Quicket event, then creates today's online tickets and confirmed group items in Loyverse. This can take several minutes; the page waits for it to finish and nothing else is changed."
        confirmLabel="Run morning sync"
        onConfirm={async () => {
          const result = await run.mutateAsync("add_inventory");
          const summary = typeof result.summary === "string" ? result.summary : result.summary ? JSON.stringify(result.summary) : undefined;
          if (result.ok) toast.success(`Morning sync finished in ${formatDuration(result.duration_ms)}`, { description: summary });
          else toast.error("Morning sync failed", { description: result.error ?? summary });
          void qc.invalidateQueries({ queryKey: ["gate"] });
          void qc.invalidateQueries({ queryKey: ["today"] });
        }}
      />
    </>
  );
}

// ------------------------------------------------------------ open tickets

function ticketTitle(ticket: OpenTicket): string {
  return ticket.name || (ticket.ticket_id ? `Ticket ${ticket.ticket_id}` : `Ticket #${ticket.id}`);
}

function vehicleLine(ticket: OpenTicket): string | null {
  const parts = [ticket.plate, [ticket.vehicle_make, ticket.vehicle_model].filter(Boolean).join(" "), ticket.vehicle_colour].filter((p) => p && p.trim());
  return parts.length > 0 ? parts.join(" · ") : null;
}

function OpenTicketsCard({ tickets, loading, showMoney }: { tickets: OpenTicket[] | undefined; loading: boolean; showMoney: boolean }) {
  return (
    <section className="overflow-hidden rounded-xl bg-card ring-1 ring-border" aria-labelledby="gate-tickets">
      <div className="px-card pt-2">
        <SectionHeader id="gate-tickets" icon={ReceiptText} tone="blue" title="Open tickets" count={tickets?.length} description="Held, unpaid tickets at the Loyverse tills, newest change first." />
      </div>
      {loading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : !tickets || tickets.length === 0 ? (
        <EmptyState variant="inline" title="No open tickets at the tills." description="Held tickets appear here while they are open." />
      ) : (
        <ul className="divide-y divide-border">
          {tickets.map((ticket) => {
            const vehicle = vehicleLine(ticket);
            const updated = ticket.updated_at ?? ticket.last_seen_at ?? ticket.opened_at;
            return (
              <li key={ticket.id} className="flex min-h-row-queue items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-foreground">{ticketTitle(ticket)}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {[ticket.device, ticket.employee_id ? `employee ${ticket.employee_id}` : null, ticket.reason].filter(Boolean).join(" · ") || "No device recorded"}
                  </div>
                  {vehicle ? (
                    <div className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                      <Car aria-hidden="true" className="size-3.5 shrink-0" />
                      {vehicle}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right tabular">
                  {showMoney && ticket.total !== null ? <div className="text-body font-medium text-foreground">{formatMoney(ticket.total, { compact: true })}</div> : null}
                  <div className="text-sm text-muted-foreground">
                    {ticket.quantity !== null ? pluralise(ticket.quantity, "item") : ticket.item_count !== null ? pluralise(ticket.item_count, "line") : ""}
                    {updated ? `${ticket.quantity !== null || ticket.item_count !== null ? " · " : ""}${formatRelativeDay(updated)} ${formatTime(updated)}` : ""}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------ morning sync

const SYNC_STATUS: Record<NonNullable<SyncStatus> | "never", { label: string; tone: StatusTone }> = {
  success: { label: "Ran OK", tone: "green" },
  no_event: { label: "No event today", tone: "neutral" },
  failed: { label: "Failed", tone: "red" },
  running: { label: "Running", tone: "blue" },
  never: { label: "Not run yet", tone: "neutral" },
};

/** "1 6 * * *" → "06:01". */
function cronTime(cron: string): string | null {
  const [minute, hour] = cron.trim().split(/\s+/);
  if (!minute || !hour || !/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function when(value: string | null): string {
  if (!value) return "Never";
  const rel = formatRelativeDay(value);
  return rel === "Today" || rel === "Yesterday" ? `${rel}, ${formatTime(value)}` : formatDateTime(value);
}

function SyncCard({ sync, loading, canRun, running, onRun }: { sync: GateSync | undefined; loading: boolean; canRun: boolean; running: boolean; onRun: () => void }) {
  const status = sync ? SYNC_STATUS[sync.status ?? "never"] : null;
  const scheduledAt = sync ? cronTime(sync.cron) : null;
  const clearAt = sync ? cronTime(sync.clear_cron) : null;
  const items: KeyValueItem[] = sync
    ? [
        {
          label: "Schedule",
          value: sync.scheduled ? (
            <span>Daily at {scheduledAt ?? sync.cron}{clearAt ? ` · cleared at ${clearAt}` : ""}</span>
          ) : (
            <span>
              <span className="font-medium">Off</span> — runs by hand only
            </span>
          ),
        },
        { label: "Last run", value: when(sync.last_run_at) },
        { label: "Finished", value: when(sync.finished_at) },
        { label: "Summary", value: sync.summary ? <span className="line-clamp-2 break-words">{sync.summary}</span> : "—" },
        { label: "Clear inventory", value: sync.clear_inventory.last_run_at ? `${when(sync.clear_inventory.last_run_at)} · ${sync.clear_inventory.status ?? "unknown"}` : "Never" },
      ]
    : [];

  return (
    <section className="flex flex-col rounded-xl bg-card ring-1 ring-border" aria-labelledby="gate-sync">
      <div className="px-card pt-2">
        <SectionHeader
          id="gate-sync"
          icon={RefreshCw}
          tone={status?.tone === "red" ? "red" : status?.tone === "green" ? "green" : "neutral"}
          title="Morning sync"
          description="Creates today's Quicket tickets and confirmed groups as Loyverse items."
          actions={status ? <StatusPill tone={status.tone} label={status.label} /> : null}
        />
      </div>
      <div className="px-card py-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <KeyValue layout="table" items={items} />
        )}
      </div>
      {canRun ? (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border bg-nested px-card py-3">
          <span className="text-sm text-muted-foreground">Takes a few minutes; hides today's Quicket event first.</span>
          <Button onClick={onRun} disabled={running || loading}>
            {running ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {running ? "Running…" : "Run morning sync"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
