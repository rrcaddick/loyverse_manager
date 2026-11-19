/**
 * Details as a fact sheet (6 Nov 2026): the five things everyone asks about
 * at a glance, the date and how far away it is, the visitors, the price,
 * and the money as the same bar the Bookings list uses, with the rest of
 * the detail small underneath and the reference, barcode and source as a
 * footer line. Edit top right.
 */

import { CalendarDays, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { CopyButton } from "@/components/copy-button";
import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateLong, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { relativeTo, sourceLabel, useGroupTypeLabel, useTierLabel } from "../../lib";
import { moneyState } from "../../money";
import type { BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { PaymentBar } from "../payment-bar";

function Fact({ label, value, detail, className }: { label: string; value: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-label text-muted-foreground uppercase">{label}</span>
      <span className="text-title leading-tight font-semibold text-foreground">{value}</span>
      {detail ? <span className="text-sm text-muted-foreground">{detail}</span> : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 text-body">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

export function DetailsSheet({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const groupType = useGroupTypeLabel();
  const tierLabel = useTierLabel();
  const f = booking.finance;
  const state = moneyState(booking);
  const sheetRow = booking.legacy_sheet_row?._row;
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
          Details
        </span>
      }
      actions={
        <Button variant="ghost" size="sm" onClick={() => actions.openEdit()}>
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Fact
            label="Visit"
            value={
              <Link to={`/today/${booking.visit_date}`} className="underline-offset-3 hover:underline">
                {formatDateLong(booking.visit_date)}
              </Link>
            }
            detail={
              <>
                {relativeTo(booking.visit_date)}
                {booking.alternative_date ? ` · or ${formatDate(booking.alternative_date)}` : ""}
              </>
            }
            className="sm:col-span-3 lg:col-span-1"
          />
          <Fact
            label="Visitors"
            value={<span className="tabular">{formatNumber(booking.people_booked)}</span>}
            detail={
              booking.arrived_count !== null ? (
                <span className="text-green-text">{formatNumber(booking.arrived_count)} arrived</span>
              ) : booking.adults || booking.children ? (
                `${formatNumber(booking.adults)} adults · ${formatNumber(booking.children)} children`
              ) : (
                groupType(booking.group_type)
              )
            }
          />
          <Fact
            label="Price per visitor"
            value={<span className="tabular">{formatMoney(booking.price_per_person, { compact: true })}</span>}
            detail={
              booking.discount_per_person > 0
                ? `${tierLabel(booking.price_tier_code)} ${formatMoney(booking.tier_price ?? booking.price_per_person + booking.discount_per_person, { compact: true })} less ${formatMoney(booking.discount_per_person, { compact: true })}`
                : tierLabel(booking.price_tier_code)
            }
          />
        </div>

        <div className="flex flex-col gap-2 rounded-lg bg-nested px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-label text-muted-foreground uppercase">Payments</span>
            <StatusPill tone={state.tone} label={state.label} size="sm" dot={false} />
          </div>
          <PaymentBar booking={{ paid_total: f.paid_total, total_amount: f.final_amount ?? f.total_amount, balance_due: f.balance_due, deposit_due: f.deposit_due, deposit_waived: f.deposit_waived }} />
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground tabular">
            <span>Deposit {f.deposit_waived ? "waived" : formatMoney(f.deposit_due, { compact: true })}{booking.deposit_overridden && booking.deposit_override_reason ? ` (${booking.deposit_override_reason})` : ""}</span>
            <span>Total {formatMoney(f.final_amount ?? f.total_amount, { compact: true })}</span>
            {booking.hold_expires_on && (booking.status === "proforma_sent" || booking.status === "requested") ? <span>Expires {formatDate(booking.hold_expires_on)}</span> : null}
          </div>
        </div>

        <dl className="flex flex-col gap-1.5">
          <Row label="Kind of group">{groupType(booking.group_type)}</Row>
          <Row label="Area">{booking.area ?? <span className="text-muted-foreground">—</span>}</Row>
          {booking.minimum_waived_by ? <Row label="Rate">Minimum waived, another group that day</Row> : null}
          {booking.discount_reason ? <Row label="Discount">{booking.discount_reason}</Row> : null}
          {booking.customer_notes ? (
            <Row label="From the customer">
              <p className="whitespace-pre-wrap">{booking.customer_notes}</p>
            </Row>
          ) : null}
        </dl>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-mono text-foreground">
            {booking.reference}
            <CopyButton value={booking.reference} size="icon-xs" variant="ghost" />
          </span>
          {booking.barcode ? (
            <span className="inline-flex items-center gap-1">
              ticket <span className="font-mono">{booking.barcode}</span>
              <CopyButton value={booking.barcode} size="icon-xs" variant="ghost" />
            </span>
          ) : null}
          <span>{booking.source === "import" ? `Booking sheet${sheetRow ? ` row ${sheetRow}` : ""}` : sourceLabel(booking.source)}</span>
          {booking.enquiry_date ? <span>Enquired {formatDate(booking.enquiry_date)}</span> : null}
          <span>Created {formatDateTime(booking.created_at)}</span>
        </p>
      </div>
    </Section>
  );
}
