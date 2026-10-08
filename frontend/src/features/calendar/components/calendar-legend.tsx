/**
 * The 28 px legend line: the six heat swatches labelled with the band
 * thresholds (scaled from the capacity setting), the split bar, and the
 * day-type marks (closed, peak, avoid, over capacity, today).
 */

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { heatLegendLabels } from "../heat";

import "../calendar.css";

const SWATCH = ["border border-border bg-card", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

/**
 * The legend is its own container: the least informative items drop first
 * as it narrows (the panel takes 400 px), so nothing is ever clipped.
 */
export function CalendarLegend({ capacity, className }: { capacity: number; className?: string }) {
  const labels = heatLegendLabels(capacity, formatNumber);
  return (
    <div className={cn("@container h-7 shrink-0 border-t border-border", className)}>
      <div className="flex h-full items-center gap-x-4 overflow-hidden px-3 text-xs leading-none whitespace-nowrap text-muted-foreground tabular" aria-label="Legend">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-foreground">People on the day</span>
          {labels.map((label, level) => (
            <span key={label} className="flex items-center gap-1">
              <span className={cn("size-3 rounded-sm", SWATCH[level])} aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 @max-[760px]:hidden">
          <span className="flex h-1.5 w-8 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
            <span className="h-full w-7/12 bg-green-solid" />
            <span className="h-full w-5/12 bg-amber-solid" />
          </span>
          confirmed · pending
        </div>
        <div className="flex items-center gap-1.5">
          <span className="fy-swatch-hatched size-3 rounded-sm border border-border bg-nested" aria-hidden="true" />
          Closed
        </div>
        <div className="flex items-center gap-1.5 @max-[900px]:hidden">
          <span className="size-3 rounded-sm border border-border bg-card shadow-[inset_0_2px_0_0_var(--amber-solid)]" aria-hidden="true" />
          Peak
        </div>
        <div className="flex items-center gap-1.5 @max-[900px]:hidden">
          <span className="size-3 rounded-sm border border-dashed border-border-strong bg-card" aria-hidden="true" />
          Avoid
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-border bg-card shadow-[inset_0_3px_0_0_var(--red-solid)]" aria-hidden="true" />
          Over {formatNumber(capacity)}
        </div>
        <div className="flex items-center gap-1.5 @max-[1020px]:hidden">
          <span className="inline-flex size-3.5 items-center justify-center rounded-full bg-primary text-[0.5rem] font-semibold text-primary-foreground" aria-hidden="true">
            8
          </span>
          Today
        </div>
      </div>
    </div>
  );
}
