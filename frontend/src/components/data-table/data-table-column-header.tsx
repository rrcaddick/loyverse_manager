import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface DataTableColumnHeaderProps<TData, TValue> extends React.HTMLAttributes<HTMLButtonElement> {
  column: Column<TData, TValue>;
  title: string;
  align?: "left" | "right" | "center";
}

/** Sortable column header: click or Enter cycles asc → desc → off. */
export function DataTableColumnHeader<TData, TValue>({ column, title, align = "left", className }: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <span className={cn("text-table-head-foreground", className)}>{title}</span>;
  }
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
      className={cn(
        "-mx-1.5 inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs font-medium outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50",
        align === "right" && "flex-row-reverse",
        sorted ? "text-table-head-foreground" : "text-table-head-foreground/85",
        className,
      )}
    >
      {title}
      <Icon aria-hidden="true" className={cn("size-3.5", !sorted && "opacity-50")} />
    </button>
  );
}
