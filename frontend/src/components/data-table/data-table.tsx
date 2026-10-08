/**
 * DataTable: TanStack Table with the app's chrome.
 *
 *   const columns: ColumnDef<User>[] = [
 *     { accessorKey: "full_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> },
 *     { accessorKey: "role", header: "Role", cell: ({ row }) => <StatusBadge status={row.original.role} /> },
 *   ];
 *   <DataTable columns={columns} data={users} isLoading={isPending}
 *     onRowClick={(u) => navigate(`/users/${u.id}`)} getRowId={(u) => String(u.id)}
 *     emptyState={<EmptyState title="No users yet" />} />
 *
 * Client-side sorting and pagination by default. For server-side lists pass
 * `manualPagination` with `rowCount` and handle `onPaginationChange`.
 *
 * `onRowClick` makes rows focusable and activatable with Enter/Space, but the
 * row keeps its table semantics; give the primary cell a real <Link> as well
 * so screen-reader and middle-click users have a first-class target.
 */

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useState, type ReactNode } from "react";

import { TableSkeleton } from "@/components/page-skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { DataTablePagination } from "./data-table-pagination";

export interface DataTableProps<TData, TValue = unknown> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  /** Rendered inside the table body when there are no rows. */
  emptyState?: ReactNode;
  /** Row click handler; also enables keyboard activation (Enter/Space). */
  onRowClick?: (row: TData) => void;
  getRowId?: (row: TData, index: number) => string;
  /** Mark rows (e.g. the currently open record). */
  isRowActive?: (row: TData) => boolean;
  rowClassName?: (row: TData) => string | undefined;
  /** Hide the pagination footer entirely (short lists). */
  pagination?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  /** Server-side pagination. */
  manualPagination?: boolean;
  rowCount?: number;
  paginationState?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  /** Server-side sorting. */
  manualSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Content for the toolbar row above the table (filters, view options). */
  toolbar?: ReactNode;
  /** Sticky header while the page scrolls. Default true. */
  stickyHeader?: boolean;
  /** Constrain height and scroll within. */
  maxHeight?: string;
  /** Dense rows. */
  dense?: boolean;
  className?: string;
}

export function DataTable<TData, TValue = unknown>({
  columns,
  data,
  isLoading = false,
  emptyState,
  onRowClick,
  getRowId,
  isRowActive,
  rowClassName,
  pagination = true,
  pageSize = 25,
  pageSizeOptions,
  manualPagination = false,
  rowCount,
  paginationState,
  onPaginationChange,
  manualSorting = false,
  sorting: sortingProp,
  onSortingChange,
  columnVisibility: visibilityProp,
  onColumnVisibilityChange,
  rowSelection: selectionProp,
  onRowSelectionChange,
  toolbar,
  stickyHeader = true,
  maxHeight,
  dense = false,
  className,
}: DataTableProps<TData, TValue>) {
  const [sortingState, setSortingState] = useState<SortingState>([]);
  const [visibilityState, setVisibilityState] = useState<VisibilityState>({});
  const [selectionState, setSelectionState] = useState<RowSelectionState>({});
  const [paginationLocal, setPaginationLocal] = useState<PaginationState>({ pageIndex: 0, pageSize });

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      sorting: sortingProp ?? sortingState,
      columnVisibility: visibilityProp ?? visibilityState,
      rowSelection: selectionProp ?? selectionState,
      pagination: paginationState ?? paginationLocal,
    },
    onSortingChange: onSortingChange ?? setSortingState,
    onColumnVisibilityChange: onColumnVisibilityChange ?? setVisibilityState,
    onRowSelectionChange: onRowSelectionChange ?? setSelectionState,
    onPaginationChange: onPaginationChange ?? setPaginationLocal,
    manualPagination,
    manualSorting,
    rowCount: manualPagination ? rowCount : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getPaginationRowModel: pagination && !manualPagination ? getPaginationRowModel() : undefined,
  });

  const rows = table.getRowModel().rows;
  const interactive = !!onRowClick;

  function activate(row: Row<TData>) {
    onRowClick?.(row.original);
  }

  /**
   * Row clicks must not fire for clicks on controls inside the row, nor for
   * clicks inside portalled menus/dialogs (React bubbles those through the
   * component tree even though they are not DOM descendants).
   */
  function isRowClick(event: React.MouseEvent<HTMLTableRowElement>): boolean {
    const target = event.target as HTMLElement | null;
    if (!target || !event.currentTarget.contains(target)) return false;
    return !target.closest(INTERACTIVE_SELECTOR);
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {toolbar ? <div className="flex flex-wrap items-center gap-2 pb-3">{toolbar}</div> : null}
      <div
        className={cn("relative w-full overflow-auto scrollbar-thin", maxHeight && "max-h-(--table-max-h)")}
        style={maxHeight ? ({ "--table-max-h": maxHeight } as React.CSSProperties) : undefined}
      >
        <Table className="[&_td]:align-middle">
          <TableHeader className={cn(stickyHeader && "sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]")}>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                      className={cn(
                        "h-10 text-xs font-medium tracking-wide text-muted-foreground uppercase",
                        meta?.align === "right" && "text-right",
                        meta?.align === "center" && "text-center",
                        meta?.className,
                      )}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  <TableSkeleton columns={Math.min(columns.length, 6)} rows={Math.min(pageSize, 8)} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  {emptyState ?? <div className="p-8 text-center text-sm text-muted-foreground">Nothing to show</div>}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const active = isRowActive?.(row.original) ?? false;
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : active ? "active" : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    onClick={interactive ? (event) => isRowClick(event) && activate(row) : undefined}
                    onKeyDown={
                      interactive
                        ? (event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              activate(row);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      interactive &&
                        "cursor-pointer outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                      active && "bg-primary/5",
                      rowClassName?.(row.original),
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            dense ? "py-1.5" : "py-2.5",
                            meta?.align === "right" && "text-right tabular",
                            meta?.align === "center" && "text-center",
                            meta?.numeric && "tabular",
                            meta?.className,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && !isLoading && (manualPagination || data.length > (paginationState?.pageSize ?? paginationLocal.pageSize)) ? (
        <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
      ) : null}
    </div>
  );
}

const INTERACTIVE_SELECTOR =
  "a, button, input, select, textarea, label, summary, [role='button'], [role='menuitem'], [role='checkbox'], [role='switch'], [role='link'], [data-no-row-click]";

/** Per-column presentation hints via `meta`. */
export interface ColumnMeta {
  align?: "left" | "right" | "center";
  numeric?: boolean;
  className?: string;
  /** Label for the column-visibility menu (defaults to the header string). */
  label?: string;
}
