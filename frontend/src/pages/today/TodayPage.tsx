/**
 * /today and /today/:date — the home and the day view in one screen
 * (spec §3 and the day-view part of §5). Above the fold at 1440×900:
 *
 *   ‹ Saturday 7 November ›  · Today · Calendar · Add booking      flags beneath
 *   [Groups today] [People] [Owed at the gate] [Needs you → Work]  (manager: Expected · Arrived · Still to come)
 *   the day's groups as a 56 px table (two thirds)  |  Up next (five Work rows) + the System line (admin)
 *
 * A closed or empty day shows the next visit day and a seven-day strip
 * instead of the table. Keys: T today, ← → previous / next day.
 */

import { useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek } from "date-fns";
import { AlertCircle, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, ListChecks, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

import { BigNumber, BigNumberRow } from "@/components/big-number";
import { EmptyState } from "@/components/empty-state";
import { KeyboardHint } from "@/components/keyboard-hint";
import { SectionHeader } from "@/components/section-header";
import { StatusPill } from "@/components/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import { relativeDayLabel } from "@/features/bookings/lib";
import { useDay } from "@/features/calendar/api";
import { shiftDay } from "@/features/calendar/month";
import { invalidateDayWorld, mergeDayRows, rowsFromToday, sortDayRows, useToday } from "@/features/today/api";
import { DayTable } from "@/features/today/components/day-table";
import { SevenDayStrip } from "@/features/today/components/seven-day-strip";
import { SystemStatusLine } from "@/features/today/components/system-status-line";
import type { TodayResponse } from "@/features/today/types";
import { WorkRow } from "@/features/work/components/work-row";
import { useWorkActions } from "@/features/work/use-work-actions";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShortcut } from "@/hooks/use-keyboard";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateLong, formatDateShort, formatMoney, formatNumber, parseDate, pluralise, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function TodayPage() {
  const { date: param } = useParams<{ date: string }>();
  const date = param ?? todayIso();
  const valid = ISO_DAY.test(date);
  useDocumentTitle(valid && param ? `${formatDateLong(date)} · Day` : "Today");
  if (!valid) return <Navigate to="/today" replace />;
  return <TodayView date={date} />;
}

/** "Saturday 7 November" — the API's label, computed locally while it loads. */
function dayLabel(iso: string): string {
  const d = parseDate(iso);
  return d ? format(d, "EEEE d MMMM") : iso;
}

function calendarHref(iso: string): string {
  const d = parseDate(iso);
  const monday = d ? format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd") : iso;
  return `/calendar?from=${monday}&day=${iso}`;
}

