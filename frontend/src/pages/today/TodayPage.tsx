/**
 * /today and /today/:date — the dashboard and the day view in one screen
 * (UI round two, agreed 26 Oct 2026). Above the fold at 1440×900:
 *
 *   ‹ Saturday 7 November ›  · Today · the day's kind      Calendar · Add booking
 *   [Groups today] [People today] [Owed at the gate] [This month]   (manager: Expected · Arrived · Still to come)
 *   the day's groups with live arrivals (two thirds)  |  Needs attention · The season · Next visit days (admin)
 *
 * A closed or empty day shows the next visit day and a seven-day strip
 * instead of the table. Keys: T today, ← → previous / next day.
 */

import { useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek } from "date-fns";
import { AlertCircle, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Inbox, ListChecks, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

import { BigNumber, BigNumberRow } from "@/components/big-number";
import { CountBadge } from "@/components/count-badge";
import { EmptyState } from "@/components/empty-state";
import { KeyboardHint } from "@/components/keyboard-hint";
import { SectionHeader } from "@/components/section-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import { relativeDayLabel } from "@/features/bookings/lib";
import { useDay } from "@/features/calendar/api";
import { DayFlags } from "@/features/calendar/components/day-panel";
import { KindPill } from "@/features/calendar/components/kind-pill";
import { shiftDay } from "@/features/calendar/month";
import { invalidateDayWorld, mergeDayRows, rowsFromToday, sortDayRows, useToday } from "@/features/today/api";
import { DayTable } from "@/features/today/components/day-table";
import { SevenDayStrip } from "@/features/today/components/seven-day-strip";
import type { MoneyBlock, NextVisitDay, SeasonBlock, TodayResponse } from "@/features/today/types";
import type { WorkCounts } from "@/features/work/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShortcut } from "@/hooks/use-keyboard";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateLong, formatDateShort, formatMoney, formatNumber, parseDate, pluralise, todayIso } from "@/lib/format";
import { WORK_CHILDREN } from "@/lib/nav";
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
  const isToday = date === todayIso();

  useShortcut("t", () => navigate("/today"));
  useShortcut("arrowleft", () => navigate(`/today/${shiftDay(date, -1)}`));
  useShortcut("arrowright", () => navigate(`/today/${shiftDay(date, 1)}`));

  const tiles = data?.tiles;
  const arrivedPeople = data ? data.groups.reduce((sum, g) => sum + (g.arrived_count ?? 0), 0) : 0;
  const relative = isToday ? "Today" : relativeDayLabel(date);
  const month = data?.month;

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
          {data ? <DayFlags day={{ kind: data.kind, label: data.day_label, over: false }} /> : <Skeleton className="h-5 w-28" />}
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
            <BigNumber label={isToday ? "People today" : "People"} value={tiles ? formatNumber(tiles.people.total) : ""} detail={tiles ? `${formatNumber(tiles.people.confirmed)} confirmed` : undefined} loading={!tiles} />
            <BigNumber
              label="Owed at the gate"
              value={tiles ? formatMoney(tiles.owed_at_gate?.total ?? 0, { compact: true }) : ""}
              detail={tiles ? `${formatMoney(tiles.owed_at_gate?.paid ?? 0, { compact: true })} paid` : undefined}
              tone={tiles && (tiles.owed_at_gate?.total ?? 0) > 0 ? "amber" : "neutral"}
              loading={!tiles}
            />
            <BigNumber
              label={month ? `${month.label}` : "This month"}
              value={month ? formatNumber(month.confirmed_people + month.pending_people) : ""}
              detail={month ? `${formatNumber(month.confirmed_people)} confirmed · ${formatNumber(month.pending_people)} pending · ${pluralise(month.groups, "group")}` : undefined}
              to={`/calendar?from=${month?.from ?? date}`}
              loading={!month}
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
          <div className="flex min-w-0 flex-col gap-card-gap">
            <AttentionCard counts={data?.work_counts} skipped={data?.tiles.skipped_mail} loading={!data} />
            <SeasonCard season={data?.season} money={data?.money} loading={!data} />
            <NextDaysCard days={data?.next_visit_days} loading={!data} />
          </div>
        ) : null}
      </div>

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

