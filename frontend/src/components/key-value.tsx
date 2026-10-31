import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Right-align and use tabular digits (money, counts). */
  numeric?: boolean;
  /** Span both columns in the two-column layout. */
  wide?: boolean;
}

interface KeyValueProps {
  items: KeyValueItem[];
  /** "list" stacks label over value; "table" puts them side by side. */
  layout?: "list" | "table";
  /** Two columns of pairs on wider screens (list layout only). */
  columns?: 1 | 2 | 3;
  className?: string;
}

/**
 * Label/value pairs with identical edges and baselines. Empty values render
 * an em dash so rows never collapse.
 */
export function KeyValue({ items, layout = "list", columns = 1, className }: KeyValueProps) {
  if (layout === "table") {
    return (
      <dl className={cn("divide-y divide-border", className)}>
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[minmax(8rem,1fr)_2fr] gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className={cn("min-w-0 text-foreground", item.numeric && "tabular text-right")}>
              {item.value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-4",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={index} className={cn("min-w-0 space-y-1", item.wide && "sm:col-span-full")}>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{item.label}</dt>
          <dd className={cn("text-sm text-foreground", item.numeric && "tabular")}>{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
