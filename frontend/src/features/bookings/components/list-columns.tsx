/**
 * One stable set of columns for every bucket (owner's notes, 26 Oct 2026;
 * docs/research/08): the buckets are filters, not different tables. A bucket
 * may add one contextual column:
 *
 *   Ref · Group / contact · Date · Count · Payment · Status
 *   + Pending: Deposit due by   + Past: Arrived   + Lapsed: Reason
 *
 * The list never scrolls sideways (owner's note, 29 Oct 2026). The card is a
 * container (`@container/table` in BookingsPage) and the columns reflow at
 * two widths, trading row height for width:
 *
 *   full     ≥ 76rem  every column as above
 *   compact  < 76rem  the contextual columns fold away: Count, Arrived and
 *                     Reason into Group, Deposit due by into Date (two short
 *                     lines); the two Status pills stack
 *   stacked  < 56rem  Ref folds into Group, the year leaves the date, Payment
 *                     shows paid and due on their own lines (the total is in
 *                     the tooltip), the action pill may truncate
 *
 * Below md the list is cards (list-cards.tsx), so stacked is the floor. Base
 * classes are the full layout; the `@max-[…]/table:` variants are the
 * narrower levels. Payment is one cell: paid of total, a bar that fills with
 * the payments, and what is still due. Status is the booking's state as a
 * whole: the status pill beside the last-action pill, each at one fixed width
 * so both line up (amber: the customer acted, the move is ours; green: we
 * did), with the action's date and age under them.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "@/components/data-table";
import { StatusPill } from "@/components/status-pill";
import { formatDate, formatDateShort, formatDayMonth, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { daysFromToday, holdState, relativeDays, relativeTo } from "../lib";
import type { BookingBucket, BookingListItem } from "../types";
import { PaymentBar } from "./payment-bar";
import { RefLink } from "./ref-link";

type Col = ColumnDef<BookingListItem>;

const CELL = "py-1.5";
const HOLD_TEXT = { red: "font-medium text-red-text", amber: "font-medium text-amber-text", neutral: "text-muted-foreground" } as const;

const ref: Col = {
  accessorKey: "reference",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Ref" />,
  cell: ({ row }) => <RefLink booking={row.original} />,
  meta: { className: cn(CELL, "w-20 whitespace-nowrap @max-[56rem]/table:hidden") },
};

const group: Col = {
  accessorKey: "group_name",
  header: ({ column }) => (
    <DataTableColumnHeader
      column={column}
      title={
        <>
          <span className="@max-[56rem]/table:hidden">Group / contact</span>
          <span className="hidden @max-[56rem]/table:inline">Booking</span>
        </>
      }
    />
  ),
  cell: ({ row }) => {
    const b = row.original;
    return (
      <div className="grid min-w-0">
        <span className="flex min-w-0 items-baseline gap-1.5 text-body leading-5 font-medium text-foreground">
          <RefLink booking={b} className="hidden shrink-0 @max-[56rem]/table:inline" />
          <span className="truncate">{b.group_name}</span>
        </span>
        <span className="truncate text-sm leading-4 text-muted-foreground">
          {b.contact_name}
          {b.area ? ` · ${b.area}` : ""}
          <span className="hidden tabular @max-[76rem]/table:inline"> · {formatNumber(b.people_booked)} people</span>
          {b.arrived_count !== null ? <span className="hidden tabular text-green-text @max-[76rem]/table:inline"> · {formatNumber(b.arrived_count)} arrived</span> : null}
        </span>
        {b.status_reason ? <span className="hidden truncate text-sm leading-4 text-muted-foreground @max-[76rem]/table:block">{b.status_reason}</span> : null}
      </div>
    );
  },
  meta: { className: cn(CELL, "min-w-44 max-w-[26rem] @max-[56rem]/table:min-w-28") },
};

const visit: Col = {
  accessorKey: "visit_date",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
  cell: ({ row }) => {
    const b = row.original;
    const d = daysFromToday(b.visit_date);
    const hold = b.deposit_waived ? null : holdState(b);
    const dueOn = hold && b.hold_expires_on ? b.hold_expires_on : null;
    return (
      <div className="grid whitespace-nowrap">
        <span className="text-body leading-5 tabular text-foreground">
          {formatDateShort(b.visit_date)}
          <span className="@max-[56rem]/table:hidden"> {b.visit_date.slice(0, 4)}</span>
        </span>
        <span className={cn("text-sm leading-4", d === 0 ? "font-medium text-blue-text" : "text-muted-foreground")}>{relativeDays(d)}</span>
        {hold && dueOn ? (
          <>
            <span className={cn("hidden text-sm leading-4 tabular @max-[76rem]/table:block", HOLD_TEXT[hold.tone])}>Deposit by {formatDayMonth(dueOn)}</span>
            {hold.daysLeft < 0 ? <span className={cn("hidden text-sm leading-4 @min-[56rem]/table:@max-[76rem]/table:block", HOLD_TEXT[hold.tone])}>expired {hold.relative}</span> : null}
          </>
        ) : null}
      </div>
    );
  },
  meta: { className: CELL },
};

const people: Col = {
  accessorKey: "people_booked",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Count" align="right" />,
  cell: ({ row }) => <span className="text-body">{formatNumber(row.original.people_booked)}</span>,
  meta: { align: "right", numeric: true, className: cn(CELL, "w-16 @max-[76rem]/table:hidden") },
};

const payment: Col = {
  id: "payment",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Payment" />,
  enableSorting: false,
  cell: ({ row }) => <PaymentBar booking={row.original} />,
  meta: { className: cn(CELL, "min-w-56 @max-[76rem]/table:min-w-52 @max-[56rem]/table:min-w-32") },
};

const status: Col = {
  accessorKey: "status",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
  cell: ({ row }) => {
    const a = row.original.latest_action;
    const tone = a?.who === "customer" ? "amber" : a?.who === "us" ? "green" : "neutral";
    return (
      <div className="grid gap-1">
        <div className="flex items-center gap-1.5 @max-[76rem]/table:flex-col @max-[76rem]/table:items-start @max-[76rem]/table:gap-1">
          <StatusPill status={row.original.status} className="w-24 justify-center" />
          {a ? (
            <StatusPill
              tone={tone}
              label={a.label}
              dot={false}
              className="w-42 justify-center @max-[56rem]/table:inline-block @max-[56rem]/table:w-auto @max-[56rem]/table:max-w-32 @max-[56rem]/table:truncate @max-[56rem]/table:text-center @max-[56rem]/table:leading-[1.375rem]"
            />
          ) : null}
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
  meta: { className: cn(CELL, "@max-[76rem]/table:hidden") },
};

const arrived: Col = {
  id: "arrived",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Arrived" align="right" />,
  enableSorting: false,
  cell: ({ row }) => (row.original.arrived_count === null ? <span className="text-muted-foreground">—</span> : <span className="text-body text-green-text">{formatNumber(row.original.arrived_count)}</span>),
  meta: { align: "right", numeric: true, className: cn(CELL, "w-20 @max-[76rem]/table:hidden") },
};

const reason: Col = {
  id: "reason",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Reason" />,
  enableSorting: false,
  cell: ({ row }) => <span className={cn("line-clamp-2 text-sm", row.original.status_reason ? "text-foreground" : "text-muted-foreground")}>{row.original.status_reason ?? "—"}</span>,
  meta: { className: cn(CELL, "max-w-[18rem] @max-[76rem]/table:hidden") },
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
