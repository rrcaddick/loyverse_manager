/**
 * The side panel: 400 px (440 at 1920), non-modal, no scrim; the grid stays
 * live beside it and clicking another day swaps the content. Esc closes
 * (registered by the page).
 *
 * Content: the date, the relative day and the day's flags; the cell's
 * numbers at full size (interest 32 px, groups, an 8 px bar, confirmed /
 * pending); one 56 px row per group sorted by arrival time then size, with
 * the admin-only balance in red when due (GET /days/:date); a footer with
 * Open day view and Add booking (admin).
 *
 * `DayFlags` is also used by the day view (pages/calendar/DayPage.tsx).
 */

import { ArrowRight, CalendarPlus, ChevronRight, Plus, X } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";

import { CapacityBar } from "@/components/capacity-bar";
import { EmptyState } from "@/components/empty-state";
import { BOOKING_STATUS_META, StatusDot, StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroupTypeLabel } from "@/features/bookings/lib";
import type { CalendarDay, CalendarDayBooking, DayViewBooking } from "@/features/bookings/types";
import { useAuth } from "@/lib/auth";
import { formatDateLong, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useDay } from "../api";
import { relativeDayLabel } from "../month";
import { SplitCaption } from "./split-caption";

type DayFlagsInput = Pick<CalendarDay, "day_type" | "is_closed" | "is_avoid" | "is_peak" | "in_no_discount_window" | "label" | "capacity_warning">;

export function DayFlags({ day, className }: { day: DayFlagsInput; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <StatusPill tone="neutral" dot={false} label={day.day_type === "weekend" ? "Weekend rate" : "Weekday rate"} />
      {day.is_closed ? <StatusPill tone="neutral" label={day.label ? `Closed · ${day.label}` : "Closed"} /> : day.label ? <StatusPill tone="blue" label={day.label} /> : null}
      {day.is_peak ? <StatusPill tone="amber" label="Peak day" /> : null}
      {day.is_avoid ? <StatusPill tone="neutral" label="Avoid" /> : null}
      {day.in_no_discount_window && !day.is_peak ? <StatusPill tone="amber" label="No group discounts" /> : null}
      {day.capacity_warning ? <StatusPill tone="red" label="Over capacity" /> : null}
    </div>
  );
}

interface DayPanelProps {
  date: string;
  day: CalendarDay | undefined;
  today: string;
  onClose: () => void;
  onAddBooking: (date: string) => void;
}

/** Arrival time first (unknown last), then the biggest group. */
function sortBookings(items: CalendarDayBooking[]): CalendarDayBooking[] {
  return [...items].sort((a, b) => {
    if (a.arrival_time && b.arrival_time && a.arrival_time !== b.arrival_time) return a.arrival_time < b.arrival_time ? -1 : 1;
    if (!!a.arrival_time !== !!b.arrival_time) return a.arrival_time ? -1 : 1;
    return b.people_booked - a.people_booked || a.group_name.localeCompare(b.group_name);
  });
}

export function DayPanel({ date, day, today, onClose, onAddBooking }: DayPanelProps) {
  const { isAdmin } = useAuth();
  const detail = useDay(date, isAdmin);
  const groupType = useGroupTypeLabel();
  const rich = useMemo(() => new Map<number, DayViewBooking>((detail.data?.date === date ? detail.data.bookings : []).map((b) => [b.id, b])), [detail.data, date]);
  const bookings = useMemo(() => sortBookings(day?.bookings ?? []), [day]);
  const total = day?.total_people ?? 0;

  return (
    <aside aria-label={`${formatDateLong(date)} details`} className="flex w-(--fy-panel) shrink-0 flex-col border-l border-border bg-card">
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 pt-3 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-section truncate">{formatDateLong(date)}</h2>
          <p className="text-sm text-muted-foreground">{relativeDayLabel(date, today)}</p>
          {day ? <DayFlags day={day} className="pt-2" /> : null}
        </div>
        <Button variant="ghost" size="icon" aria-label="Close the day panel" onClick={onClose} className="-mt-1 -mr-2">
          <X />
        </Button>
      </div>

      {day ? (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-baseline gap-2 tabular">
            <span className="text-[2rem] leading-none font-bold tracking-tight">{formatNumber(total)}</span>
            <span className="text-sm text-muted-foreground">people</span>
            <span className="ml-auto text-sm font-medium">
              {day.booking_count} {day.booking_count === 1 ? "group" : "groups"}
            </span>
          </div>
          {total > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <CapacityBar confirmed={day.confirmed_people} pending={day.tentative_people} caption="none" height={8} label={`${formatNumber(day.confirmed_people)} confirmed of ${formatNumber(total)}`} />
              <SplitCaption confirmed={day.confirmed_people} pending={day.tentative_people} mode="full-swatches" className="text-sm text-muted-foreground" />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {bookings.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={CalendarPlus}
            title={day?.is_closed ? "Closed on this day" : "No bookings on this day"}
            hint={day?.is_closed ? "The park is closed; nothing can be booked." : "Groups appear here as soon as they are entered or request a visit."}
          />
        ) : (
          <ul className="divide-y divide-border">
            {bookings.map((b) => {
              const more = rich.get(b.id);
              const meta = BOOKING_STATUS_META[b.status];
              const details = [b.arrival_time ? `arrives ${b.arrival_time}` : null, b.group_type ? groupType(b.group_type) : null, b.reference].filter(Boolean).join(" · ");
              const body = (
                <>
                  <StatusDot tone={meta.tone} label={meta.label} className="mt-[0.3rem] shrink-0 self-start" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm leading-5 font-semibold text-foreground">{b.group_name}</div>
                    <div className="truncate text-xs leading-4 text-muted-foreground">{details}</div>
                  </div>
                  <div className="shrink-0 text-right tabular">
                    <div className="text-base leading-5 font-semibold text-foreground">{formatNumber(b.people_booked)}</div>
                    {isAdmin ? (
                      more ? (
                        more.finance.balance_due > 0 ? (
                          <div className="text-xs leading-4 font-medium text-red-text">{formatMoney(more.finance.balance_due, { compact: true })} due</div>
                        ) : (
                          <div className="text-xs leading-4 text-muted-foreground">paid</div>
                        )
                      ) : detail.isPending ? (
                        <Skeleton className="mt-1 ml-auto h-3 w-14" />
                      ) : null
                    ) : null}
                  </div>
                  {isAdmin ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
                </>
              );
              return (
                <li key={b.id}>
                  {isAdmin ? (
                    <Link
                      to={`/bookings/${b.id}`}
                      aria-label={`Open booking ${b.reference}, ${b.group_name}`}
                      className="flex min-h-row-queue items-center gap-3 px-4 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-row-queue items-center gap-3 px-4 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
        <Button asChild variant="outline" size="lg">
          <Link to={`/today/${date}`}>
            Open day view
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
        {isAdmin ? (
          <Button size="lg" onClick={() => onAddBooking(date)}>
            <Plus data-icon="inline-start" />
            Add booking
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
