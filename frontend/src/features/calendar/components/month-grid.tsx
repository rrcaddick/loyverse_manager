/**
 * The month grid: an ARIA grid (role="grid" / "row" / "gridcell") with a
 * roving tabindex. One cell per day plus a week-totals cell per row.
 *
 * Keyboard: arrows move a day/week, Home/End jump to Monday/Sunday,
 * PageUp/PageDown change month, Enter/Space open the focused day.
 */

import { AlertCircle, Flame } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CalendarDay, CalendarDayBooking } from "@/features/bookings/types";
import { formatDateLong, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STATUS_DOT, WEEKDAY_HEADERS, chipName, heatLevel, monthKey, shiftDay, shiftMonth, type MonthGrid } from "../month";

import "../calendar.css";

const MAX_CHIPS = 3;

export interface MonthGridProps {
  grid: MonthGrid;
  days: Map<string, CalendarDay>;
  today: string;
  isLoading: boolean;
  focusedDate: string;
  selectedDate: string | null;
  onFocusDate: (date: string) => void;
  onOpenDate: (date: string) => void;
  onChangeMonth: (month: string, focusDate: string) => void;
  /** Set when a keyboard month change should move DOM focus to the new cell. */
  focusRequest: number;
}

export function MonthGridView({
  grid,
  days,
  today,
  isLoading,
  focusedDate,
  selectedDate,
  onFocusDate,
  onOpenDate,
  onChangeMonth,
  focusRequest,
}: MonthGridProps) {
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const lastFocusRequest = useRef(focusRequest);
  const pendingFocus = useRef<string | null>(null);

  const register = useCallback((date: string) => (el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(date, el);
    else cellRefs.current.delete(date);
  }, []);

  // After a keyboard-driven month change the focused date lives in a cell that
  // may only exist once the new month has rendered; keep trying until it does.
  useLayoutEffect(() => {
    if (focusRequest !== lastFocusRequest.current) {
      lastFocusRequest.current = focusRequest;
      pendingFocus.current = focusedDate;
    }
    const target = pendingFocus.current;
    if (!target) return;
    const el = cellRefs.current.get(target);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  useEffect(() => {
    // Keep the DOM focus with the roving cell when the user moves within the month.
    const active = document.activeElement;
    if (active && cellRefs.current.has((active as HTMLElement).dataset.date ?? "")) {
      cellRefs.current.get(focusedDate)?.focus();
    }
  }, [focusedDate]);

  function moveFocus(next: string) {
    if (monthKey(next) !== grid.month && (next < grid.from || next > grid.to)) {
      onChangeMonth(monthKey(next), next);
      return;
    }
    onFocusDate(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = focusedDate;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
        moveFocus(shiftDay(current, -1));
        break;
      case "ArrowRight":
        moveFocus(shiftDay(current, 1));
        break;
      case "ArrowUp":
        moveFocus(shiftDay(current, -7));
        break;
      case "ArrowDown":
        moveFocus(shiftDay(current, 7));
        break;
      case "Home": {
        const row = grid.weeks.find((w) => w.includes(current));
        if (row?.[0]) onFocusDate(row[0]);
        break;
      }
      case "End": {
        const row = grid.weeks.find((w) => w.includes(current));
        if (row?.[6]) onFocusDate(row[6]);
        break;
      }
      case "PageUp":
      case "PageDown": {
        const delta = event.key === "PageUp" ? -1 : 1;
        const month = shiftMonth(grid.month, delta);
        const day = Math.min(Number(current.slice(8, 10)), daysInMonth(month));
        onChangeMonth(month, `${month}-${String(day).padStart(2, "0")}`);
        break;
      }
      case "Enter":
      case " ":
        onOpenDate(current);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  return (
    <div
      role="grid"
      aria-label={`Bookings calendar, ${grid.month}`}
      aria-busy={isLoading || undefined}
      className="flex flex-col gap-1.5 p-3 sm:p-4"
      onKeyDown={onKeyDown}
    >
      <div role="row" className="grid grid-cols-7 gap-1.5 md:grid-cols-[repeat(7,minmax(0,1fr))_minmax(6rem,0.55fr)]">
        {WEEKDAY_HEADERS.map((label) => (
          <div
            key={label}
            role="columnheader"
            className="px-1 pb-1 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            {label}
          </div>
        ))}
        <div role="columnheader" className="hidden px-1 pb-1 text-right text-xs font-medium tracking-wide text-muted-foreground uppercase md:block">
          Week
        </div>
      </div>

      {grid.weeks.map((week, index) => {
        const weekDays = week.map((d) => days.get(d)).filter((d): d is CalendarDay => !!d);
        const confirmed = weekDays.reduce((n, d) => n + d.confirmed_people, 0);
        const total = weekDays.reduce((n, d) => n + d.total_people, 0);
        const bookings = weekDays.reduce((n, d) => n + d.booking_count, 0);
        return (
          <div key={week[0] ?? index} role="row" className="grid grid-cols-7 gap-1.5 md:grid-cols-[repeat(7,minmax(0,1fr))_minmax(6rem,0.55fr)]">
            {week.map((date) =>
              isLoading && !days.has(date) ? (
                <div key={date} role="gridcell" aria-busy="true" className="min-h-16 rounded-lg md:min-h-28">
                  <Skeleton className="size-full rounded-lg" />
                </div>
              ) : (
                <DayCell
                  key={date}
                  ref={register(date)}
                  date={date}
                  day={days.get(date)}
                  inMonth={monthKey(date) === grid.month}
                  isToday={date === today}
                  isFocused={date === focusedDate}
                  isSelected={date === selectedDate}
                  onFocus={() => onFocusDate(date)}
                  onOpen={() => onOpenDate(date)}
                />
              ),
            )}
            <div
              role="gridcell"
              aria-label={`Week totals: ${formatNumber(confirmed)} confirmed of ${formatNumber(total)} people, ${formatNumber(bookings)} bookings`}
              className="hidden min-h-28 flex-col justify-end rounded-lg border border-dashed border-border px-2.5 py-2 text-right md:flex"
            >
              {isLoading && weekDays.length === 0 ? (
                <Skeleton className="h-8 w-16 self-end" />
              ) : (
                <div className="tabular">
                  <div className="text-lg leading-6 font-semibold text-foreground">{formatNumber(confirmed)}</div>
                  <div className="text-xs text-muted-foreground">of {formatNumber(total)} people</div>
                  <div className="text-xs text-muted-foreground">{formatNumber(bookings)} {bookings === 1 ? "booking" : "bookings"}</div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y ?? 2000, m ?? 1, 0).getDate();
}

// ---------------------------------------------------------------- day cell

interface DayCellProps {
  ref: (el: HTMLDivElement | null) => void;
  date: string;
  day: CalendarDay | undefined;
  inMonth: boolean;
  isToday: boolean;
  isFocused: boolean;
  isSelected: boolean;
  onFocus: () => void;
  onOpen: () => void;
}

function describe(date: string, day: CalendarDay | undefined, isToday: boolean): string {
  const parts = [formatDateLong(date)];
  if (isToday) parts.push("today");
  if (!day) return parts.join(", ");
  if (day.is_closed) parts.push(day.label ? `closed, ${day.label}` : "closed");
  else if (day.label) parts.push(day.label);
  if (day.is_peak) parts.push("peak day");
  if (day.is_avoid) parts.push("avoid day");
  if (day.booking_count === 0) parts.push("no bookings");
  else {
    parts.push(`${formatNumber(day.booking_count)} ${day.booking_count === 1 ? "booking" : "bookings"}`);
    parts.push(`${formatNumber(day.confirmed_people)} confirmed of ${formatNumber(day.total_people)} people`);
  }
  if (day.capacity_warning) parts.push("over the daily capacity warning");
  return parts.join(", ");
}

function DayCell({ ref, date, day, inMonth, isToday, isFocused, isSelected, onFocus, onOpen }: DayCellProps) {
  const level = day ? heatLevel(day.total_people) : 0;
  const total = day?.total_people ?? 0;
  const confirmed = day?.confirmed_people ?? 0;
  const tentative = day?.tentative_people ?? 0;
  const confirmedPct = total > 0 ? (confirmed / total) * 100 : 0;
  const tentativePct = total > 0 ? (tentative / total) * 100 : 0;
  const dayNumber = Number(date.slice(8, 10));
  const chips = day?.bookings.slice(0, MAX_CHIPS) ?? [];
  const more = (day?.bookings.length ?? 0) - chips.length;

  return (
    <div
      ref={ref}
      role="gridcell"
      tabIndex={isFocused ? 0 : -1}
      data-date={date}
      data-heat={level}
      aria-selected={isSelected || undefined}
      aria-label={describe(date, day, isToday)}
      onFocus={onFocus}
      onClick={onOpen}
      className={cn(
        "fy-heat group/day relative flex min-h-16 cursor-pointer flex-col gap-1 rounded-lg border p-1.5 text-left outline-none transition-[box-shadow] md:min-h-28 md:p-2",
        "border-foreground/8 hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        level === 0 && "bg-card",
        day?.is_closed && "fy-closed",
        day?.is_avoid && "border-dashed border-foreground/35",
        isSelected && "border-primary ring-2 ring-primary/40",
        !inMonth && "opacity-55",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm tabular",
            isToday ? "font-semibold ring-2 ring-current" : "font-medium",
            !inMonth && "fy-heat-muted",
          )}
        >
          {dayNumber}
        </span>
        <span className="flex items-center gap-1">
          {day?.is_peak ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" aria-hidden="true" tabIndex={-1}>
                  <Flame className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>Peak day — peak price applies</TooltipContent>
            </Tooltip>
          ) : null}
          {day?.capacity_warning ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex size-4 items-center justify-center" aria-hidden="true" tabIndex={-1}>
                  <span className="size-2 rounded-full bg-red-500 shadow-[0_0_0_2px_var(--card)]" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <AlertCircle aria-hidden="true" className="size-3.5" />
                {formatNumber(total)} people booked — above the daily capacity warning
              </TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      </div>

      {day?.label || day?.is_closed ? (
        <span className={cn("fy-heat-muted hidden truncate text-[11px] leading-4 md:block", day.is_closed && "font-medium")}>
          {day.label ?? (day.is_closed ? "Closed" : null)}
        </span>
      ) : null}

      {chips.length > 0 ? (
        <ul className="hidden min-h-0 flex-1 flex-col gap-0.5 overflow-hidden md:flex" aria-hidden="true">
          {chips.map((b) => (
            <BookingChip key={b.id} booking={b} />
          ))}
          {more > 0 ? <li className="fy-heat-muted truncate pl-3.5 text-[11px] leading-4">+{more} more</li> : null}
        </ul>
      ) : (
        <span className="hidden flex-1 md:block" />
      )}

      {total > 0 ? (
        <div className="mt-auto flex flex-col gap-1">
          <div className="hidden items-baseline justify-between gap-1 text-xs leading-4 tabular md:flex">
            <span className="truncate">
              <span className="font-semibold">{formatNumber(confirmed)}</span>
              <span className="fy-heat-muted"> / {formatNumber(total)}</span>
            </span>
            {day && day.booking_count > 0 ? (
              <span className="fy-heat-muted hidden truncate text-[11px] lg:inline">
                {day.booking_count} {day.booking_count === 1 ? "grp" : "grps"}
              </span>
            ) : null}
          </div>
          <div className="fy-bar-track flex h-1 w-full overflow-hidden rounded-full" aria-hidden="true">
            {confirmedPct > 0 ? <span className="fy-bar-confirmed h-full" style={{ width: `${confirmedPct}%` }} /> : null}
            {tentativePct > 0 ? (
              <span className={cn("fy-bar-tentative h-full", confirmedPct > 0 && "ml-px")} style={{ width: `calc(${tentativePct}% - ${confirmedPct > 0 ? 1 : 0}px)` }} />
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-auto h-1 md:h-5" aria-hidden="true" />
      )}
    </div>
  );
}

function BookingChip({ booking }: { booking: CalendarDayBooking }) {
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
      <span className={cn("size-1.5 shrink-0 rounded-full shadow-[0_0_0_1px_var(--card)]", STATUS_DOT[booking.status] ?? "bg-foreground")} />
      <span className="truncate">{chipName(booking.group_name)}</span>
    </li>
  );
}
