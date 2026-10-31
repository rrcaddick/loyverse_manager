/**
 * The week-summary column, in the day cell's own style: the people booked
 * centred and large, the group count under it, the confirmed-against-pending
 * split with its numbers under. No heat. The background alternates by
 * calendar month (the week's Thursday) so a two-month window reads as two.
 */

import { Skeleton } from "@/components/ui/skeleton";
import type { CalendarDay } from "@/features/bookings/types";
import { formatDateShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { weekMonthKey } from "../month";
import { SplitBar } from "./split-bar";

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
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border-[3px] border-border px-2 pt-1 pb-1.5 tabular", alternate ? "bg-nested" : "bg-card")}
    >
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
      ) : (
        <>
          <div className="h-5 shrink-0" />
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center pb-1 text-center leading-none whitespace-nowrap">
            <span className={cn("text-(length:--fy-week-interest) leading-none font-bold tracking-tight", total === 0 && "text-muted-foreground")}>{formatNumber(total)}</span>
            <span className={cn("mt-0.5 text-[0.8125rem] leading-4 font-medium", total === 0 && "text-muted-foreground")}>
              {groups} {groups === 1 ? "group" : "groups"}
            </span>
          </div>
          {total > 0 ? <SplitBar confirmed={confirmed} pending={pending} className="shrink-0" /> : null}
        </>
      )}
    </div>
  );
}