function TodayView({ date }: { date: string }) {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = useToday(date);
  const data = today.data;
  const stale = today.isPlaceholderData;
  const hasGroups = !!data && data.groups.length > 0;
  // /today omits group type and arrival source; /days/:date fills them in.
  const day = useDay(date, hasGroups);
  const rows = useMemo(() => sortDayRows(mergeDayRows(rowsFromToday(data?.groups ?? []), day.data)), [data?.groups, day.data]);
  const [addOpen, setAddOpen] = useState(false);
  const work = useWorkActions();
  const isToday = date === todayIso();

  useShortcut("t", () => navigate("/today"));
  useShortcut("arrowleft", () => navigate(`/today/${shiftDay(date, -1)}`));
  useShortcut("arrowright", () => navigate(`/today/${shiftDay(date, 1)}`));

  const tiles = data?.tiles;
  const arrivedPeople = data ? data.groups.reduce((sum, g) => sum + (g.arrived_count ?? 0), 0) : 0;
  const relative = isToday ? "Today" : relativeDayLabel(date);

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => navigate(`/today/${shiftDay(date, -1)}`)}>
              <ChevronLeft />
            </Button>
            <h1 className="text-title px-1 whitespace-nowrap">{data?.label ?? dayLabel(date)}</h1>
            <Button variant="outline" size="icon-sm" aria-label="Next day" onClick={() => navigate(`/today/${shiftDay(date, 1)}`)}>
              <ChevronRight />
            </Button>
          </div>
          {relative ? <span className={cn("text-body", isToday ? "font-medium text-primary" : "text-muted-foreground")}>{relative}</span> : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!isToday ? (
              <Button variant="outline" onClick={() => navigate("/today")}>
                Today
                <KeyboardHint keys={["T"]} />
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link to={calendarHref(date)}>
                <CalendarDays data-icon="inline-start" />
                Calendar
              </Link>
            </Button>
            {isAdmin ? (
              <Button onClick={() => setAddOpen(true)}>
                <Plus data-icon="inline-start" />
                Add booking
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-[1.375rem] flex-wrap items-center gap-1.5">{data ? <DayFlags data={data} /> : <Skeleton className="h-5 w-40" />}</div>
      </header>

      {today.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load this day</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{errorMessage(today.error)}</span>
            <Button variant="outline" size="sm" onClick={() => today.refetch()}>
              <RefreshCw data-icon="inline-start" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <BigNumberRow columns={isAdmin ? 4 : 3} className={cn("transition-opacity", stale && "opacity-70")}>
        {isAdmin ? (
          <>
            <BigNumber label={isToday ? "Groups today" : "Groups"} value={tiles ? formatNumber(tiles.groups.total) : ""} detail={tiles ? `${formatNumber(tiles.groups.arrived)} arrived` : undefined} loading={!tiles} />
            <BigNumber label="People" value={tiles ? formatNumber(tiles.people.total) : ""} detail={tiles ? `${formatNumber(tiles.people.confirmed)} confirmed` : undefined} loading={!tiles} />
            <BigNumber
              label="Owed at the gate"
              value={tiles ? formatMoney(tiles.owed_at_gate?.total ?? 0, { compact: true }) : ""}
              detail={tiles ? `${formatMoney(tiles.owed_at_gate?.paid ?? 0, { compact: true })} paid` : undefined}
              tone={tiles && (tiles.owed_at_gate?.total ?? 0) > 0 ? "amber" : "neutral"}
              loading={!tiles}
            />
            <BigNumber
              label="Needs you"
              value={tiles ? formatNumber(tiles.needs_you?.count ?? 0) : ""}
              detail={tiles ? (tiles.needs_you && tiles.needs_you.count > 0 && tiles.needs_you.oldest_days !== null ? `oldest ${formatNumber(tiles.needs_you.oldest_days)} d` : "nothing waiting") : undefined}
              to="/work"
              loading={!tiles}
            />
          </>
        ) : (
          <>
            <BigNumber label="Expected" value={tiles ? formatNumber(tiles.people.total) : ""} detail={tiles ? pluralise(tiles.groups.total, "group") : undefined} loading={!tiles} />
            <BigNumber
              label="Arrived"
              value={tiles ? formatNumber(arrivedPeople) : ""}
              detail={tiles ? `${formatNumber(tiles.groups.arrived)} of ${formatNumber(tiles.groups.total)} groups` : undefined}
              tone={arrivedPeople > 0 ? "green" : "neutral"}
              loading={!tiles}
            />
            <BigNumber
              label="Still to come"
              value={tiles ? formatNumber(Math.max(0, tiles.people.total - arrivedPeople)) : ""}
              detail={tiles ? pluralise(Math.max(0, tiles.groups.total - tiles.groups.arrived), "group") : undefined}
              loading={!tiles}
            />
          </>
        )}
      </BigNumberRow>

      <div className={cn("grid items-start gap-card-gap transition-opacity", isAdmin && "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]", stale && "opacity-70")}>
        <div className="min-w-0">
          {!data ? (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <DayTable rows={[]} loading showMoney={isAdmin} canOpenBooking={isAdmin} />
            </div>
          ) : hasGroups ? (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <DayTable rows={rows} showMoney={isAdmin} canOpenBooking={isAdmin} />
            </div>
          ) : (
            <QuietDay data={data} isToday={isToday} onAdd={isAdmin ? () => setAddOpen(true) : undefined} />
          )}
        </div>

        {isAdmin ? (
          <div className="flex min-w-0 flex-col gap-3">
            <section className="overflow-hidden rounded-xl bg-card ring-1 ring-border" aria-labelledby="up-next-title">
              <div className="px-card pt-2">
                <SectionHeader
                  id="up-next-title"
                  icon={ListChecks}
                  tone="accent"
                  title="Up next"
                  count={data?.work_counts?.total}
                  actions={
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/work">
                        All work
                        <ArrowRight data-icon="inline-end" />
                      </Link>
                    </Button>
                  }
                />
              </div>
              {!data ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-9" />
                  ))}
                </div>
              ) : (data.up_next ?? []).length === 0 ? (
                <EmptyState variant="inline" title="Nothing needs you right now." link={{ to: "/work", label: "Open Work" }} />
              ) : (
                <ul className="divide-y divide-border">
                  {(data.up_next ?? []).slice(0, 5).map((row) => (
                    <WorkRow key={row.id} row={row} variant="compact" onSelect={() => navigate("/work")} onAction={work.run} busy={work.busyRow === row.id} />
                  ))}
                </ul>
              )}
            </section>
            {data ? <SystemStatusLine system={data.system} /> : null}
          </div>
        ) : null}
      </div>

      {work.dialogs}
      {isAdmin ? (
        <BookingFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          defaultDate={date}
          onCreated={(booking) => {
            invalidateDayWorld(qc);
            navigate(`/bookings/${booking.id}`);
          }}
        />
      ) : null}
    </>
  );
}

function DayFlags({ data }: { data: TodayResponse }) {
  return (
    <>
      <StatusPill tone="neutral" dot={false} label={data.day_type === "weekend" ? "Weekend rate" : "Weekday rate"} />
      {data.is_closed ? (
        <StatusPill tone="red-muted" dot={false} label={data.day_label ? `Closed · ${data.day_label}` : "Closed"} />
      ) : data.day_label ? (
        <StatusPill tone="blue" dot={false} label={data.day_label} />
      ) : null}
      {data.is_peak ? <StatusPill tone="amber" dot={false} label="Peak day" /> : null}
    </>
  );
}

/** A closed or empty day: where the next groups are, and the week ahead. */
function QuietDay({ data, isToday, onAdd }: { data: TodayResponse; isToday: boolean; onAdd?: () => void }) {
  const next = data.next_visit_day;
  const when = isToday ? "today" : "on this day";
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-card ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-3">
        <CalendarDays aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-foreground">{data.is_closed ? `The park is closed ${when}.` : `No groups ${when}.`}</div>
          <div className="text-sm text-muted-foreground tabular">
            {next ? (
              <>
                Next visit day:{" "}
                <Link to={`/today/${next.date}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                  {formatDateShort(next.date)}
                </Link>{" "}
                · {pluralise(next.groups, "group")} · {pluralise(next.people, "person", "people")}
              </>
            ) : (
              "No upcoming groups booked yet."
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {next ? (
            <Button variant="outline" asChild>
              <Link to={`/today/${next.date}`}>
                Open day
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : null}
          {onAdd && !data.is_closed ? (
            <Button variant="outline" onClick={onAdd}>
              <Plus data-icon="inline-start" />
              Add booking
            </Button>
          ) : null}
        </div>
      </div>
      <SevenDayStrip days={data.seven_day_strip} />
    </div>
  );
}
