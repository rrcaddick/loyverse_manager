/**
 * The line under a split bar: `550 confirmed · 250 pending`, or `550 · 250`
 * with 6 px green / amber swatches where there is no room for the words.
 *
 * `mode="auto"` switches on the cell's own width (a container query): the
 * words need about 200 px of content box ("1 000 confirmed · 1 000 pending"
 * at 12.75 px), which is a 218 px cell — the 233 px cells at 1920×1080; the
 * 167 px cells at 1440×900 show the swatches. Colour is inherited, so on a
 * heat cell it is full ink.
 */

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SplitCaptionProps {
  confirmed: number;
  pending: number;
  mode?: "auto" | "compact" | "full" | "full-swatches";
  className?: string;
}

export function SplitCaption({ confirmed, pending, mode = "auto", className }: SplitCaptionProps) {
  const words = mode === "full" || mode === "full-swatches" ? "" : mode === "compact" ? "hidden" : "hidden @min-[200px]:inline";
  const swatch = mode === "full" ? "hidden" : mode === "compact" || mode === "full-swatches" ? "" : "@min-[200px]:hidden";
  return (
    <div className={cn("flex min-w-0 items-center gap-1 overflow-hidden text-xs leading-4 whitespace-nowrap tabular", className)} aria-hidden="true">
      <span className={cn("size-1.5 shrink-0 rounded-full bg-green-solid", swatch)} />
      <span>
        {formatNumber(confirmed)}
        <span className={words}> confirmed</span>
      </span>
      <span className="px-0.5 opacity-60">·</span>
      <span className={cn("size-1.5 shrink-0 rounded-full bg-amber-solid", swatch)} />
      <span>
        {formatNumber(pending)}
        <span className={words}> pending</span>
      </span>
    </div>
  );
}
