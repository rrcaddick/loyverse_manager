/**
 * The day panel: a Sheet listing a day's bookings. Right-hand on desktop,
 * full-screen on phones. The grid's day data renders immediately; the richer
 * day view (phones, balances) streams in from GET /days/:date.
 */

import { ArrowRight, CalendarPlus, ChevronRight, Phone, Plus } from "lucide-react";
import { Link } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroupTypeLabel } from "@/features/bookings/lib";
import type { CalendarDay, DayViewBooking } from "@/features/bookings/types";
import { useAuth } from "@/lib/auth";
import { formatDateLong, formatMoney, formatNumber, formatPhone, formatRelativeDay, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useDay } from "../api";

interface DayPanelProps {
  date: string | null;
  day: CalendarDay | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddBooking: (date: string) => void;
}

export function DayFlags({ day, className }: { day: Pick<CalendarDay, "day_type" | "is_closed" | "is_avoid" | "is_peak" | "in_no_discount_window" | "label" | "capacity_warning">; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <StatusBadge status={day.day_type} label={day.day_type === "weekend" ? "Weekend rate" : "Weekday rate"} tone="neutral" dot={false} />
      {day.is_closed ? <StatusBadge status="closed" label={day.label ? `Closed · ${day.label}` : "Closed"} tone="red-muted" dot={false} /> : day.label ? <StatusBadge status="label" label={day.label} tone="blue" dot={false} /> : null}
      {day.is_peak ? <StatusBadge status="peak" label="Peak day" tone="amber" dot={false} /> : null}
      {day.is_avoid ? <StatusBadge status="avoid" label="Avoid" tone="neutral" dot={false} /> : null}
      {day.in_no_discount_window && !day.is_peak ? <StatusBadge status="window" label="No group discounts" tone="amber" dot={false} /> : null}
      {day.capacity_warning ? <StatusBadge status="capacity" label="Over capacity warning" tone="red" /> : null}
    </div>
  );
}

export function DayPanel({ date, day, open, onOpenChange, onAddBooking }: DayPanelProps) {
  const { isAdmin } = useAuth();
  const detail = useDay(date ?? "", open && !!date);
  const groupType = useGroupTypeLabel();
  const rich = new Map<number, DayViewBooking>((detail.data?.bookings ?? []).map((b) => [b.id, b]));
  const bookings = day?.bookings ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md" aria-describedby={undefined}>
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-lg">{date ? formatDateLong(date) : ""}</SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            {date ? formatRelativeDay(date) : ""}
            {day ? <span aria-hidden="true">·</span> : null}
            {day ? pluralise(day.booking_count, "booking") : null}
          </SheetDescription>
          {day ? <DayFlags day={day} className="pt-2" /> : null}
        </SheetHeader>

        {day ? (
          <dl className="grid grid-cols-3 divide-x divide-border border-b border-border bg-muted/30 text-center">
            <Stat label="People" value={formatNumber(day.total_people)} />
            <Stat label="Confirmed" value={formatNumber(day.confirmed_people)} accent />
            <Stat label="Tentative" value={formatNumber(day.tentative_people)} />
          </dl>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {bookings.length === 0 ? (
            <EmptyState
              compact
              icon={CalendarPlus}
              title="No bookings on this day"
              description={day?.is_closed ? "The park is closed on this day." : "Nothing has been booked yet."}
              action={
                isAdmin && date ? (
                  <Button variant="outline" onClick={() => onAddBooking(date)}>
                    <Plus data-icon="inline-start" />
                    Add booking
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {bookings.map((b) => {
                const more = rich.get(b.id);
                const body = (
                  <>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        {isAdmin ? (
                          <Link
                            to={`/bookings/${b.id}`}
                            className="truncate font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
                            aria-label={`Open booking ${b.reference}, ${b.group_name}`}
                          >
                            {b.group_name}
                          </Link>
                        ) : (
                          <span className="truncate font-medium text-foreground">{b.group_name}</span>
                        )}
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{b.reference}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <StatusBadge status={b.status} />
                        <span className="tabular">{pluralise(b.people_booked, "person", "people")}</span>
                        {b.group_type ? <span>{groupType(b.group_type)}</span> : null}
                        {b.arrival_time ? <span>arrives {b.arrival_time}</span> : null}
                        {b.vehicles ? <span>{pluralise(b.vehicles, "vehicle")}</span> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {b.contact_name ? <span>{b.contact_name}</span> : null}
                        {more?.contact_mobile ? (
                          <a
                            href={`tel:+${more.contact_mobile}`}
                            className="relative z-10 inline-flex items-center gap-1 rounded-sm text-foreground underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            <Phone aria-hidden="true" className="size-3" />
                            {formatPhone(more.contact_mobile)}
                          </a>
                        ) : detail.isPending ? (
                          <Skeleton className="h-3 w-20" />
                        ) : null}
                        {isAdmin && more ? (
                          <span className={cn("tabular", more.finance.balance_due > 0 ? "text-foreground" : "text-success")}>
                            {more.finance.balance_due > 0 ? `${formatMoney(more.finance.balance_due, { compact: true })} due` : "Paid in full"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {isAdmin ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 self-center text-muted-foreground" /> : null}
                  </>
                );
                return (
                  <li key={b.id} className={cn("relative flex gap-3 px-4 py-3 transition-colors", isAdmin && "hover:bg-muted/50 has-[a:focus-visible]:bg-muted/60")}>
                    {body}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t border-border bg-muted/30">
          {date ? (
            <Button asChild variant="outline">
              <Link to={`/day/${date}`}>
                Open day view
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : null}
          {isAdmin && date ? (
            <Button onClick={() => onAddBooking(date)}>
              <Plus data-icon="inline-start" />
              Add booking
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("text-lg font-semibold tabular", accent ? "text-primary" : "text-foreground")}>{value}</dd>
    </div>
  );
}
