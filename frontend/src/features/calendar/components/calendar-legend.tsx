/**
 * The 28 px legend line: the six heat swatches labelled with the band
 * thresholds (scaled from the capacity), the split bar, the day kinds in
 * their colours (Settings › Day kinds), OVER and today.
 */

import type { DayKind } from "@/types/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { heatLegendLabels } from "../heat";

import "../calendar.css";

const SWATCH = ["border border-border bg-card", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

/** Lower-priority kinds drop first as the line narrows (the panel takes 400 px). */
const KIND_HIDE = ["", "", "", "@max-[1180px]:hidden", "@max-[1180px]:hidden", "@max-[1320px]:hidden", "@max-[1320px]:hidden", "@max-[1440px]:hidden"];

export function CalendarLegend({ capacity, overThreshold, kinds, className }: { capacity: number; overThreshold: number; kinds: DayKind[]; className?: string }) {
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
        <div className="flex items-center gap-1.5 @max-[860px]:hidden">
          <span className="flex h-1.5 w-8 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
            <span className="h-full w-7/12 bg-green-solid" />
            <span className="h-full w-5/12 bg-amber-solid" />
          </span>
          confirmed · pending of {formatNumber(capacity)}
        </div>
        {kinds.map((kind, index) => (
          <div key={kind.code} className={cn("flex items-center gap-1.5", KIND_HIDE[index] ?? "@max-[1440px]:hidden")}>
            <span className="size-3 rounded-sm border-2 bg-card" style={{ borderColor: kind.colour }} aria-hidden="true" />
            {kind.label}
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="rounded-sm bg-red-solid px-1 text-[0.625rem] leading-3 font-semibold text-on-solid uppercase" aria-hidden="true">
            Over
          </span>
          {formatNumber(overThreshold)}+
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
