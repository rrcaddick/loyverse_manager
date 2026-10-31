/**
 * The seven-day strip shown on a closed or empty day (spec §3): one small
 * cell per day — weekday, day number, groups · people — closed days hatched,
 * today ringed. Each cell opens that day.
 */

import { Link } from "react-router";

import { formatDayMonth, formatNumber, formatWeekday, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { StripDay } from "../types";

export function SevenDayStrip({ days, className }: { days: StripDay[]; className?: string }) {
  const today = todayIso();
  return (
    <ol className={cn("grid grid-cols-7 gap-2", className)} aria-label="The next seven days">
      {days.map((day) => {
        const isToday = day.date === today;
        const label = day.is_closed ? "Closed" : day.groups > 0 ? `${formatNumber(day.groups)} ${day.groups === 1 ? "grp" : "grps"} · ${formatNumber(day.people)}` : "Open";
        return (
          <li key={day.date} className="min-w-0">
            <Link
              to={`/today/${day.date}`}
              aria-label={`${formatWeekday(day.date)} ${formatDayMonth(day.date)}: ${label}`}
              className={cn(
                "flex min-h-[4.5rem] flex-col rounded-lg bg-card px-2 py-1.5 ring-1 ring-border outline-none transition-colors hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring",
                day.is_closed && "hatched text-muted-foreground",
                isToday && "ring-2 ring-selection-ring",
              )}
            >
              <span className="text-label text-muted-foreground uppercase">{formatWeekday(day.date).slice(0, 3)}</span>
              <span className={cn("text-section tabular", isToday && "text-primary")}>{formatDayMonth(day.date)}</span>
              <span className={cn("mt-auto truncate text-xs tabular", day.groups > 0 && !day.is_closed ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
