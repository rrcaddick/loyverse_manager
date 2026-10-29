/**
 * One stable set of columns for every bucket (owner's notes, 26 Oct 2026;
 * docs/research/08): the buckets are filters, not different tables. A bucket
 * may add one contextual column:
 *
 *   Ref · Group / contact · Date · Count · Payment · Status
 *   + Pending: Deposit due by   + Past: Arrived   + Lapsed: Reason
 *
 * The reference is the row's primary cell (15 px semibold foreground).
 * Payment is one cell: paid of total, a bar that fills with the payments, and
 * what is still due (owner's note, 29 Oct 2026). Status is the booking's
 * state as a whole: the status pill beside the last-action pill, each at one
 * fixed width (sized to its longest label) so both line up down the column
 * (amber: the customer acted, the move is ours; green: we did), with the
 * action's date and age under them.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router";

import { DataTableColumnHeader } from "@/components/data-table";
import { StatusPill } from "@/components/status-pill";
import { formatDate, formatDateShort, formatDayMonth, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { daysFromToday, holdState, relativeDays, relativeTo } from "../lib";
import type { BookingBucket, BookingListItem } from "../types";
import { PaymentBar } from "./payment-bar";

type Col = ColumnDef<BookingListItem>;

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
  header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
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
  header: ({ column }) => <DataTableColumnHeader column={column} title="Count" align="right" />,
  cell: ({ row }) => <span className="text-body">{formatNumber(row.original.people_booked)}</span>,
  meta: { align: "right", numeric: true, className: cn(CELL, "w-16") },
};

const payment: Col = {
  id: "payment",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Payment" />,
  enableSorting: false,
  cell: ({ row }) => <PaymentBar booking={row.original} />,
  meta: { className: cn(CELL, "min-w-60") },
};

const status: Col = {
  accessorKey: "status",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
  cell: ({ row }) => {
    const a = row.original.latest_action;
    const tone = a?.who === "customer" ? "amber" : a?.who === "us" ? "green" : "neutral";
    return (
      <div className="grid gap-1">
        <div className="flex items-center gap-1.5">
          <StatusPill status={row.original.status} className="w-26 justify-center" />
          {a ? <StatusPill tone={tone} label={a.label} dot={false} className="w-48 justify-center" /> : null}
        </div>
        {a ? (
          <span className="text-sm leading-4 tabular text-muted-foreground" title={formatDate(a.at)}>
            {formatDayMonth(a.at)} · {relativeTo(a.at.slice(0, 10))}
          </span>
        ) : null}
      </div>
    );
  },
  // Shrinks to its pills; spare width goes to the group and payment columns.
  meta: { className: cn(CELL, "w-px whitespace-nowrap") },
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

const CORE: Col[] = [ref, group, visit, people, payment, status];

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
