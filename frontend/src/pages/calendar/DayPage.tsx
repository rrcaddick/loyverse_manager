/**
 * /today and /today/:date — the gate's operational screen for one day: who is coming,
 * who has arrived, what is still owed. Manager-allowed; built for a tablet.
 */

import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import { useDay } from "@/features/calendar/api";
import { DayBookingCard } from "@/features/calendar/components/day-booking-card";
import { DayFlags } from "@/features/calendar/components/day-panel";
import { monthKey, shiftDay } from "@/features/calendar/month";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatDateLong, formatMoney, formatNumber, formatRelativeDay, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function DayPage() {
  // /today shows today; /today/:date any day. (Routing v2: /day/:date redirects here.)
  const { date: param } = useParams<{ date: string }>();
  const date = param ?? todayIso();
  const valid = ISO_DAY.test(date);
  useDocumentTitle(valid ? (param ? `${formatDateLong(date)} · Day` : "Today") : "Today");
  if (!valid) return <Navigate to="/today" replace />;
  return <DayView key={date} date={date} />;
}

function DayView({ date }: { date: string }) {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const day = useDay(date);
  const [addOpen, setAddOpen] = useState(false);
  const today = todayIso();
  const relative = formatRelativeDay(date);
  const data = day.data;
  const stale = day.isPlaceholderData;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            Day view
            {relative !== formatDateLong(date) && !/\d{4}/.test(relative) ? (
              <span className={cn("normal-case tracking-normal", date === today ? "text-primary" : "text-muted-foreground")}>· {relative}</span>
            ) : null}
          </span>
        }
        title={
          <span className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => navigate(`/today/${shiftDay(date, -1)}`)}>
              <ChevronLeft />
            </Button>
            <span>{formatDateLong(date)}</span>
            <Button variant="outline" size="icon-sm" aria-label="Next day" onClick={() => navigate(`/today/${shiftDay(date, 1)}`)}>
              <ChevronRight />
            </Button>
          </span>
        }
        description={
          data ? (
            <DayFlags day={{ ...data, in_no_discount_window: false }} className="pt-1" />
          ) : day.isPending ? (
            <Skeleton className="mt-1 h-5 w-56" />
          ) : null
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/calendar?month=${monthKey(date)}&day=${date}`}>
                <CalendarDays data-icon="inline-start" />
                Calendar
              </Link>
            </Button>
            {date !== today ? (
              <Button variant="outline" onClick={() => navigate("/today")}>
                Today
              </Button>
            ) : null}
            {isAdmin ? (
              <Button onClick={() => setAddOpen(true)}>
                <Plus data-icon="inline-start" />
                Add booking
              </Button>
            ) : null}
          </>
        }
      />

      {day.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load this day</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{errorMessage(day.error)}</span>
            <Button variant="outline" size="sm" onClick={() => day.refetch()}>
              <RefreshCw data-icon="inline-start" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className={cn("grid grid-cols-2 gap-3 transition-opacity", isAdmin ? "lg:grid-cols-4" : "lg:grid-cols-3", stale && "opacity-70")}>
        {data ? (
          <>
            <Tile label="Groups" value={formatNumber(data.totals.bookings)} detail={data.totals.bookings === 1 ? "booking today" : "bookings today"} />
            <Tile
              label="People booked"
              value={formatNumber(data.totals.total_people)}
              detail={`${formatNumber(data.totals.confirmed_people)} confirmed · ${formatNumber(data.totals.tentative_people)} tentative`}
            />
            <Tile
              label="Arrived so far"
              value={formatNumber(data.totals.arrived_total)}
              detail={data.totals.confirmed_people > 0 ? `of ${formatNumber(data.totals.confirmed_people)} confirmed` : "nothing recorded"}
              tone={data.totals.arrived_total > 0 ? "accent" : "default"}
            />
            {isAdmin ? (
              <Tile
                label="Outstanding balance"
                value={formatMoney(data.totals.balance_due_total, { compact: true })}
                detail={`${formatMoney(data.totals.paid_total, { compact: true })} paid`}
                tone={data.totals.balance_due_total > 0 ? "warn" : "ok"}
              />
            ) : null}
          </>
        ) : (
          Array.from({ length: isAdmin ? 4 : 3 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-7 w-16" />
              <Skeleton className="mt-2 h-3 w-28" />
            </div>
          ))
        )}
      </dl>

      <Section
        title="Bookings"
        description={data ? `${formatNumber(data.totals.bookings)} ${data.totals.bookings === 1 ? "group" : "groups"} expected. Fetch arrivals from Loyverse or enter a count by hand; gate payments are recorded against the booking.` : undefined}
        flush
        className={cn("transition-opacity", stale && "opacity-70")}
      >
        {day.isPending ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="grid gap-4 px-5 py-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-56" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-8 w-36" />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-16" />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : data && data.bookings.length > 0 ? (
          <ul className="divide-y divide-border">
            {data.bookings.map((b) => (
              <DayBookingCard key={b.id} booking={b} date={date} />
            ))}
          </ul>
        ) : data ? (
          <EmptyState
            compact
            icon={CalendarDays}
            title="No groups booked"
            description={data.is_closed ? "The park is closed on this day." : "No group bookings are expected on this day."}
            action={
              isAdmin ? (
                <Button variant="outline" onClick={() => setAddOpen(true)}>
                  <Plus data-icon="inline-start" />
                  Add booking
                </Button>
              ) : undefined
            }
          />
        ) : null}
      </Section>

      {isAdmin ? <BookingFormDialog open={addOpen} onOpenChange={setAddOpen} defaultDate={date} /> : null}
    </>
  );
}

function Tile({ label, value, detail, tone = "default" }: { label: string; value: string; detail?: string; tone?: "default" | "accent" | "warn" | "ok" }) {
  return (
    <div className="min-w-0 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd
        className={cn(
          "mt-1 truncate text-2xl font-semibold tabular",
          tone === "accent" && "text-primary",
          tone === "warn" && "text-status-amber-fg",
          tone === "ok" && "text-success",
        )}
      >
        {value}
      </dd>
      {detail ? <dd className="mt-0.5 text-xs leading-4 text-muted-foreground">{detail}</dd> : null}
    </div>
  );
}
