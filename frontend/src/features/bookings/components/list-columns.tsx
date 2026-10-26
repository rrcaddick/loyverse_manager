/**
 * One stable set of columns for every bucket (owner's notes, 26 Oct 2026;
 * docs/research/08): the buckets are filters, not different tables. A bucket
 * may add one contextual column:
 *
 *   Ref · Group / contact · Visit · People · Paid · Balance · Status · Latest action
 *   + Pending: Deposit due by   + Past: Arrived   + Lapsed: Reason
 *
 * The reference is the row's primary cell (15 px semibold foreground); money
 * is right-aligned in tabular figures; the latest action is text with its
 * date under it, and says who acted.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router";

import { DataTableColumnHeader } from "@/components/data-table";
import { StatusPill } from "@/components/status-pill";
import { formatDate, formatDateShort, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { daysFromToday, holdState, relativeDays, relativeTo } from "../lib";
import type { BookingBucket, BookingListItem } from "../types";

type Col = ColumnDef<BookingListItem>;

const money = (n: number) => formatMoney(n, { compact: true });
const CELL = "py-1.5";

const ref: Col = {
  accessorKey: "reference",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Ref" />,
  cell: ({ row }) => (
    <Link
      to={`/bookings/${row.original.id}`}
      className="rounded-sm text-body font-semibold tabular text-foreground underline-offset-3 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-selection-ring"
    >
      {row.original.reference}
    </Link>
  ),
  meta: { className: cn(CELL, "w-20 whitespace-nowrap") },
};

const group: Col = {
  accessorKey: "group_name",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Group / contact" />,
  cell: ({ row }) => (
    <div className="grid min-w-0">
      <span className="truncate text-body leading-5 font-medium text-foreground">{row.original.group_name}</span>
      <span className="truncate text-sm leading-4 text-muted-foreground">
        {row.original.contact_name}
        {row.original.area ? ` · ${row.original.area}` : ""}
      </span>
    </div>
  ),
  meta: { className: cn(CELL, "min-w-44 max-w-[26rem]") },
};

const visit: Col = {
  accessorKey: "visit_date",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Visit" />,
  cell: ({ row }) => {
    const d = daysFromToday(row.original.visit_date);
    return (
      <div className="grid whitespace-nowrap">
        <span className="text-body leading-5 tabular text-foreground">
          {formatDateShort(row.original.visit_date)} {row.original.visit_date.slice(0, 4)}
        </span>
        <span className={cn("text-sm leading-4", d === 0 ? "font-medium text-blue-text" : "text-muted-foreground")}>{relativeDays(d)}</span>
      </div>
    );
  },
  meta: { className: CELL },
};

const people: Col = {
  accessorKey: "people_booked",
  header: ({ column }) => <DataTableColumnHeader column={column} title="People" align="right" />,
  cell: ({ row }) => <span className="text-body">{formatNumber(row.original.people_booked)}</span>,
  meta: { align: "right", numeric: true, className: cn(CELL, "w-16") },
};

const paid: Col = {
  id: "paid_total",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Paid" align="right" />,
  enableSorting: false,
  cell: ({ row }) => {
    const b = row.original;
    return (
      <div className="grid whitespace-nowrap">
        <span className={cn("text-body leading-5", b.paid_total > 0 ? "text-green-text" : "text-muted-foreground")}>{money(b.paid_total)}</span>
        <span className="text-sm leading-4 text-muted-foreground">of {money(b.total_amount)}</span>
      </div>
    );
  },
  meta: { align: "right", numeric: true, className: CELL },
};

const balance: Col = {
  id: "balance_due",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Balance" align="right" />,
  enableSorting: false,
  cell: ({ row }) => {
    const b = row.original;
    const paidUp = b.balance_due <= 0.005 && b.total_amount > 0;
    if (b.balance_due < -0.005) return <span className="text-body text-blue-text">credit {money(-b.balance_due)}</span>;
    return <span className={cn("text-body", paidUp ? "text-green-text" : "text-foreground")}>{money(b.balance_due)}</span>;
  },
  meta: { align: "right", numeric: true, className: CELL },
};

const status: Col = {
  accessorKey: "status",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
  cell: ({ row }) => <StatusPill status={row.original.status} />,
  meta: { className: cn(CELL, "w-28") },
};

/** Amber: the customer acted last, the move is ours. Green: we acted last. */
const latestAction: Col = {
  id: "latest_action",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Last action" />,
  enableSorting: false,
  cell: ({ row }) => {
    const a = row.original.latest_action;
    if (!a) return <span className="text-muted-foreground">—</span>;
    const tone = a.who === "customer" ? "amber" : a.who === "us" ? "green" : "neutral";
    return (
      <div className="grid justify-items-start gap-0.5 whitespace-nowrap">
        <StatusPill tone={tone} label={a.label} dot={false} />
        <span className="text-sm leading-4 tabular text-muted-foreground">
          {formatDate(a.at)} · {relativeTo(a.at.slice(0, 10))}
        </span>
      </div>
    );
  },
  meta: { className: cn(CELL, "min-w-40") },
};

const depositDueBy: Col = {
  accessorKey: "hold_expires_on",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Deposit due by" />,
  cell: ({ row }) => {
    const b = row.original;
    if (b.deposit_waived) return <span className="text-muted-foreground">Waived</span>;
    const hold = holdState(b);
    if (!hold) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="grid whitespace-nowrap">
        <span className={cn("text-body leading-5 tabular", hold.tone === "red" ? "font-medium text-red-text" : hold.tone === "amber" ? "font-medium text-amber-text" : "text-foreground")}>
          {formatDate(b.hold_expires_on)}
        </span>
        <span className="text-sm leading-4 text-muted-foreground">{hold.daysLeft < 0 ? `expired ${hold.relative}` : hold.relative}</span>
      </div>
    );
  },
  meta: { className: CELL },
};

const arrived: Col = {
  id: "arrived",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Arrived" align="right" />,
  enableSorting: false,
  cell: ({ row }) => (row.original.arrived_count === null ? <span className="text-muted-foreground">—</span> : <span className="text-body text-green-text">{formatNumber(row.original.arrived_count)}</span>),
  meta: { align: "right", numeric: true, className: cn(CELL, "w-20") },
};

const reason: Col = {
  id: "reason",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Reason" />,
  enableSorting: false,
  cell: ({ row }) => <span className={cn("line-clamp-2 text-sm", row.original.status_reason ? "text-foreground" : "text-muted-foreground")}>{row.original.status_reason ?? "—"}</span>,
  meta: { className: cn(CELL, "max-w-[18rem]") },
};

const CORE: Col[] = [ref, group, visit, people, paid, balance, status, latestAction];

export function columnsFor(tab: BookingBucket): Col[] {
  switch (tab) {
    case "pending":
      return [...CORE, depositDueBy];
    case "past":
      return [...CORE, arrived];
    case "lapsed":
      return [...CORE, reason];
    default:
      return CORE;
  }
}
