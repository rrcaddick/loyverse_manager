/**
 * The week-window grid: an ARIA grid (role="grid" / "row" / "gridcell") with
 * a roving tabindex, N week rows (`repeat(N, minmax(104px, 1fr))`) of seven
 * day cells plus the week-summary cell, 6 px gaps.
 *
 * Keyboard (focus on a cell): ← → a day, ↑ ↓ a week, Home/End the row's
 * Monday/Sunday, PageUp/PageDown a month, Enter/Space opens the day. When
 * the target leaves the window the page shifts it (`onMoveFocus`). The mouse
 * wheel over the grid moves the window one week at a time.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type WheelEvent } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { CalendarDay } from "@/features/bookings/types";
import { cn } from "@/lib/utils";

import { WEEKDAY_HEADERS, anchorMonth, inWindow, sameDayInMonth, shiftDay, shiftMonth, windowTitle, type CalendarWindow } from "../month";
import { DayCell } from "./day-cell";
import { WeekCell } from "./week-cell";

const COLUMNS = "repeat(7, minmax(0, 1fr)) var(--fy-week-col)";
const WHEEL_STEP = 50;
const WHEEL_LOCK_MS = 180;

export type FocusStep = "day" | "week" | "month";

export interface CalendarGridProps {
  window: CalendarWindow;
  days: Map<string, CalendarDay>;
  today: string;
  capacity: number;
  isLoading: boolean;
  focusedDate: string;
  selectedDate: string | null;
  /** Bump to move DOM focus to `focusedDate` once its cell exists. */
  focusRequest: number;
  onFocusDate: (date: string) => void;
  onOpenDate: (date: string) => void;
  /** A keyboard move whose target may be outside the window. */
  onMoveFocus: (target: string, step: FocusStep) => void;
  onWheelWeeks: (delta: 1 | -1) => void;
}

export function CalendarGrid({
  window: view,
  days,
  today,
  capacity,
  isLoading,
  focusedDate,
  selectedDate,
  focusRequest,
  onFocusDate,
  onOpenDate,
  onMoveFocus,
  onWheelWeeks,
}: CalendarGridProps) {
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const lastFocusRequest = useRef(focusRequest);
  const pendingFocus = useRef<string | null>(null);
  const wheel = useRef({ acc: 0, lockUntil: 0, last: 0 });

  const register = useCallback(
    (date: string) => (el: HTMLDivElement | null) => {
      if (el) cellRefs.current.set(date, el);
      else cellRefs.current.delete(date);
    },
    [],
  );

  // A requested focus may point at a cell that only exists after the window
  // has re-rendered; keep trying until it does.
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
      el.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    // Keep DOM focus with the roving cell while the person moves within the window.
    const active = document.activeElement as HTMLElement | null;
    if (active && cellRefs.current.has(active.dataset.date ?? "")) {
      cellRefs.current.get(focusedDate)?.focus({ preventScroll: true });
    }
  }, [focusedDate]);

  function move(target: string, step: FocusStep) {
    if (inWindow(view, target)) onFocusDate(target);
    else onMoveFocus(target, step);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = (event.target as HTMLElement).dataset.date;
    if (!current) return;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
        move(shiftDay(current, -1), "day");
        break;
      case "ArrowRight":
        move(shiftDay(current, 1), "day");
        break;
      case "ArrowUp":
        move(shiftDay(current, -7), "week");
        break;
      case "ArrowDown":
        move(shiftDay(current, 7), "week");
        break;
      case "Home": {
        const row = view.weeks.find((w) => w.includes(current));
        if (row?.[0]) onFocusDate(row[0]);
        break;
      }
      case "End": {
        const row = view.weeks.find((w) => w.includes(current));
        if (row?.[6]) onFocusDate(row[6]);
        break;
      }
      case "PageUp":
      case "PageDown": {
        const month = shiftMonth(anchorMonth(view.from), event.key === "PageUp" ? -1 : 1);
        move(sameDayInMonth(current, month), "month");
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

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const now = Date.now();
    const state = wheel.current;
    if (now - state.last > 300) state.acc = 0;
    state.last = now;
    if (now < state.lockUntil) return;
    state.acc += event.deltaY;
    if (Math.abs(state.acc) >= WHEEL_STEP) {
      onWheelWeeks(state.acc > 0 ? 1 : -1);
      state.acc = 0;
      state.lockUntil = now + WHEEL_LOCK_MS;
    }
  }

  return (
    <div role="grid" aria-label={`Bookings calendar, ${windowTitle(view)}`} aria-busy={isLoading || undefined} className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div role="row" className="grid h-6 shrink-0 items-center gap-x-1.5 px-3" style={{ gridTemplateColumns: COLUMNS }}>
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label} role="columnheader" className="text-label px-2 text-muted-foreground uppercase">
            {label}
          </div>
        ))}
        <div role="columnheader" className="text-label px-2.5 text-right text-muted-foreground uppercase">
          Week
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1 gap-1.5 overflow-y-auto px-3 pb-1.5 scrollbar-thin"
        style={{ gridTemplateColumns: COLUMNS, gridTemplateRows: `repeat(${view.rows}, minmax(104px, 1fr))` }}
        onWheel={onWheel}
      >
        {view.weeks.map((week) => (
          <div key={week[0]} role="row" className="contents">
            {week.map((date) =>
              isLoading && !days.has(date) ? (
                <div key={date} role="gridcell" aria-busy="true" className={cn("rounded-lg", date === focusedDate && "ring-2 ring-selection-ring")}>
                  <Skeleton className="size-full rounded-lg" />
                </div>
              ) : (
                <DayCell
                  key={date}
                  ref={register(date)}
                  date={date}
                  day={days.get(date)}
                  isToday={date === today}
                  capacity={capacity}
                  isFocused={date === focusedDate}
                  isSelected={date === selectedDate}
                  onFocus={() => onFocusDate(date)}
                  onOpen={() => onOpenDate(date)}
                />
              ),
            )}
            <WeekCell week={week} days={days} isLoading={isLoading} />
          </div>
        ))}
      </div>
    </div>
  );
}
