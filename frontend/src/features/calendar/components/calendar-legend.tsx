import { Flame } from "lucide-react";

import { cn } from "@/lib/utils";

import { HEAT_BANDS } from "../month";

import "../calendar.css";

/** Explains every encoding on the grid: heat, split bar, day flags. */
export function CalendarLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground", className)} aria-label="Legend">
      <div className="flex items-center gap-1.5">
        <span className="mr-0.5">People booked</span>
        <span className="flex items-center gap-px" aria-hidden="true">
          <span className="size-3.5 rounded-sm border border-foreground/10 bg-card" title="None" />
          {HEAT_BANDS.map((band) => (
            <span key={band.level} className="fy-heat size-3.5 rounded-sm" data-heat={band.level} title={band.label} />
          ))}
        </span>
        <span className="tabular">0 → 800+</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="fy-heat flex h-1.5 w-10 overflow-hidden rounded-full" data-heat={0} aria-hidden="true">
          <span className="fy-bar-confirmed h-full w-1/2" />
          <span className="fy-bar-tentative ml-px h-full w-1/2" />
        </span>
        <span>
          <span className="font-medium text-foreground">confirmed</span> / tentative people
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="fy-swatch-closed size-3.5 rounded-sm border border-foreground/10" aria-hidden="true" />
        Closed
      </div>
      <div className="flex items-center gap-1.5">
        <span className="size-3.5 rounded-sm border border-dashed border-foreground/40" aria-hidden="true" />
        Avoid
      </div>
      <div className="flex items-center gap-1.5">
        <Flame aria-hidden="true" className="size-3.5 text-foreground" />
        Peak
      </div>
      <div className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-red-500" aria-hidden="true" />
        Over capacity warning
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-foreground ring-2 ring-current" aria-hidden="true">
          8
        </span>
        Today
      </div>
    </div>
  );
}
