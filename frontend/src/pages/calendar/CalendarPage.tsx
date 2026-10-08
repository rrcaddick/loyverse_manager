/**
 * /calendar — the season at a glance, for admins and managers.
 *
 * A viewport-fit flex column under the header: toolbar 44 · weekday headers
 * 24 · the week-window grid · legend 28, with the non-modal day panel beside
 * it. No page title, no page scroll (docs/redesign-spec.md §5,
 * docs/handoff/frontend-calendar-v2.md).
 *
 * URL state: ?from=<Monday> (the first visible week; absent = today's week in
 * row 2) and ?day=YYYY-MM-DD (the open panel).
 *
 * Data: GET /calendar?from&to for the visible window (adjacent windows are
 * prefetched), GET /settings for the capacity setting (admin; managers fall
 * back to DEFAULT_CAPACITY), GET /days/:date inside the panel for balances.
 */

import { AlertCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import type { CalendarDay } from "@/features/bookings/types";
import { useCalendar, usePrefetchCalendar } from "@/features/calendar/api";
import { CalendarGrid, type FocusStep } from "@/features/calendar/components/calendar-grid";
import { CalendarLegend } from "@/features/calendar/components/calendar-legend";
import { CalendarToolbar, type WindowTotals } from "@/features/calendar/components/calendar-toolbar";
import { DayPanel } from "@/features/calendar/components/day-panel";
import { DEFAULT_CAPACITY } from "@/features/calendar/heat";
import {
  anchorMonth,
  buildWindow,
  inWindow,
  isIsoDate,
  monthStartWindow,
  normaliseFrom,
  sameDayInMonth,
  shiftDay,
  shiftMonth,
  shiftWindowMonth,
  windowTitle,
  windowWithInRowTwo,
} from "@/features/calendar/month";
import { useViewportRows } from "@/features/calendar/use-viewport-rows";
import { useSettings } from "@/features/settings/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShortcut } from "@/hooks/use-keyboard";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { todayIso } from "@/lib/format";

import "@/features/calendar/calendar.css";

export default function CalendarPage() {
  const { isAdmin } = useAuth();
  useSidebarCollapsed();
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const rows = useViewportRows();

  const from = normaliseFrom(params.get("from"), today);
  const view = useMemo(() => buildWindow(from, rows), [from, rows]);
  const dayParam = params.get("day");
  const selectedDate = isIsoDate(dayParam) ? dayParam : null;
  const title = windowTitle(view);
  useDocumentTitle(`${title} · Calendar`);

  const calendar = useCalendar(view.from, view.to);
  const prefetch = usePrefetchCalendar();
  const settings = useSettings({ enabled: isAdmin });
  const capacity = settings.data?.settings.capacity.daily_warning_people ?? DEFAULT_CAPACITY;

  useEffect(() => {
    const neighbours = new Set([shiftDay(view.from, -7), shiftDay(view.from, 7), shiftWindowMonth(view.from, -1), shiftWindowMonth(view.from, 1)]);
    for (const start of neighbours) {
      const w = buildWindow(start, view.rows);
      void prefetch(w.from, w.to);
    }
  }, [view.from, view.rows, prefetch]);

  const days = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const d of calendar.data?.days ?? []) map.set(d.date, d);
    return map;
  }, [calendar.data]);

  const totals = useMemo<WindowTotals | null>(() => {
    if (!calendar.data) return null;
    const acc = { people: 0, confirmed: 0, groups: 0 };
    for (const date of view.dates) {
      const d = days.get(date);
      if (!d) continue;
      acc.people += d.total_people;
      acc.confirmed += d.confirmed_people;
      acc.groups += d.booking_count;
    }
    return acc;
  }, [calendar.data, days, view.dates]);

  // ---- url state
  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setFrom = useCallback(
    (nextFrom: string) => updateParams({ from: nextFrom === windowWithInRowTwo(today) ? null : nextFrom }),
    [updateParams, today],
  );

  // ---- roving focus: one tabbable cell, always inside the window
  const [focusedDate, setFocusedDate] = useState(() => (inWindow(view, today) ? today : view.from));
  const [focusRequest, setFocusRequest] = useState(0);
  const effectiveFocus = inWindow(view, focusedDate) ? focusedDate : inWindow(view, today) ? today : view.from;

  function focusCell(date: string) {
    setFocusedDate(date);
    setFocusRequest((n) => n + 1);
  }

  function goToday() {
    setFrom(windowWithInRowTwo(today));
    focusCell(today);
  }

  function stepWeeks(delta: 1 | -1) {
    setFrom(shiftDay(view.from, 7 * delta));
  }

  function stepMonth(delta: 1 | -1) {
    const nextFrom = shiftWindowMonth(view.from, delta);
    setFrom(nextFrom);
    const target = sameDayInMonth(effectiveFocus, shiftMonth(anchorMonth(view.from), delta));
    setFocusedDate(inWindow(buildWindow(nextFrom, rows), target) ? target : nextFrom);
  }

  function pickMonth(month: string) {
    const nextFrom = monthStartWindow(month);
    setFrom(nextFrom);
    setFocusedDate(`${month}-01`);
  }

  /** A keyboard move whose target lies outside the window: shift it and follow. */
  function moveFocusOutside(target: string, step: FocusStep) {
    let nextFrom = step === "month" ? shiftWindowMonth(view.from, target > view.to ? 1 : -1) : shiftDay(view.from, target > view.to ? 7 : -7);
    if (!inWindow(buildWindow(nextFrom, rows), target)) nextFrom = windowWithInRowTwo(target);
    setFrom(nextFrom);
    focusCell(target);
  }

  function openDay(date: string) {
    updateParams({ day: date });
    setFocusedDate(date);
  }

  const closePanel = useCallback(() => updateParams({ day: null }), [updateParams]);

  // Keys outside the grid (inside it the cells handle their own arrows).
  useShortcut("t", goToday);
  useShortcut("pageup", () => stepMonth(-1));
  useShortcut("pagedown", () => stepMonth(1));
  useShortcut("arrowleft", () => stepMonth(-1));
  useShortcut("arrowright", () => stepMonth(1));
  useShortcut("arrowup", () => stepWeeks(-1));
  useShortcut("arrowdown", () => stepWeeks(1));
  useShortcut("escape", closePanel, { enabled: selectedDate !== null });

  const [addFor, setAddFor] = useState<string | null>(null);

  return (
    // Positioned under the header on its own so it fits the viewport without
    // the route's `layout: "full"` handle (requested in the handoff).
    <div className="fy-cal absolute inset-x-0 top-header bottom-0 flex min-h-0 overflow-hidden bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <CalendarToolbar window={view} title={title} totals={totals} onToday={goToday} onMonth={stepMonth} onWeek={stepWeeks} onPickMonth={pickMonth} />

        {calendar.isError ? (
          <Alert variant="destructive" className="m-3 shrink-0">
            <AlertCircle />
            <AlertTitle>Could not load the calendar</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{errorMessage(calendar.error)}</span>
              <Button variant="outline" size="sm" onClick={() => calendar.refetch()}>
                <RefreshCw data-icon="inline-start" />
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <CalendarGrid
          window={view}
          days={days}
          today={today}
          capacity={capacity}
          isLoading={calendar.isPending}
          focusedDate={effectiveFocus}
          selectedDate={selectedDate}
          focusRequest={focusRequest}
          onFocusDate={setFocusedDate}
          onOpenDate={openDay}
          onMoveFocus={moveFocusOutside}
          onWheelWeeks={stepWeeks}
        />

        <CalendarLegend capacity={capacity} />
      </div>

      {selectedDate ? (
        <DayPanel
          key={selectedDate}
          date={selectedDate}
          day={days.get(selectedDate)}
          today={today}
          onClose={closePanel}
          onAddBooking={(date) => setAddFor(date)}
        />
      ) : null}

      {isAdmin ? <BookingFormDialog open={addFor !== null} onOpenChange={(open) => !open && setAddFor(null)} defaultDate={addFor ?? undefined} /> : null}
    </div>
  );
}
