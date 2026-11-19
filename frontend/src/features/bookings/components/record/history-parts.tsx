/**
 * The pieces of a group's history, shared by the booking's History tab and
 * the group page (6 Nov 2026): the averages across the top as a small
 * dashboard, then an accordion table, one row per booking, where opening a
 * row shows that visit's full story: the timeline from request to the day,
 * the money, reminders, changes and the questions they asked.
 */

import { ChevronDown, ExternalLink, History } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { BigNumber, BigNumberRow } from "@/components/big-number";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateShort, formatMoney, formatNumber, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { HistorySummary, HistoryVisit } from "../../types";

const money = (n: number) => formatMoney(n, { compact: true });

export function SummaryNumbers({ summary: s }: { summary: HistorySummary }) {
  const last = s.last;
  const onTime = s.deposit_on_time;
  const reliability = s.cancellations === 0 ? { label: "Never cancelled", tone: "green" as const } : { label: `${pluralise(s.cancellations, "time")} out of ${s.visits + s.cancellations}`, tone: s.cancellations > s.visits ? ("red" as const) : ("amber" as const) };
  const facts: string[] = [];
  if (s.lead_days_median !== null) facts.push(`Books ${pluralise(s.lead_days_median, "day")} ahead`);
  if (s.typical_month) facts.push(`usually in ${s.typical_month}`);
  if (s.sizes.length > 1) {
    const first = s.sizes[0]?.booked ?? null;
    const latest = s.sizes[s.sizes.length - 1]?.booked ?? null;
    if (first && latest) facts.push(latest > first ? `grown from ${first} to ${latest}` : latest < first ? `down from ${first} to ${latest}` : `steady at ${latest}`);
  }
  if (s.reminders_total > 0) facts.push(`${pluralise(s.reminders_total, "reminder")} over the years`);
  if (s.paid_total > 0) facts.push(`${money(s.paid_total)} paid over the years`);
  facts.push(s.same_person ? "same person booking" : "a different person booked before");
  return (
    <div className="flex flex-col gap-2">
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
      <p className="px-1 text-sm text-muted-foreground">{facts.map((f, i) => (i === 0 ? f : f.charAt(0).toLowerCase() + f.slice(1))).join(" · ")}.</p>
    </div>
  );
}

function days(n: number | null): string {
  return n === null ? "—" : `${n} d`;
}

