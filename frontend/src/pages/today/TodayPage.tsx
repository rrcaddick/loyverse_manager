/**
 * /today and /today/:date — the snapshot of one day, readable by a manager
 * (owner's pass of 6 Nov 2026). The header steps through days; a strip of
 * the terminals' live numbers runs the full width whatever the day is; below
 * it two columns that are always both there: the day's groups with their
 * numbers and actions on the left (a quiet card when there are none), the
 * cars in the queue, the re-entry passes and the next visit day on the
 * right. Nothing season-wide and no money beyond the gate balance in the
 * table: the season, the month and the money moved off this page.
 */

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CalendarDays, Car, ChevronLeft, ChevronRight, Plus, RefreshCw, Ticket } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

import { BigNumber, BigNumberRow } from "@/components/big-number";
import { KeyboardHint } from "@/components/keyboard-hint";
import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import { relativeDayLabel } from "@/features/bookings/lib";
import { useDay } from "@/features/calendar/api";
import { DayFlags } from "@/features/calendar/components/day-panel";
import { shiftDay } from "@/features/calendar/month";
import { invalidateDayWorld, mergeDayRows, rowsFromToday, sortDayRows, useToday } from "@/features/today/api";
import { DayTable } from "@/features/today/components/day-table";
import { SevenDayStrip } from "@/features/today/components/seven-day-strip";
import type { QueueCar, ReentryPass, TodayLive, TodayResponse } from "@/features/today/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShortcut } from "@/hooks/use-keyboard";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateLong, formatDateShort, formatNumber, parseDate, pluralise, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function TodayPage() {
  const { date: raw } = useParams<{ date?: string }>();
  const date = raw && ISO_DAY.test(raw) && parseDate(raw) ? raw : todayIso();
  useDocumentTitle(date === todayIso() ? "Today" : dayLabel(date));
  if (raw && raw !== date) return <Navigate to="/today" replace />;
  return <TodayView key={date} date={date} />;
}

function dayLabel(iso: string): string {
  return formatDateLong(iso);
}

function calendarHref(iso: string): string {
  const d = parseDate(iso);
  const month = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01` : iso;
  return `/calendar?from=${month}#${iso}`;
}

