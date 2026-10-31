/**
 * The split: confirmed (green) against pending (amber) as a share of the
 * two, never of capacity, with the two numbers under it, confirmed on the
 * left and pending on the right. No dots: the sides say which is which.
 */

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SplitBarProps {
  confirmed: number;
  pending: number;
  /** Bar height in px. Default 5. */
  height?: number;
  className?: string;
}

export function SplitBar({ confirmed, pending, height = 5, className }: SplitBarProps) {
  const total = Math.max(0, confirmed) + Math.max(0, pending);
  const pct = total > 0 ? (Math.max(0, confirmed) / total) * 100 : 0;
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <div
        role="meter"
        aria-label="Confirmed against pending"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${formatNumber(confirmed)} confirmed, ${formatNumber(pending)} pending`}
        className="flex w-full overflow-hidden rounded-full bg-amber-solid"
        style={{ height }}
      >
        <span className="h-full bg-green-solid" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs leading-4 font-medium whitespace-nowrap tabular" aria-hidden="true">
        <span>{formatNumber(confirmed)}</span>
        <span>{formatNumber(pending)}</span>
      </div>
    </div>
  );
}