export function VisitsTable({ visits, title = "Other bookings", emptyText = "No other bookings for this group yet." }: { visits: HistoryVisit[]; title?: string; emptyText?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const th = "h-thead text-label text-table-head-foreground uppercase";
  const toggle = (id: number) => setOpen((cur) => (cur === id ? null : id));
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
              <TableHead className={th}>Outcome</TableHead>
              <TableHead className={cn(th, "w-10 pr-5")}>
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visits.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={10} className="py-6 pl-5 text-sm text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              visits.map((v) => {
                const expanded = open === v.id;
                return (
                  <Fragment key={v.id}>
                    <TableRow
                      tabIndex={0}
                      aria-expanded={expanded}
                      onClick={() => toggle(v.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(v.id);
                        }
                      }}
                      className={cn("cursor-pointer", expanded && "bg-nested/60")}
                    >
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
                        {money(v.paid_total)}
                        {v.refunded > 0 ? <span className="ml-1 text-sm text-red-text">−{money(v.refunded)}</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusPill status={v.status} size="sm" />
                        {v.exit?.days_before_visit !== null && v.exit?.days_before_visit !== undefined ? <span className="ml-2 text-sm text-muted-foreground">{v.exit.days_before_visit} d before</span> : null}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <ChevronDown aria-hidden="true" className={cn("inline size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={10} className="bg-nested/40 px-5 py-4">
                          <VisitDetails visit={v} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- details

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label text-muted-foreground uppercase">{label}</span>
      <span className="text-body text-foreground">{children}</span>
    </div>
  );
}

function VisitDetails({ visit: v }: { visit: HistoryVisit }) {
  const steps: { label: string; when: string | null; note?: string | null; state: "done" | "missed" | "none" }[] = [
    { label: "Requested", when: v.requested_on, state: v.requested_on ? "done" : "none" },
    { label: "Proforma", when: v.proforma_sent_on, note: v.proforma_days !== null ? `after ${days(v.proforma_days)}` : null, state: v.proforma_sent_on ? "done" : "none" },
    {
      label: "Deposit",
      when: v.deposit_paid_on,
      note: v.deposit_paid_on ? `${v.deposit_days !== null ? `after ${days(v.deposit_days)}` : ""}${v.deposit_on_time === true ? " · on time" : v.deposit_on_time === false ? " · late" : ""}` : v.hold_expires_on ? `was due by ${formatDate(v.hold_expires_on)}` : null,
      state: v.deposit_paid_on ? "done" : v.status === "lapsed" || v.status === "cancelled" ? "missed" : "none",
    },
    { label: "Vehicle ticket", when: v.ticket_sent_on, state: v.ticket_sent_on ? "done" : "none" },
    {
      label: "Visit",
      when: v.visit_date,
      note: v.booked !== null ? `${formatNumber(v.booked)} booked${v.arrived !== null ? `, ${formatNumber(v.arrived)} arrived` : ""}${v.lead_days !== null ? ` · booked ${days(v.lead_days)} ahead` : ""}` : null,
      state: v.status === "completed" ? "done" : v.status === "no_show" || v.status === "cancelled" || v.status === "lapsed" ? "missed" : "none",
    },
    { label: "Final invoice", when: v.final_invoice_sent_on, note: v.settled ? (v.settled === "short" ? "never paid in full" : `settled ${v.settled}`) : null, state: v.final_invoice_sent_on ? "done" : "none" },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <ol className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.label} className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3 text-body">
            <span className={cn("text-sm uppercase", s.state === "done" ? "text-foreground" : s.state === "missed" ? "text-red-text" : "text-muted-foreground")}>{s.label}</span>
            <span className={cn(s.state === "none" && !s.note && "text-muted-foreground")}>
              {s.when ? formatDate(s.when) : s.state === "missed" ? "Never" : "—"}
              {s.note ? <span className="text-muted-foreground"> · {s.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Total">{v.total > 0 ? money(v.total) : "—"}</Stat>
          <Stat label="Paid">
            {money(v.paid_total)}
            {v.refunded > 0 ? <span className="text-red-text"> − {money(v.refunded)} refunded</span> : null}
          </Stat>
          <Stat label="Price">
            {money(v.price_per_person)} per visitor{v.discount_per_person > 0 ? <span className="text-muted-foreground"> · {money(v.discount_per_person)} off</span> : null}
          </Stat>
          <Stat label="Along the way">
            {[v.reminders_sent > 0 ? pluralise(v.reminders_sent, "reminder") : null, v.changes_after_proforma > 0 ? `${pluralise(v.changes_after_proforma, "change")} after the proforma` : null].filter(Boolean).join(" · ") || "No reminders, no changes"}
          </Stat>
          {v.exit ? (
            <Stat label="Ended">
              {v.status_label}
              {v.exit.on ? ` ${formatDate(v.exit.on)}` : ""}
              {v.exit.days_before_visit !== null ? <span className="text-muted-foreground"> · {v.exit.days_before_visit} d before the visit</span> : null}
            </Stat>
          ) : null}
        </div>
        {v.questions.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-label text-muted-foreground uppercase">They asked</span>
            <ul className="list-disc space-y-0.5 pl-5 text-body text-foreground">
              {v.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <Button asChild variant="outline" size="sm">
            <Link to={`/bookings/${v.id}`}>
              <ExternalLink data-icon="inline-start" />
              Open {v.reference}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
