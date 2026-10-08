/**
 * CapacityBar — the split bar: confirmed (green) and pending (amber) against
 * a denominator (the capacity setting, or the interest when that is larger).
 *
 *   <CapacityBar confirmed={550} pending={250} capacity={1000} />
 *   <CapacityBar confirmed={550} pending={250} capacity={600} caption="compact" />   "550 · 250" with swatches
 *   <CapacityBar … caption="none" height={4} />
 *
 * Over capacity (confirmed + pending > capacity) the bar fills completely and
 * `data-over` is set so a cell can add its 3 px red rule and OVER tag.
 */

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CapacityBarProps {
  confirmed: number;
  pending: number;
  /** The denominator. Falls back to confirmed + pending when 0/undefined. */
  capacity?: number | null;
  caption?: "full" | "compact" | "none";
  /** Bar height in px. Default 6. */
  height?: number;
  className?: string;
  label?: string;
}

export function CapacityBar({ confirmed, pending, capacity, caption = "full", height = 6, className, label = "Capacity" }: CapacityBarProps) {
  const total = Math.max(0, confirmed) + Math.max(0, pending);
  const denominator = Math.max(capacity && capacity > 0 ? capacity : 0, total, 1);
  const over = !!capacity && capacity > 0 && total > capacity;
  const confirmedPct = Math.min(100, (Math.max(0, confirmed) / denominator) * 100);
  const pendingPct = Math.min(100 - confirmedPct, (Math.max(0, pending) / denominator) * 100);

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} data-over={over || undefined}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={denominator}
        aria-valuenow={total}
        aria-valuetext={`${formatNumber(confirmed)} confirmed, ${formatNumber(pending)} pending of ${formatNumber(denominator)}`}
        className="flex w-full overflow-hidden rounded-full bg-foreground/10"
        style={{ height }}
      >
        <span className="h-full bg-green-solid" style={{ width: `${confirmedPct}%` }} />
        <span className="h-full bg-amber-solid" style={{ width: `${pendingPct}%` }} />
      </div>
      {caption === "none" ? null : (
        <div className="flex items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular" aria-hidden="true">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-green-solid" />
            {formatNumber(confirmed)}
            {caption === "full" ? " confirmed" : null}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-solid" />
            {formatNumber(pending)}
            {caption === "full" ? " pending" : null}
          </span>
          {over ? <span className="font-semibold text-red-text">OVER</span> : null}
        </div>
      )}
    </div>
  );
}
