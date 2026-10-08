/**
 * DayTable — the day's groups as a table (spec §5 day view), shared by Today
 * and Gate: Group (name, ref · type) · Expected (people, arrival time) ·
 * Arrived (count, source, inline Enter) · Balance [admin] · Status · ⋯.
 * Rows are 56 px (48 px compact), sorted by the caller, and a group that
 * has arrived is tinted the lightest green. One ⋯ per row: Fetch from
 * Loyverse, Enter arrivals, Record gate payment, Open booking [admin].
 */

import { useQueryClient } from "@tanstack/react-query";
import { Banknote, Check, ExternalLink, Hash, MoreHorizontal, RefreshCw, TicketX } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useBooking } from "@/features/bookings/api";
import { RecordPaymentDialog } from "@/features/bookings/components/record-payment-dialog";
import { useGroupTypeLabel } from "@/features/bookings/lib";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { formatMoney, formatNumber, formatTime, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { invalidateDayWorld } from "../api";
import type { DayGroupRow } from "../types";
import { ArrivalsPopover } from "./arrivals-popover";

export interface DayTableProps {
  rows: DayGroupRow[];
  loading?: boolean;
  /** 48 px rows (Gate). */
  compact?: boolean;
  /** Show the Balance column and money in menus (admin). */
  showMoney: boolean;
  /** Link names to the booking and offer "Open booking" (admin). */
  canOpenBooking: boolean;
  emptyState?: ReactNode;
  className?: string;
}

export function DayTable({ rows, loading = false, compact = false, showMoney, canOpenBooking, emptyState, className }: DayTableProps) {
  const groupType = useGroupTypeLabel();
  const [arrivals, setArrivals] = useState<{ id: number; fetch: boolean } | null>(null);
  // From the ⋯ menu the popover opens once the menu has closed (onCloseAutoFocus),
  // otherwise the menu's focus return would dismiss it at once.
  const pendingArrivals = useRef<{ id: number; fetch: boolean } | null>(null);
  const payment = useSubjectDialog<DayGroupRow>();
  const rowHeight = compact ? "h-row-lg" : "h-row-queue";
  const columns = showMoney ? 6 : 5;

  return (
    <TooltipProvider>
      <Table className={cn("table-fixed [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-3 [&_th:first-child]:pl-3", className)}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={showMoney ? "w-[27%]" : "w-[36%]"}>Group</TableHead>
            <TableHead className="w-[15%]">Expected</TableHead>
            <TableHead className="w-[16%]">Arrived</TableHead>
            {showMoney ? <TableHead className="w-[14%] text-right">Balance</TableHead> : null}
            <TableHead className={showMoney ? "w-[21%]" : "w-[26%]"}>Status</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i} className={cn(rowHeight, "hover:bg-transparent")}>
                {Array.from({ length: columns }).map((_, j) => (
                  <TableCell key={j} className="py-1">
                    <Skeleton className="h-4 w-3/4" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns} className="p-0">
                {emptyState ?? <div className="p-6 text-center text-sm text-muted-foreground">No groups on this day</div>}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const arrived = row.arrived_count !== null && row.arrived_count > 0;
              const ticketMissing = (row.status === "confirmed" || row.status === "completed") && !row.ticket_sent;
              const open = arrivals?.id === row.id;
              return (
                <TableRow key={row.id} className={cn(rowHeight, arrived && "bg-green-soft/40 hover:bg-green-soft/60")}>
                  <TableCell className="py-1">
                    <div className="min-w-0">
                      <div className="truncate text-body font-semibold text-foreground">
                        {canOpenBooking ? (
                          <Link to={`/bookings/${row.id}`} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-selection-ring">
                            {row.group_name}
                          </Link>
                        ) : (
                          row.group_name
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{row.reference}</span>
                        {row.group_type ? ` · ${groupType(row.group_type)}` : ""}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="py-1">
                    <div className="text-body font-medium text-foreground tabular">{formatNumber(row.people_booked)}</div>
                    <div className="truncate text-xs text-muted-foreground tabular">
                      {row.arrival_time ? `arrives ${row.arrival_time}` : "time not set"}
                      {row.vehicles ? ` · ${pluralise(row.vehicles, "vehicle")}` : ""}
                    </div>
                  </TableCell>

                  <TableCell className="py-1">
                    <ArrivalsPopover
                      row={row}
                      open={open}
                      autoFetch={open && !!arrivals?.fetch}
                      onOpenChange={(next) => setArrivals(next ? { id: row.id, fetch: false } : null)}
                      anchor={
                        <div className="flex min-w-0 items-center gap-2">
                          {row.arrived_count !== null ? (
                            <div className="min-w-0">
                              <div className={cn("text-body font-medium tabular", arrived ? "text-green-text" : "text-foreground")}>{formatNumber(row.arrived_count)}</div>
                              <div className="truncate text-xs text-muted-foreground tabular">
                                {row.arrived_source === "loyverse" ? "Loyverse" : "Entered"}
                                {row.arrived_at ? ` · ${formatTime(row.arrived_at)}` : ""}
                              </div>
                            </div>
                          ) : (
                            <>
                              <span className="text-body text-faint-foreground">—</span>
                              <Button variant="outline" size="sm" onClick={() => setArrivals({ id: row.id, fetch: false })} aria-label={`Enter arrivals for ${row.reference}`}>
                                Enter
                              </Button>
                            </>
                          )}
                        </div>
                      }
                    />
                  </TableCell>

                  {showMoney ? (
                    <TableCell className="py-1 text-right">
                      {row.balance_due > 0 ? (
                        <>
                          <div className="text-body font-medium text-amber-text tabular">{formatMoney(row.balance_due, { compact: true })}</div>
                          <div className="text-xs text-muted-foreground tabular">{row.paid_total > 0 ? `${formatMoney(row.paid_total, { compact: true })} paid` : "nothing paid"}</div>
                        </>
                      ) : (
                        <div className="inline-flex items-center gap-1 text-body font-medium text-green-text">
                          <Check aria-hidden="true" className="size-4" />
                          Paid
                        </div>
                      )}
                    </TableCell>
                  ) : null}

                  <TableCell className="py-1 pr-1">
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={row.status} className="min-w-0" />
                      {ticketMissing ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex text-muted-foreground" tabIndex={0} aria-label="Vehicle ticket not sent yet">
                              <TicketX aria-hidden="true" className="size-4" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Vehicle ticket not sent yet</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  </TableCell>

                  <TableCell className="py-1 pr-1 pl-0 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.reference}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-56"
                        onCloseAutoFocus={(event) => {
                          if (pendingArrivals.current) {
                            event.preventDefault();
                            setArrivals(pendingArrivals.current);
                            pendingArrivals.current = null;
                          }
                        }}
                      >
                        <DropdownMenuItem
                          onSelect={() => {
                            pendingArrivals.current = { id: row.id, fetch: true };
                          }}
                        >
                          <RefreshCw />
                          Fetch from Loyverse
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            pendingArrivals.current = { id: row.id, fetch: false };
                          }}
                        >
                          <Hash />
                          Enter arrivals
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => payment.show(row)}>
                          <Banknote />
                          Record gate payment
                        </DropdownMenuItem>
                        {canOpenBooking ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <Link to={`/bookings/${row.id}`}>
                                <ExternalLink />
                                Open booking
                              </Link>
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {payment.subject ? <GatePaymentDialog row={payment.subject} open={payment.open} onOpenChange={payment.onOpenChange} /> : null}
    </TooltipProvider>
  );
}

/** The shared payment dialog in gate mode, with the booking's finance loaded first so the amount prefills. */
function GatePaymentDialog({ row, open, onOpenChange }: { row: DayGroupRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const detail = useBooking(open ? row.id : null);
  const ready = detail.isSuccess || detail.isError;
  return (
    <RecordPaymentDialog
      open={open && ready}
      onOpenChange={(next) => {
        if (!next) invalidateDayWorld(qc);
        onOpenChange(next);
      }}
      mode="gate"
      booking={{ id: row.id, reference: row.reference, group_name: row.group_name, finance: detail.data?.finance ?? null }}
    />
  );
}
