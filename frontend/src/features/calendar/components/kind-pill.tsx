/**
 * A day kind as a pill: the kind's own colour as a ring and text, clear
 * inside, so Peak, Public holiday, Weekend… read the same in a cell's tag,
 * the day panel and the Today header.
 */

import type { DayKind } from "@/types/api";
import { cn } from "@/lib/utils";

export function KindPill({ kind, className }: { kind: DayKind; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-[1.375rem] shrink-0 items-center gap-1.5 rounded-full border bg-card px-2 text-xs leading-none font-medium whitespace-nowrap", className)}
      style={{ borderColor: kind.colour, color: kind.colour }}
    >
      <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: kind.colour }} />
      {kind.label}
    </span>
  );
}
