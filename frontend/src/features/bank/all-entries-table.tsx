/**
 * "All entries": every row the feed has stored, newest first, with the
 * balance column. Server-paginated DataTable; a row click opens the drawer.
 */

import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { useMemo } from "react";

import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusPill } from "@/components/status-pill";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { BankTransaction } from "./types";

interface AllEntriesTableProps {
  rows: BankTransaction[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  onOpen: (tx: BankTransaction) => void;
  isLoading: boolean;
  openId: number | null;
}

export function AllEntriesTable({ rows, total, page, pageSize, onPageChange, onOpen, isLoading, openId }: AllEntriesTableProps) {
  const columns = useMemo<ColumnDef<BankTransaction>[]>(
    () => [
      {
        accessorKey: "booking_date",
        header: "Date",
        cell: ({ row }) => <span className="tabular whitespace-nowrap">{formatDate(row.original.booking_date)}</span>,
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-body text-foreground">{row.original.description}</div>
            {row.original.end_to_end_id && row.original.end_to_end_id.trim() !== row.original.description.trim() ? (
              <div className="truncate font-mono text-xs text-muted-foreground">{row.original.end_to_end_id}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: "booking",
        header: "Booking",
        cell: ({ row }) => {
          const tx = row.original;
          if (tx.matched_booking) {
            return (
              <span className="truncate">
                <span className="tabular">{tx.matched_booking.reference}</span> <span className="text-muted-foreground">{tx.matched_booking.group_name}</span>
              </span>
            );
          }
          if (tx.match_status === "ignored") {
            return <StatusPill tone="neutral" label={tx.ignore?.label ? `Ignored · ${tx.ignore.label}` : "Ignored"} size="sm" />;
          }
          if (tx.suggestions.length) {
            return <StatusPill tone="amber" label={`${tx.suggestions.length} suggested`} size="sm" />;
          }
          return <span className="text-muted-foreground">{tx.credit_debit === "CREDIT" ? "Unmatched" : "—"}</span>;
        },
      },
      {
        accessorKey: "amount",
        header: "Amount",
        meta: { align: "right", numeric: true },
        cell: ({ row }) => {
          const credit = row.original.credit_debit === "CREDIT";
          return (
            <span className={cn("font-medium tabular whitespace-nowrap", credit ? "text-foreground" : "text-muted-foreground")}>
              {credit ? "" : "−"}
              {formatMoney(row.original.amount)}
            </span>
          );
        },
      },
      {
        accessorKey: "balance_after",
        header: "Balance",
        meta: { align: "right", numeric: true },
        cell: ({ row }) => <span className="text-muted-foreground tabular whitespace-nowrap">{formatMoney(row.original.balance_after)}</span>,
      },
    ],
    [],
  );

  const pagination: PaginationState = { pageIndex: page - 1, pageSize };

  return (
    <DataTable
      columns={columns}
      data={rows}
      isLoading={isLoading}
      onRowClick={onOpen}
      getRowId={(row) => String(row.id)}
      isRowActive={(row) => row.id === openId}
      manualPagination
      rowCount={total}
      paginationState={pagination}
      onPaginationChange={(updater) => {
        const next = typeof updater === "function" ? updater(pagination) : updater;
        onPageChange(next.pageIndex + 1, next.pageSize);
      }}
      emptyState={<EmptyState variant="card" title="No entries" hint="The FNB feed is polled every five minutes." />}
    />
  );
}