function clock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
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
  const live = data?.live;
  const relative = isToday ? "Today" : relativeDayLabel(date);

  return (
    <>
      <header className="flex shrink-0 flex-col gap-2">
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

      <LiveStrip live={live} groups={tiles?.groups} stale={stale} />

      <div className={cn("grid min-h-0 flex-1 items-start gap-card-gap transition-opacity lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch", stale && "opacity-70")}>
        <div className="relative flex min-w-0 flex-col gap-card-gap lg:min-h-0 lg:overflow-y-auto lg:scrollbar-thin">
          {!data ? (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <DayTable rows={[]} loading showMoney={isAdmin} canOpenBooking={isAdmin} date={date} />
            </div>
          ) : hasGroups ? (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <DayTable rows={rows} showMoney={isAdmin} canOpenBooking={isAdmin} date={date} />
            </div>
          ) : (
            <QuietDay data={data} isToday={isToday} onAdd={isAdmin ? () => setAddOpen(true) : undefined} />
          )}
          {data ? <SevenDayStrip days={data.seven_day_strip} /> : null}
        </div>

        <div className="relative flex min-w-0 flex-col gap-card-gap lg:min-h-0 lg:overflow-y-auto lg:pb-1 lg:scrollbar-thin">
          <QueueCard queue={live?.queue} available={live?.available ?? true} loading={!data} />
          <PassesCard passes={live?.passes} loading={!data} />
          <NextDayCard data={data} isToday={isToday} />
        </div>
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

// ---------------------------------------------------------------- the strip

function LiveStrip({ live, groups, stale }: { live: TodayLive | undefined; groups: { total: number; arrived: number } | undefined; stale: boolean }) {
  const off = live ? !live.available : false;
  const dash = off ? "—" : undefined;
  return (
    <BigNumberRow columns={6} className={cn("shrink-0 transition-opacity", stale && "opacity-70")}>
      <BigNumber label="Public in" value={dash ?? (live ? formatNumber(live.public_heads) : "")} detail={off ? "Terminals not reachable" : "people through the gate"} loading={!live} />
      <BigNumber
        label="Online tickets"
        value={dash ?? (live ? formatNumber(live.online.admitted) : "")}
        detail={off ? undefined : live?.online.sold !== null && live?.online.sold !== undefined ? `of ${formatNumber(live.online.sold)} sold` : "admitted · sold not known"}
        loading={!live}
      />
      <BigNumber
        label="Groups"
        value={live ? formatNumber(live.groups.arrived) : ""}
        detail={live ? `of ${formatNumber(live.groups.booked)} booked${groups ? ` · ${formatNumber(groups.arrived)} of ${formatNumber(groups.total)} groups` : ""}` : undefined}
        tone={live && live.groups.booked > 0 && live.groups.arrived >= live.groups.booked ? "green" : "neutral"}
        loading={!live}
      />
      <BigNumber label="Cars in queue" value={dash ?? (live ? formatNumber(live.queue.length) : "")} detail={off ? undefined : live ? `${formatNumber(live.queue.reduce((n, c) => n + c.heads, 0))} people waiting` : undefined} tone={live && live.queue.length > 5 ? "amber" : "neutral"} loading={!live} />
      <BigNumber label="Re-entry passes" value={live ? formatNumber(live.passes.open) : ""} detail={live ? `open · ${formatNumber(live.passes.used)} used` : undefined} loading={!live} />
      <BigNumber label="Gazebos on site" value={dash ?? (live ? formatNumber(live.gazebos_on_site) : "")} detail={off ? undefined : "sold at the gate today"} loading={!live} />
    </BigNumberRow>
  );
}

// ------------------------------------------------------------- right column

const KIND_LABEL: Record<QueueCar["kind"], string> = { public: "Public", online: "Online", group: "Group" };

function QueueCard({ queue, available, loading }: { queue: QueueCar[] | undefined; available: boolean; loading: boolean }) {
  const cars = queue ?? [];
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Car aria-hidden="true" className="size-4 text-muted-foreground" />
          Cars in the queue
          {cars.length ? <span className="text-sm font-normal tabular text-muted-foreground">({cars.length})</span> : null}
        </span>
      }
    >
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      ) : !available ? (
        <p className="text-body text-muted-foreground">The terminals' numbers are not reachable.</p>
      ) : cars.length === 0 ? (
        <p className="text-body text-muted-foreground">No cars waiting.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {cars.map((c) => (
            <li key={c.ticket_id} className="flex items-center gap-3 py-1.5 text-body first:pt-0 last:pb-0">
              <span className="w-24 shrink-0 font-mono text-sm">{c.plate ?? "—"}</span>
              <span className="tabular">{pluralise(c.heads, "person", "people")}</span>
              <StatusPill tone={c.kind === "group" ? "blue" : c.kind === "online" ? "green-muted" : "neutral"} label={KIND_LABEL[c.kind]} size="sm" dot={false} />
              <span className="ml-auto text-sm text-muted-foreground tabular">{clock(c.opened_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function PassesCard({ passes, loading }: { passes: TodayLive["passes"] | undefined; loading: boolean }) {
  const open = (passes?.list ?? []).filter((p: ReentryPass) => p.status === "open");
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Ticket aria-hidden="true" className="size-4 text-muted-foreground" />
          Re-entry passes
        </span>
      }
      description={passes ? `${pluralise(passes.open, "pass", "passes")} open · ${formatNumber(passes.used)} used${passes.voided ? ` · ${formatNumber(passes.voided)} voided` : ""}${passes.expired ? ` · ${formatNumber(passes.expired)} expired` : ""}` : undefined}
    >
      {loading ? (
        <Skeleton className="h-6" />
      ) : open.length === 0 ? (
        <p className="text-body text-muted-foreground">No passes out at the moment.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {open.map((p, i) => (
            <li key={`${p.plate ?? ""}-${p.issued_at ?? i}`} className="flex items-center gap-3 py-1.5 text-body first:pt-0 last:pb-0">
              <span className="w-24 shrink-0 font-mono text-sm">{p.plate ?? "—"}</span>
              <span className="tabular">{pluralise(p.heads, "person", "people")}</span>
              <span className="ml-auto text-sm text-muted-foreground tabular">out since {clock(p.issued_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function NextDayCard({ data, isToday }: { data: TodayResponse | undefined; isToday: boolean }) {
  const next = data?.next_visit_day ?? null;
  return (
    <Section title={isToday ? "Next visit day" : "Next visit day after this"}>
      {!data ? (
        <Skeleton className="h-6" />
      ) : next ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-body">
          <span>
            <Link to={`/today/${next.date}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              {formatDateShort(next.date)}
            </Link>
            <span className="text-muted-foreground tabular">
              {" "}
              · {pluralise(next.groups, "group")} · {pluralise(next.people, "person", "people")}
            </span>
          </span>
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/today/${next.date}`}>
              Open day
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      ) : (
        <p className="text-body text-muted-foreground">No upcoming groups booked yet.</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- quiet day

function QuietDay({ data, isToday, onAdd }: { data: TodayResponse; isToday: boolean; onAdd?: () => void }) {
  const when = isToday ? "today" : "on this day";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-card ring-1 ring-border">
      <CalendarDays aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium text-foreground">{data.is_closed ? `The park is closed ${when}.` : `No groups ${when}.`}</div>
        <div className="text-sm text-muted-foreground">The public day carries on above; the next group day is on the right.</div>
      </div>
      {onAdd ? (
        <Button variant="outline" onClick={onAdd}>
          <Plus data-icon="inline-start" />
          Add booking
        </Button>
      ) : null}
    </div>
  );
}
