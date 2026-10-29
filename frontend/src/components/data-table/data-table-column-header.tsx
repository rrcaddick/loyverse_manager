import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface DataTableColumnHeaderProps<TData, TValue> extends Omit<React.HTMLAttributes<HTMLButtonElement>, "title"> {
  column: Column<TData, TValue>;
  /** Text, or spans that swap by container width (the Bookings list narrows its headers). */
  title: React.ReactNode;
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
        "-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-label uppercase outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60",
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
