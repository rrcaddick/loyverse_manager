/**
 * /calendar — the season at a glance. Shared by admins and managers, so it
 * depends only on GET /calendar and GET /days/:date (the add-booking dialog
 * is admin-only and reads settings).
 *
 * URL state: ?month=YYYY-MM (visible month) and ?day=YYYY-MM-DD (open panel).
 */

import { AlertCircle, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import type { CalendarDay } from "@/features/bookings/types";
import { useCalendar, usePrefetchCalendar } from "@/features/calendar/api";
import { CalendarLegend } from "@/features/calendar/components/calendar-legend";
import { DayPanel } from "@/features/calendar/components/day-panel";
import { MonthGridView } from "@/features/calendar/components/month-grid";
import { MonthNav } from "@/features/calendar/components/month-nav";
import { buildMonthGrid, isMonthKey, monthKey, shiftMonth, todayMonth } from "@/features/calendar/month";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatMonthYear, formatNumber, pluralise, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function CalendarPage() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayIso();

  const monthParam = params.get("month");
  const month = isMonthKey(monthParam) ? monthParam : todayMonth();
  const dayParam = params.get("day");
  const selectedDate = dayParam && ISO_DAY.test(dayParam) ? dayParam : null;

  useDocumentTitle(`${formatMonthYear(`${month}-01`)} · Calendar`);

  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const calendar = useCalendar(grid.from, grid.to);
  const prefetch = usePrefetchCalendar();

  useEffect(() => {
    for (const delta of [-1, 1]) {
      const g = buildMonthGrid(shiftMonth(month, delta));
      void prefetch(g.from, g.to);
    }
  }, [month, prefetch]);

  const days = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const d of calendar.data?.days ?? []) map.set(d.date, d);
    return map;
  }, [calendar.data]);

  // Roving focus: today when visible, else the 1st of the month.
  const [focusedDate, setFocusedDate] = useState(() => (monthKey(today) === month ? today : `${month}-01`));
  const [focusRequest, setFocusRequest] = useState(0);
  const [addFor, setAddFor] = useState<string | null>(null);

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

  function changeMonth(next: string, focus?: string) {
    updateParams({ month: next === todayMonth() ? null : next });
    const target = focus ?? (monthKey(today) === next ? today : `${next}-01`);
    setFocusedDate(target);
    if (focus) setFocusRequest((n) => n + 1);
  }

  const inMonth = (calendar.data?.days ?? []).filter((d) => monthKey(d.date) === month);
  const totals = inMonth.reduce(
    (acc, d) => ({ bookings: acc.bookings + d.booking_count, people: acc.people + d.total_people, confirmed: acc.confirmed + d.confirmed_people }),
    { bookings: 0, people: 0, confirmed: 0 },
  );
  const stale = calendar.isPlaceholderData || (calendar.isFetching && !calendar.isPending);

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Every day of the season: who is booked, how many are confirmed, and which days are closed, peak or best avoided."
        actions={
          isAdmin ? (
            <Button onClick={() => setAddFor(selectedDate ?? (monthKey(today) === month ? today : `${month}-01`))}>
              <Plus data-icon="inline-start" />
              Add booking
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthNav month={month} onChange={(m) => changeMonth(m)} />
          <p className="text-sm text-muted-foreground tabular" aria-live="polite">
            {calendar.data ? (
              <>
                {pluralise(totals.bookings, "booking")} · <span className="font-medium text-foreground">{formatNumber(totals.confirmed)}</span> confirmed of{" "}
                {formatNumber(totals.people)} people
              </>
            ) : (
              "Loading month…"
            )}
          </p>
        </div>

        {calendar.isError ? (
          <Alert variant="destructive">
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

        <section
          aria-label={`${formatMonthYear(`${month}-01`)} grid`}
          className={cn("overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10 transition-opacity", stale && "opacity-80")}
        >
          <MonthGridView
            grid={grid}
            days={days}
            today={today}
            isLoading={calendar.isPending}
            focusedDate={focusedDate}
            selectedDate={selectedDate}
            focusRequest={focusRequest}
            onFocusDate={setFocusedDate}
            onOpenDate={(date) => updateParams({ day: date })}
            onChangeMonth={changeMonth}
          />
          <div className="flex flex-col gap-2 border-t border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <CalendarLegend />
            <p className="hidden text-xs text-muted-foreground xl:block">
              <kbd className="rounded border border-border bg-background px-1 font-sans">↑↓←→</kbd> move ·{" "}
              <kbd className="rounded border border-border bg-background px-1 font-sans">Enter</kbd> open ·{" "}
              <kbd className="rounded border border-border bg-background px-1 font-sans">PgUp</kbd>/<kbd className="rounded border border-border bg-background px-1 font-sans">PgDn</kbd> month
            </p>
          </div>
        </section>
      </div>

      <DayPanel
        date={selectedDate}
        day={selectedDate ? days.get(selectedDate) : undefined}
        open={!!selectedDate}
        onOpenChange={(open) => {
          if (!open) updateParams({ day: null });
        }}
        onAddBooking={(date) => {
          updateParams({ day: null });
          setAddFor(date);
        }}
      />

      {isAdmin ? (
        <BookingFormDialog open={addFor !== null} onOpenChange={(open) => !open && setAddFor(null)} defaultDate={addFor ?? undefined} />
      ) : null}
    </>
  );
}
