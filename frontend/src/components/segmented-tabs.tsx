/**
 * SegmentedTabs — horizontal tabs with counts, for list buckets (Pending ·
 * Confirmed · Lapsed · Past · All) and record tabs (Booking · Conversation).
 *
 *   <SegmentedTabs
 *     aria-label="Booking buckets"
 *     value={tab}
 *     onChange={setTab}
 *     items={[{ value: "pending", label: "Pending", count: 12 }, { value: "all", label: "All" }]}
 *   />
 *   <SegmentedTabs variant="line" … />   underline style for record tabs
 *
 * Counts hide at zero. Keyboard: ← → move, Home / End jump.
 */

import type { LucideIcon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface SegmentedTabItem<V extends string = string> {
  value: V;
  label: string;
  count?: number | null;
  icon?: LucideIcon;
  disabled?: boolean;
}

interface SegmentedTabsProps<V extends string> {
  items: SegmentedTabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  "aria-label": string;
  variant?: "segmented" | "line";
  size?: "md" | "sm";
  className?: string;
}

export function SegmentedTabs<V extends string>({ items, value, onChange, variant = "segmented", size = "md", className, ...aria }: SegmentedTabsProps<V>) {
  const refs = useRef<Map<V, HTMLButtonElement>>(new Map());

  function onKeyDown(event: KeyboardEvent, index: number) {
    const enabled = items.filter((i) => !i.disabled);
    const current = enabled.findIndex((i) => i.value === items[index]?.value);
    const keys: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: enabled.length - 1 };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = enabled[(next + enabled.length) % enabled.length];
    if (!target) return;
    refs.current.get(target.value)?.focus();
    onChange(target.value);
  }

  const line = variant === "line";
  return (
    <div
      role="tablist"
      aria-label={aria["aria-label"]}
      className={cn(
        "flex max-w-full items-center overflow-x-auto no-scrollbar",
        line ? "gap-1 border-b border-border" : "w-fit gap-0.5 rounded-lg bg-muted p-[3px]",
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.value === value;
        const count = typeof item.count === "number" && item.count > 0 ? item.count : null;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={undefined}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            ref={(el) => {
              if (el) refs.current.set(item.value, el);
            }}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 font-medium whitespace-nowrap outline-none transition-colors",
              size === "sm" ? "h-8 px-2.5 text-sm" : "h-9 px-3 text-body",
              "disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-selection-ring",
              line
                ? cn(
                    "-mb-px rounded-t-md border-b-2 border-transparent",
                    active ? "border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )
                : cn("rounded-md", active ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"),
            )}
          >
            {item.icon ? <item.icon aria-hidden="true" className="size-4" /> : null}
            {item.label}
            {count !== null ? (
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular",
                  active ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-muted-foreground",
                )}
              >
                {formatNumber(count)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
