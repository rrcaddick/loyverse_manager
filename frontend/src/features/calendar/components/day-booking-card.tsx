/**
 * One booking on the day view. Built for a tablet at the gate: large touch
 * targets, the numbers that matter in big type, and the actions in one row.
 */

import { ArrowUpRight, Banknote, Mail, MessageCircle, Phone, RefreshCw, Ticket, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFetchArrivals, useSetStatus } from "@/features/bookings/api";
import { ArrivalsDialog } from "@/features/bookings/components/arrivals-dialog";
import { RecordPaymentDialog } from "@/features/bookings/components/record-payment-dialog";
import { useGroupTypeLabel } from "@/features/bookings/lib";
import type { ArrivalSource, DayViewBooking } from "@/features/bookings/types";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatDate, formatMoney, formatNumber, formatPhone, formatTime, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DayBookingCardProps {
  booking: DayViewBooking;
  date: string;
}

export function DayBookingCard({ booking, date }: DayBookingCardProps) {
  const { isAdmin } = useAuth();
  const groupType = useGroupTypeLabel();
  const fetchArrivals = useFetchArrivals(booking.id);
  const setStatus = useSetStatus(booking.id);
  const [arrivals, setArrivals] = useState<{ open: boolean; initial: { count: number; source: ArrivalSource } | null }>({ open: false, initial: null });
  const [payment, setPayment] = useState(false);
  const [noShow, setNoShow] = useState(false);
  const [noShowReason, setNoShowReason] = useState("");

  const finance = booking.finance;
  const canNoShow = isAdmin && booking.status === "confirmed" && date < todayIso();
  const closed = booking.status === "cancelled" || booking.status === "lapsed";

  async function fetchFromLoyverse() {
    try {
      const result = await fetchArrivals.mutateAsync();
      setArrivals({ open: true, initial: { count: result.count, source: "loyverse" } });
    } catch (err) {
      toast.error(errorMessage(err, "Loyverse could not be reached"));
    }
  }

  const title = isAdmin ? (
    <Link to={`/bookings/${booking.id}`} className="truncate text-lg font-semibold text-foreground underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm">
      {booking.group_name}
    </Link>
  ) : (
    <span className="truncate text-lg font-semibold text-foreground">{booking.group_name}</span>
  );

  return (
    <li className={cn("flex flex-col gap-4 px-4 py-4 sm:px-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)] lg:items-start lg:gap-6", closed && "opacity-70")}>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {title}
          <span className="font-mono text-xs text-muted-foreground">{booking.reference}</span>
          <StatusBadge status={booking.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {booking.group_type ? <span>{groupType(booking.group_type)}</span> : null}
          {booking.arrival_time ? <span>Arrives {booking.arrival_time}</span> : null}
          {booking.vehicles ? <span className="tabular">{booking.vehicles} {booking.vehicles === 1 ? "vehicle" : "vehicles"}</span> : null}
          {booking.gazebos ? <span className="tabular">{booking.gazebos} {booking.gazebos === 1 ? "gazebo" : "gazebos"}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">{booking.contact_name}</span>
          {booking.contact_mobile ? (
            <Button asChild variant="outline" size="sm" className="h-8">
              <a href={`tel:+${booking.contact_mobile}`} aria-label={`Call ${booking.contact_name} on ${formatPhone(booking.contact_mobile)}`}>
                <Phone data-icon="inline-start" />
                <span className="tabular">{formatPhone(booking.contact_mobile)}</span>
              </a>
            </Button>
          ) : null}
          {booking.contact_email && isAdmin ? (
            <Button asChild variant="ghost" size="sm" className="h-8">
              <a href={`mailto:${booking.contact_email}`} aria-label={`Email ${booking.contact_email}`}>
                <Mail data-icon="inline-start" />
                Email
              </a>
            </Button>
          ) : null}
        </div>
        <TicketStatus booking={booking} />
      </div>

      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          <Figure label="Booked" value={formatNumber(booking.people_booked)} unit="people" />
          <Figure
            label="Arrived"
            value={booking.arrived_count === null ? "—" : formatNumber(booking.arrived_count)}
            unit={booking.arrived_count === null ? "not recorded" : booking.arrived_source === "loyverse" ? "from Loyverse" : "manual count"}
            tone={booking.arrived_count === null ? "muted" : "accent"}
          />
          <Figure label="Paid" value={formatMoney(finance.paid_total, { compact: true })} unit={finance.deposit_covered ? "deposit covered" : `deposit ${formatMoney(finance.deposit_due, { compact: true })}`} />
          <Figure
            label="Balance due"
            value={formatMoney(finance.balance_due, { compact: true })}
            unit={finance.balance_due > 0 ? "to collect" : "settled"}
            tone={finance.balance_due > 0 ? "warn" : "ok"}
          />
        </dl>
        {!closed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-10" onClick={fetchFromLoyverse} disabled={fetchArrivals.isPending}>
              {fetchArrivals.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              Fetch from Loyverse
            </Button>
            <Button variant="outline" className="h-10" onClick={() => setArrivals({ open: true, initial: null })}>
              <UserCheck data-icon="inline-start" />
              Enter arrivals
            </Button>
            <Button className="h-10" onClick={() => setPayment(true)}>
              <Banknote data-icon="inline-start" />
              Record gate payment
            </Button>
            {canNoShow ? (
              <Button variant="destructive" className="h-10" onClick={() => setNoShow(true)}>
                <UserX data-icon="inline-start" />
                No-show
              </Button>
            ) : null}
            {isAdmin ? (
              <Button asChild variant="ghost" className="h-10 ml-auto">
                <Link to={`/bookings/${booking.id}`}>
                  Open booking
                  <ArrowUpRight data-icon="inline-end" />
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ArrivalsDialog open={arrivals.open} onOpenChange={(open) => setArrivals((s) => ({ ...s, open }))} booking={booking} initial={arrivals.initial} />
      <RecordPaymentDialog open={payment} onOpenChange={setPayment} booking={booking} mode="gate" />
      {canNoShow ? (
        <ConfirmDialog
          open={noShow}
          onOpenChange={setNoShow}
          title={`Mark ${booking.reference} as a no-show?`}
          description={`${booking.group_name} was confirmed for ${formatDate(booking.visit_date)} and no arrivals were recorded. This cannot be undone from here.`}
          confirmLabel="Mark no-show"
          destructive
          onConfirm={async () => {
            await setStatus.mutateAsync({ status: "no_show", reason: noShowReason.trim() || "No arrivals on the day" });
            toast.success(`${booking.reference} marked as a no-show`);
            setNoShowReason("");
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`no-show-reason-${booking.id}`} className="text-sm font-medium">
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea id={`no-show-reason-${booking.id}`} rows={2} value={noShowReason} onChange={(e) => setNoShowReason(e.target.value)} placeholder="e.g. phoned to say the bus broke down" />
          </div>
        </ConfirmDialog>
      ) : null}
    </li>
  );
}

function Figure({ label, value, unit, tone = "default" }: { label: string; value: string; unit?: string; tone?: "default" | "muted" | "accent" | "warn" | "ok" }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd
        className={cn(
          "text-lg leading-7 font-semibold tabular",
          tone === "muted" && "text-muted-foreground",
          tone === "accent" && "text-primary",
          tone === "warn" && "text-status-amber-fg",
          tone === "ok" && "text-success",
        )}
      >
        {value}
      </dd>
      {unit ? <dd className="truncate text-xs text-muted-foreground">{unit}</dd> : null}
    </div>
  );
}

function TicketStatus({ booking }: { booking: DayViewBooking }) {
  const sentWa = booking.ticket_sent_at;
  const sentEmail = booking.ticket_emailed_at;
  if (!sentWa && !sentEmail) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground">
            <Ticket aria-hidden="true" className="size-3.5" />
            Vehicle ticket not sent
          </span>
        </TooltipTrigger>
        <TooltipContent>The gate can look the group up by name; the ticket is sent from the booking page.</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {sentWa ? (
        <span className="inline-flex items-center gap-1.5 text-success">
          <MessageCircle aria-hidden="true" className="size-3.5" />
          Ticket on WhatsApp {formatDate(sentWa)}, {formatTime(sentWa)}
        </span>
      ) : null}
      {sentEmail ? (
        <span className="inline-flex items-center gap-1.5 text-success">
          <Mail aria-hidden="true" className="size-3.5" />
          Ticket emailed {formatDate(sentEmail)}
        </span>
      ) : null}
    </div>
  );
}
