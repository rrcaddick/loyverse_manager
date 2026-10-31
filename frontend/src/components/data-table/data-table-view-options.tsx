import type { Table } from "@tanstack/react-table";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { ColumnMeta } from "./data-table";

/** "Columns" menu toggling column visibility. Pass the table from useReactTable. */
export function DataTableViewOptions<TData>({ table }: { table: Table<TData> }) {
  const columns = table.getAllColumns().filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto">
          <Settings2 data-icon="inline-start" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => {
          const meta = column.columnDef.meta as ColumnMeta | undefined;
          const label = meta?.label ?? (typeof column.columnDef.header === "string" ? column.columnDef.header : column.id);
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(!!value)}
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
