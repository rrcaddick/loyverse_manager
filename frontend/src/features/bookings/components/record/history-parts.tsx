/**
 * The pieces of a group's history, shared by the booking's History tab and
 * the group page (6 Nov 2026): the numbers across the top and the table of
 * visits, one row per booking, rows open the record.
 */

import { History } from "lucide-react";
import { useNavigate } from "react-router";

import { BigNumber, BigNumberRow } from "@/components/big-number";
import { StatusPill } from "@/components/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateShort, formatMoney, formatNumber, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { HistorySummary, HistoryVisit } from "../../types";

export function SummaryNumbers({ summary: s }: { summary: HistorySummary }) {
  const last = s.last;
  const onTime = s.deposit_on_time;
  const reliability = s.cancellations === 0 ? { label: "Never cancelled", tone: "green" as const } : { label: `${pluralise(s.cancellations, "time")} out of ${s.visits + s.cancellations}`, tone: s.cancellations > s.visits ? ("red" as const) : ("amber" as const) };
  return (
    <BigNumberRow columns={4}>
      <BigNumber label="Visits" value={formatNumber(s.visits)} badge={s.first_year ? <StatusPill tone="neutral" label={`Since ${s.first_year}`} size="sm" dot={false} /> : undefined} />
      <BigNumber
        label="Turnout"
        value={s.turnout_avg_pct !== null ? `${s.turnout_avg_pct}%` : "—"}
        badge={last && last.arrived !== null && last.booked ? <StatusPill tone="neutral" label={`Last ${last.arrived} of ${last.booked}`} size="sm" dot={false} /> : undefined}
        tone={s.turnout_avg_pct === null ? "neutral" : s.turnout_avg_pct >= 90 ? "green" : s.turnout_avg_pct >= 70 ? "amber" : "red"}
      />
      <BigNumber
        label="Deposit"
        value={s.deposit_days_avg !== null ? `${s.deposit_days_avg} d` : "—"}
        badge={onTime ? <StatusPill tone={onTime.on_time === onTime.of ? "green" : onTime.on_time === 0 ? "red" : "amber"} label={onTime.on_time === onTime.of ? "On time" : `${onTime.on_time} of ${onTime.of} on time`} size="sm" dot={false} /> : undefined}
        tone={onTime ? (onTime.on_time === onTime.of ? "green" : onTime.on_time === 0 ? "red" : "amber") : "neutral"}
      />
      <BigNumber label="Cancellations" value={formatNumber(s.cancellations)} badge={<StatusPill tone={reliability.tone} label={reliability.label} size="sm" dot={false} />} tone={s.cancellations === 0 ? "green" : reliability.tone} />
    </BigNumberRow>
  );
}

function days(n: number | null): string {
  return n === null ? "—" : `${n} d`;
}

export function VisitsTable({ visits, title = "Other bookings", emptyText = "No other bookings for this group yet." }: { visits: HistoryVisit[]; title?: string; emptyText?: string }) {
  const navigate = useNavigate();
  const th = "h-thead text-label text-table-head-foreground uppercase";
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-section flex items-center gap-2 text-foreground">
        <History aria-hidden="true" className="size-4 text-muted-foreground" />
        {title}
        {visits.length ? <span className="text-sm font-normal tabular text-muted-foreground">({visits.length})</span> : null}
      </h2>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
        <Table>
          <TableHeader className="bg-table-head text-table-head-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(th, "pl-5")}>Date</TableHead>
              <TableHead className={th}>Reference</TableHead>
              <TableHead className={th}>Booked as</TableHead>
              <TableHead className={cn(th, "text-right")}>Booked</TableHead>
              <TableHead className={cn(th, "text-right")}>Arrived</TableHead>
              <TableHead className={cn(th, "text-right")}>Proforma</TableHead>
              <TableHead className={cn(th, "text-right")}>Deposit</TableHead>
              <TableHead className={cn(th, "text-right")}>Paid</TableHead>
              <TableHead className={cn(th, "pr-5")}>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visits.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9} className="py-6 pl-5 text-sm text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              visits.map((v) => (
                <TableRow key={v.id} tabIndex={0} onClick={() => navigate(`/bookings/${v.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/bookings/${v.id}`)} className="cursor-pointer">
                  <TableCell className="pl-5 whitespace-nowrap tabular">
                    {v.visit_date ? `${formatDateShort(v.visit_date)} ${v.visit_date.slice(0, 4)}` : "—"}
                    {v.relation === "upcoming" ? <span className="ml-2 text-xs text-muted-foreground uppercase">Upcoming</span> : null}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{v.reference}</TableCell>
                  <TableCell className="max-w-56">
                    <span className="block truncate">{v.group_name}</span>
                    {v.contact_name ? (
                      <span className="block truncate text-sm text-muted-foreground">
                        {v.contact_name}
                        {v.same_contact ? " · same person" : ""}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular">{v.booked !== null ? formatNumber(v.booked) : "—"}</TableCell>
                  <TableCell className="text-right tabular">
                    {v.arrived !== null ? formatNumber(v.arrived) : "—"}
                    {v.turnout_pct !== null ? <span className="ml-1 text-sm text-muted-foreground">({v.turnout_pct}%)</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular">{days(v.proforma_days)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular">
                    {days(v.deposit_days)}
                    {v.deposit_on_time !== null ? <StatusPill tone={v.deposit_on_time ? "green" : "amber"} label={v.deposit_on_time ? "On time" : "Late"} size="sm" dot={false} className="ml-2" /> : null}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular">
                    {formatMoney(v.paid_total, { compact: true })}
                    {v.refunded > 0 ? <span className="ml-1 text-sm text-red-text">−{formatMoney(v.refunded, { compact: true })}</span> : null}
                    {v.settled && v.relation === "past" ? <span className="block text-xs text-muted-foreground">{v.settled === "short" ? "not in full" : `settled ${v.settled}`}</span> : null}
                  </TableCell>
                  <TableCell className="pr-5 whitespace-nowrap">
                    <StatusPill status={v.status} size="sm" />
                    {v.exit?.days_before_visit !== null && v.exit?.days_before_visit !== undefined ? <span className="ml-2 text-sm text-muted-foreground">{v.exit.days_before_visit} d before</span> : null}
                    {v.reminders_sent > 0 ? <span className="block text-xs text-muted-foreground">{pluralise(v.reminders_sent, "reminder")}</span> : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
