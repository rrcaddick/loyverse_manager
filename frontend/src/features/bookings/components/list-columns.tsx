/**
 * Columns per list tab (docs/research/04, "Lists"):
 *   Pending   Ref · Group/contact · Visit · Visitors · Status · Deposit due · Hold expires
 *   Confirmed Ref · Group/contact · Visit · Visitors · Paid of total · Balance · Ticket · Arrived
 *   Lapsed    Ref · Group · Visit · Visitors · Status · When · Reason
 *   Past      Ref · Group · Visit · Visitors · Arrived · Paid · Status
 *   All       Ref · Group/contact · Visit · Visitors · Status · Paid of total · Balance
 * Never more than eight; 48 px rows with a 15 px primary and 14 px muted
 * secondary line; money right-aligned and tabular; the ref a real link.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { Check } from "lucide-react";
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
    <Link to={`/bookings/${row.original.id}`} className="font-mono text-sm tabular text-muted-foreground underline-offset-3 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-selection-ring rounded-sm">
      {row.original.reference}
    </Link>
  ),
  meta: { className: cn(CELL, "w-24") },
};

function groupColumn(withContact: boolean): Col {
  return {
    accessorKey: "group_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title={withContact ? "Group / contact" : "Group"} />,
    cell: ({ row }) => (
      <div className="grid min-w-0">
        <span className="truncate text-body leading-5 font-semibold text-foreground">{row.original.group_name}</span>
        {withContact ? (
          <span className="truncate text-sm leading-4 text-muted-foreground">
            {row.original.contact_name}
            {row.original.area ? ` · ${row.original.area}` : ""}
          </span>
        ) : null}
      </div>
    ),
    meta: { className: cn(CELL, "min-w-56 max-w-[26rem]") },
  };
}

const visit: Col = {
  accessorKey: "visit_date",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Visit" />,
  cell: ({ row }) => {
    const d = daysFromToday(row.original.visit_date);
    return (
      <div className="grid whitespace-nowrap">
        <span className="text-body leading-5 tabular text-foreground">{formatDateShort(row.original.visit_date)} {row.original.visit_date.slice(0, 4)}</span>
        <span className={cn("text-sm leading-4", d === 0 ? "font-medium text-blue-text" : "text-muted-foreground")}>{relativeDays(d)}</span>
      </div>
    );
  },
  meta: { className: CELL },
};

const visitors: Col = {
  accessorKey: "people_booked",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Visitors" align="right" />,
  cell: ({ row }) => formatNumber(row.original.people_booked),
  meta: { align: "right", numeric: true, className: CELL },
};

const status: Col = {
  accessorKey: "status",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
  cell: ({ row }) => <StatusPill status={row.original.status} />,
  meta: { className: CELL },
};

const depositDue: Col = {
  id: "deposit_due",
  header: "Deposit due",
  enableSorting: false,
  cell: ({ row }) => {
    const b = row.original;
    if (b.deposit_waived) return <span className="text-muted-foreground">Waived</span>;
    return <span className={cn(b.deposit_covered && b.paid_total > 0 && "text-green-text")}>{money(b.deposit_due)}</span>;
  },
  meta: { align: "right", numeric: true, className: CELL },
};

const holdExpires: Col = {
  accessorKey: "hold_expires_on",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Hold expires" />,
  cell: ({ row }) => {
    const hold = holdState(row.original);
    if (!hold) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="grid whitespace-nowrap">
        <span className={cn("text-body leading-5", hold.tone === "red" ? "font-medium text-red-text" : hold.tone === "amber" ? "font-medium text-amber-text" : "text-foreground")}>{hold.daysLeft < 0 ? `expired ${hold.relative}` : hold.relative}</span>
        <span className="text-sm leading-4 tabular text-muted-foreground">{formatDate(row.original.hold_expires_on)}</span>
      </div>
    );
  },
  meta: { className: CELL },
};

const paidOfTotal: Col = {
  id: "paid_of_total",
  header: "Paid of total",
  enableSorting: false,
  cell: ({ row }) => {
    const b = row.original;
    return (
      <span className="whitespace-nowrap">
        <span className={cn(b.paid_total > 0 ? "text-green-text" : "text-muted-foreground")}>{money(b.paid_total)}</span>
        <span className="text-muted-foreground"> / {money(b.total_amount)}</span>
      </span>
    );
  },
  meta: { align: "right", numeric: true, className: CELL },
};

const balance: Col = {
  id: "balance_due",
  header: "Balance",
  enableSorting: false,
  cell: ({ row }) => {
    const b = row.original;
    const paidUp = b.balance_due <= 0.005 && b.total_amount > 0;
    return <span className={cn(paidUp && "text-green-text", b.balance_due < -0.005 && "text-blue-text")}>{b.balance_due < -0.005 ? `credit ${money(-b.balance_due)}` : money(b.balance_due)}</span>;
  },
  meta: { align: "right", numeric: true, className: CELL },
};

const ticket: Col = {
  id: "ticket",
  header: "Ticket",
  enableSorting: false,
  cell: ({ row }) => {
    const b = row.original;
    const sent = b.ticket_sent_at || b.ticket_emailed_at;
    return sent ? (
      <span className="inline-flex items-center gap-1 text-green-text" title={`Sent ${formatDate(sent)}${b.ticket_sent_at ? " on WhatsApp" : " by email"}`}>
        <Check aria-hidden="true" className="size-4" />
        <span className="sr-only">Ticket sent</span>
      </span>
    ) : (
      <span className="text-muted-foreground" aria-label="Ticket not sent">
        —
      </span>
    );
  },
  meta: { align: "center", className: cn(CELL, "w-16") },
};

const arrived: Col = {
  id: "arrived",
  header: "Arrived",
  enableSorting: false,
  cell: ({ row }) => (row.original.arrived_count === null ? <span className="text-muted-foreground">—</span> : <span className="text-green-text">{formatNumber(row.original.arrived_count)}</span>),
  meta: { align: "right", numeric: true, className: CELL },
};

const when: Col = {
  accessorKey: "updated_at",
  header: ({ column }) => <DataTableColumnHeader column={column} title="When" />,
  cell: ({ row }) => {
    const b = row.original;
    const stamp = b.status === "cancelled" ? b.cancelled_at : b.status === "lapsed" ? b.lapsed_at : b.updated_at;
    if (!stamp) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="grid whitespace-nowrap">
        <span className="text-body leading-5 tabular text-foreground">{formatDate(stamp)}</span>
        <span className="text-sm leading-4 text-muted-foreground">{relativeTo(stamp.slice(0, 10))}</span>
      </div>
    );
  },
  meta: { className: CELL },
};

const reason: Col = {
  id: "reason",
  header: "Reason",
  enableSorting: false,
  cell: ({ row }) => <span className={cn("line-clamp-2 text-sm", row.original.status_reason ? "text-foreground" : "text-muted-foreground")}>{row.original.status_reason ?? "—"}</span>,
  meta: { className: cn(CELL, "max-w-[18rem]") },
};

const paid: Col = {
  id: "paid_total",
  header: "Paid",
  enableSorting: false,
  cell: ({ row }) => <span className={cn(row.original.paid_total > 0 ? "text-green-text" : "text-muted-foreground")}>{money(row.original.paid_total)}</span>,
  meta: { align: "right", numeric: true, className: CELL },
};

export function columnsFor(tab: BookingBucket): Col[] {
  switch (tab) {
    case "pending":
      return [ref, groupColumn(true), visit, visitors, status, depositDue, holdExpires];
    case "confirmed":
      return [ref, groupColumn(true), visit, visitors, paidOfTotal, balance, ticket, arrived];
    case "lapsed":
      return [ref, groupColumn(false), visit, visitors, status, when, reason];
    case "past":
      return [ref, groupColumn(false), visit, visitors, arrived, paid, status];
    default:
      return [ref, groupColumn(true), visit, visitors, status, paidOfTotal, balance];
  }
}
