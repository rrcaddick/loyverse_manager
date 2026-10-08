/**
 * The one-line booking summary used by every queue row, suggestion and
 * picker result: reference (link) · group · status, then date · people ·
 * contact. `Facts` renders the section-specific label/value pairs beneath it.
 */

import { CalendarDays, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { StatusBadge } from "@/components/status-badge";
import { formatRelativeDay, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { visitDateLabel, type BookingSummary } from "./bookings";

interface BookingLineProps {
  booking: BookingSummary;
  /** Render the reference as plain text (inside another link or button). */
  plain?: boolean;
  className?: string;
}

export function BookingLine({ booking, plain, className }: BookingLineProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {plain ? (
          <span className="font-medium tabular text-foreground">{booking.reference}</span>
        ) : (
          <Link
            to={`/bookings/${booking.id}`}
            className="rounded-sm font-medium tabular text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {booking.reference}
          </Link>
        )}
        <span className="min-w-0 truncate font-medium text-foreground">{booking.group_name}</span>
        <StatusBadge status={booking.status} />
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 tabular" title={formatRelativeDay(booking.visit_date)}>
          <CalendarDays aria-hidden="true" className="size-3.5" />
          {visitDateLabel(booking.visit_date)}
        </span>
        <span className="inline-flex items-center gap-1.5 tabular">
          <Users aria-hidden="true" className="size-3.5" />
          {pluralise(booking.people_booked, "person", "people")}
        </span>
        {booking.contact_name ? <span className="min-w-0 truncate">{booking.contact_name}</span> : null}
      </div>
    </div>
  );
}

export type FactTone = "default" | "muted" | "warning" | "danger" | "success";

export interface Fact {
  label: string;
  value: ReactNode;
  tone?: FactTone;
  /** Tooltip / full form of an abbreviated value. */
  title?: string;
}

const TONE_CLASS: Record<FactTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  warning: "text-warning-foreground dark:text-warning",
  danger: "text-destructive",
  success: "text-success",
};

/** Inline label/value pairs: "Due 2 Oct · Deposit R 1 680.00 · Email —". */
export function Facts({ items, className }: { items: Fact[]; className?: string }) {
  const visible = items.filter((f) => f.value !== null && f.value !== undefined && f.value !== "");
  if (visible.length === 0) return null;
  return (
    <dl className={cn("flex flex-wrap gap-x-4 gap-y-1 text-sm", className)}>
      {visible.map((fact) => (
        <div key={fact.label} className="flex min-w-0 items-baseline gap-1.5" title={fact.title}>
          <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
          <dd className={cn("min-w-0 truncate tabular", TONE_CLASS[fact.tone ?? "default"])}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