/** The Work views with something in them, each a link into Work. */
function AttentionCard({ counts, skipped, loading }: { counts: WorkCounts | undefined; skipped: { count: number; days: number } | undefined; loading: boolean }) {
  const items = counts ? WORK_CHILDREN.filter((c) => !c.muted && ((counts as unknown as Record<string, number>)[c.view] ?? 0) > 0) : [];
  const total = counts?.total ?? 0;
  return (
    <section className="overflow-hidden rounded-xl bg-card ring-1 ring-border" aria-labelledby="attention-title">
      <div className="px-card pt-2">
        <SectionHeader
          id="attention-title"
          icon={ListChecks}
          tone="accent"
          title="Needs attention"
          count={total}
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/work">
                Work
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          }
        />
      </div>
      {loading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState variant="inline" title="Nothing needs you right now." />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const Icon = item.icon;
            const n = (counts as unknown as Record<string, number>)[item.view] ?? 0;
            return (
              <li key={item.view}>
                <Link to={`/work?view=${item.view}`} className="flex h-11 items-center gap-3 px-card text-body outline-none hover:bg-nested focus-visible:bg-nested">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <CountBadge count={n} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {skipped && skipped.count > 0 ? (
        <Link to="/settings/system" className="flex h-10 items-center gap-2 border-t border-border px-card text-sm text-muted-foreground outline-none hover:bg-nested focus-visible:bg-nested">
          <Inbox aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {pluralise(skipped.count, "automated mail")} set aside in the last {pluralise(skipped.days, "day")}
          </span>
          <span className="font-medium text-foreground">Review</span>
        </Link>
      ) : null}
    </section>
  );
}

function Fact({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "amber" | "neutral" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label text-muted-foreground uppercase">{label}</span>
      <span className={cn("text-xl leading-6 font-semibold tabular", tone === "amber" ? "text-amber-text" : "text-foreground")}>{value}</span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
    </div>
  );
}

/** The season's numbers and the money still to come in. */
function SeasonCard({ season, money, loading }: { season: SeasonBlock | undefined; money: MoneyBlock | undefined; loading: boolean }) {
  return (
    <section className="rounded-xl bg-card p-card ring-1 ring-border" aria-labelledby="season-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="season-title" className="text-section">
          The season
        </h2>
        {season ? (
          <span className="text-xs text-muted-foreground tabular">
            {formatDateShort(season.from)} – {formatDateShort(season.to)}
          </span>
        ) : null}
      </div>
      {loading || !season || !money ? (
        <div className="mt-3 grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
          <Fact label="Bookings" value={formatNumber(season.bookings)} detail={`${pluralise(season.visit_days_ahead, "visit day")} ahead · ${formatNumber(season.completed)} done`} />
          <Fact label="People" value={formatNumber(season.confirmed_people + season.pending_people)} detail={`${formatNumber(season.confirmed_people)} confirmed · ${formatNumber(season.pending_people)} pending`} />
          <Fact label="Deposits to come" value={formatMoney(money.deposits, { compact: true })} detail={pluralise(money.deposits_count, "booking")} tone={money.deposits > 0 ? "amber" : "neutral"} />
          <Fact label="Balances to come" value={formatMoney(money.balances, { compact: true })} detail={pluralise(money.balances_count, "confirmed visit")} />
        </div>
      )}
    </section>
  );
}

/** The next days with groups, each a link to that day. */
function NextDaysCard({ days, loading }: { days: NextVisitDay[] | undefined; loading: boolean }) {
  return (
    <section className="overflow-hidden rounded-xl bg-card ring-1 ring-border" aria-labelledby="next-days-title">
      <div className="flex items-center justify-between px-card pt-3 pb-2">
        <h2 id="next-days-title" className="text-section">
          Next visit days
        </h2>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/calendar">
            Calendar
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
      {loading || !days ? (
        <div className="space-y-3 px-4 pb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : days.length === 0 ? (
        <EmptyState variant="inline" title="No visits booked ahead." />
      ) : (
        <ul className="divide-y divide-border">
          {days.map((d) => (
            <li key={d.date}>
              <Link to={`/today/${d.date}`} className="flex h-12 items-center gap-3 px-card outline-none hover:bg-nested focus-visible:bg-nested">
                <div className="w-24 shrink-0">
                  <div className="text-body leading-5 font-medium text-foreground">{formatDate(d.date)}</div>
                  <div className="text-xs leading-4 text-muted-foreground">{relativeDayLabel(d.date) ?? ""}</div>
                </div>
                <div className="min-w-0 flex-1">{d.kind ? <KindPill kind={d.kind} /> : null}</div>
                <div className="shrink-0 text-right tabular">
                  <div className="text-body leading-5 font-semibold text-foreground">{formatNumber(d.people)}</div>
                  <div className="text-xs leading-4 text-muted-foreground">
                    {pluralise(d.groups, "group")}
                    {d.confirmed_people !== undefined ? ` · ${formatNumber(d.confirmed_people)} confirmed` : ""}
                  </div>
                </div>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
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
          <div className="text-body font-medium text-foreground">{data.is_closed ? `The park is closed to the public ${when}.` : `No groups ${when}.`}</div>
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
          {onAdd ? (
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
