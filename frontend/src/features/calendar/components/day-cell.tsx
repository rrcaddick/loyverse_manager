/**
 * One day of the grid (owner's layout of 29 Oct and 31 Oct 2026):
 *
 *   row 1   day number (today: filled disc) · OVER top right when the day has
 *           passed Settings › Capacity › OVER threshold (the only tag)
 *   middle  the people booked, centred and large; the group count under it
 *   bottom  the two numbers, confirmed left and pending right, over the split
 *           bar: confirmed (green) against pending (amber), a ratio of the two
 *
 * Fill = heat band of the people booked against capacity, five shades of one
 * blue, ink text on all. The day kind (Settings › Day kinds) is the cell's
 * 3 px border colour; the legend names them. A closed day with nothing on it
 * is hatched and says CLOSED; a booking makes a day open. No names: they
 * live in the panel.
 */

import type { CalendarDay } from "@/features/bookings/types";
import { formatDateLong, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { heatLevel } from "../heat";
import { dayNumberLabel } from "../month";
import { SplitBar } from "./split-bar";

const HEAT_CLASS = ["", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

export interface DayCellProps {
  ref: (el: HTMLDivElement | null) => void;
  date: string;
  day: CalendarDay | undefined;
  isToday: boolean;
  capacity: number;
  isFocused: boolean;
  isSelected: boolean;
  onFocus: () => void;
  onOpen: () => void;
}

function describe(date: string, day: CalendarDay | undefined, isToday: boolean): string {
  const parts = [formatDateLong(date)];
  if (isToday) parts.push("today");
  if (!day) return parts.join(", ");
  if (day.is_closed) parts.push("closed");
  if (day.kind) parts.push(day.kind.label.toLowerCase());
  if (day.label && (!day.kind || day.label !== day.kind.label)) parts.push(day.label);
  if (day.booking_count === 0) parts.push("no bookings");
  else {
    parts.push(`${formatNumber(day.total_people)} people`);
    parts.push(`${formatNumber(day.confirmed_people)} confirmed, ${formatNumber(day.tentative_people)} pending`);
    parts.push(`${formatNumber(day.booking_count)} ${day.booking_count === 1 ? "group" : "groups"}`);
  }
  if (day.over) parts.push("over the limit");
  return parts.join(", ");
}

export function DayCell({ ref, date, day, isToday, capacity, isFocused, isSelected, onFocus, onOpen }: DayCellProps) {
  const total = day?.total_people ?? 0;
  const confirmed = day?.confirmed_people ?? 0;
  const pending = day?.tentative_people ?? 0;
  const groups = day?.booking_count ?? 0;
  const level = heatLevel(total, capacity);
  const kind = day?.kind ?? null;
  const over = !!day?.over;
  const hasNumbers = groups > 0 || total > 0;
  // A day with a booking on it is open, whatever the closures list says.
  const closed = !!day?.is_closed && !hasNumbers;

  return (
    <div
      ref={ref}
      role="gridcell"
      tabIndex={isFocused ? 0 : -1}
      data-date={date}
      data-heat={level}
      data-kind={kind?.code}
      aria-selected={isSelected || undefined}
      aria-label={describe(date, day, isToday)}
      onFocus={onFocus}
      onClick={onOpen}
      style={kind && !isSelected ? { borderColor: kind.colour } : undefined}
      className={cn(
        "fy-cell @container relative flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card px-2 pt-1 pb-1.5 text-left text-heat-text outline-hidden select-none",
        "hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring",
        HEAT_CLASS[level],
        closed && "fy-closed",
        isSelected && "border-primary ring-2 ring-selection-ring",
      )}
    >
      <div className="flex h-5 shrink-0 items-center justify-between gap-1">
        <span
          className={cn(
            "shrink-0 text-sm leading-none font-semibold tabular",
            isToday && "-ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-primary-foreground",
          )}
        >
          {dayNumberLabel(date)}
        </span>
        {over ? (
          <span className="shrink-0 rounded-sm bg-red-solid px-1 text-xs leading-4 font-semibold tracking-[0.04em] text-on-solid uppercase">Over</span>
        ) : closed && hasNumbers ? (
          <span className="shrink-0 text-xs leading-4 font-semibold tracking-[0.08em] text-muted-foreground uppercase">Closed</span>
        ) : null}
      </div>

      {hasNumbers ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center pb-1 text-center leading-none whitespace-nowrap">
          <span className="text-(length:--fy-interest) leading-none font-bold tracking-tight tabular">{formatNumber(total)}</span>
          <span className={cn("mt-0.5 text-[0.8125rem] leading-4 font-medium", level === 0 && "text-muted-foreground")}>
            {groups} {groups === 1 ? "group" : "groups"}
          </span>
        </div>
      ) : closed ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">Closed</span>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {total > 0 ? <SplitBar confirmed={confirmed} pending={pending} className="shrink-0" /> : null}
    </div>
  );
}
