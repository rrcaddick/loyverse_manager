/**
 * One day of the grid (owner's layout of 29 Oct 2026, "try and maybe roll back"):
 *
 *   row 1   day number (today: filled disc) · the tag top right: OVER in red
 *           from Settings › Capacity › OVER threshold, else the day kind
 *   middle  the people booked, centred and large; the group count centred under it
 *   bottom  confirmed left with its green dot · pending right with its amber dot
 *           the bar: confirmed + pending against the day's capacity
 *
 * Fill = heat band of the people booked against capacity, five shades of one
 * blue, ink text on all. The day kind (Settings › Day kinds) is the cell's
 * border colour. No names: they live in the panel.
 */

import { CapacityBar } from "@/components/capacity-bar";
import type { CalendarDay } from "@/features/bookings/types";
import { formatDateLong, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { heatLevel } from "../heat";
import { dayNumberLabel } from "../month";

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
        "fy-cell @container relative flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-lg border-2 border-border bg-card px-2 pt-1.5 pb-2 text-left text-heat-text outline-hidden select-none",
        "hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring",
        HEAT_CLASS[level],
        !kind && "border-border",
        isSelected && "border-primary ring-2 ring-selection-ring",
      )}
    >
      <div className="flex h-[1.375rem] shrink-0 items-center justify-between gap-1">
        <span
          className={cn(
            "shrink-0 text-sm leading-none font-semibold tabular",
            isToday && "-ml-0.5 inline-flex h-[1.375rem] min-w-[1.375rem] items-center justify-center rounded-full bg-primary px-1.5 text-primary-foreground",
          )}
        >
          {dayNumberLabel(date)}
        </span>
        {over ? (
          <span className="shrink-0 rounded-sm bg-red-solid px-1 text-xs leading-4 font-semibold tracking-[0.04em] text-on-solid uppercase">Over</span>
        ) : kind ? (
          <span className="min-w-0 truncate text-xs leading-4 font-semibold" style={{ color: kind.colour }} title={kind.label}>
            {kind.label}
          </span>
        ) : null}
      </div>

      {groups > 0 || total > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden text-center whitespace-nowrap">
          <span className="text-(length:--fy-interest) leading-none font-bold tracking-tight tabular">{formatNumber(total)}</span>
          <span className={cn("text-sm leading-4 font-medium", level === 0 && "text-muted-foreground")}>
            {groups} {groups === 1 ? "group" : "groups"}
          </span>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {total > 0 ? (
        <div className="flex shrink-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-xs leading-4 font-medium whitespace-nowrap tabular" aria-hidden="true">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 shrink-0 rounded-full bg-green-solid" />
              {formatNumber(confirmed)}
            </span>
            <span className="inline-flex items-center gap-1">
              {formatNumber(pending)}
              <span className="size-2 shrink-0 rounded-full bg-amber-solid" />
            </span>
          </div>
          <CapacityBar confirmed={confirmed} pending={pending} capacity={capacity} caption="none" height={6} label={`${formatNumber(confirmed)} confirmed and ${formatNumber(pending)} pending of ${formatNumber(capacity)}`} />
        </div>
      ) : null}
    </div>
  );
}
