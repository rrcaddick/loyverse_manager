/**
 * The week-summary column: no heat, right-aligned, the interest 24/700
 * (28 at 1920) + "people", "9 groups", the same split bar and `550 · 250`.
 * The background alternates by calendar month (the week's Thursday) so a
 * two-month window reads as two months.
 */

import { CapacityBar } from "@/components/capacity-bar";
import { Skeleton } from "@/components/ui/skeleton";
import type { CalendarDay } from "@/features/bookings/types";
import { formatDateShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { weekMonthKey } from "../month";
import { SplitCaption } from "./split-caption";

interface WeekCellProps {
  week: string[];
  days: Map<string, CalendarDay>;
  isLoading: boolean;
}

export function WeekCell({ week, days, isLoading }: WeekCellProps) {
  const present = week.map((d) => days.get(d)).filter((d): d is CalendarDay => !!d);
  const total = present.reduce((n, d) => n + d.total_people, 0);
  const confirmed = present.reduce((n, d) => n + d.confirmed_people, 0);
  const pending = present.reduce((n, d) => n + d.tentative_people, 0);
  const groups = present.reduce((n, d) => n + d.booking_count, 0);
  const alternate = Number(weekMonthKey(week).slice(5, 7)) % 2 === 1;
  const loading = isLoading && present.length === 0;

  return (
    <div
      role="gridcell"
      aria-label={`Week of ${formatDateShort(week[0]!)}: ${formatNumber(total)} people, ${formatNumber(confirmed)} confirmed, ${formatNumber(pending)} pending, ${groups} ${groups === 1 ? "group" : "groups"}`}
      className={cn("flex min-h-0 flex-col items-end justify-end overflow-hidden rounded-lg border border-border px-2.5 py-2 text-right tabular", alternate ? "bg-nested" : "bg-card")}
    >
      {loading ? (
        <>
          <Skeleton className="h-6 w-16" />
          <Skeleton className="mt-2 h-3 w-12" />
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-1 whitespace-nowrap">
            <span className={cn("text-(length:--fy-week-interest) leading-none font-bold tracking-tight", total === 0 && "text-muted-foreground")}>{formatNumber(total)}</span>
            <span className="text-xs text-muted-foreground">people</span>
          </div>
          <div className="mt-1 text-xs leading-4 text-muted-foreground">
            {groups} {groups === 1 ? "group" : "groups"}
          </div>
          {total > 0 ? (
            <>
              <CapacityBar className="mt-1.5 w-full" confirmed={confirmed} pending={pending} caption="none" height={6} label={`${formatNumber(confirmed)} confirmed of ${formatNumber(total)}`} />
              <SplitCaption confirmed={confirmed} pending={pending} mode="compact" className="mt-1 justify-end text-muted-foreground" />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
