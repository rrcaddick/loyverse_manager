/**
 * The right-hand detail for a selected Work row (spec §4: "the detail opens
 * beside the list, not on a new page"): the booking's facts line, its money
 * ladder, the latest message and "Open booking". A row without a booking
 * (an unmatched credit) shows the credit and a way into Bank.
 */

import { ArrowRight, Landmark, Mail, X } from "lucide-react";

import { MoneyLadder, type MoneyRow } from "@/components/money-ladder";
import { SectionHeader } from "@/components/section-header";
import { StatusPill, type StatusTone } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBooking } from "@/features/bookings/api";
import { useGroupTypeLabel } from "@/features/bookings/lib";
import type { BookingDetail, BookingEmail } from "@/features/bookings/types";
import { formatDate, formatDateShort, formatMoney, formatPhone, formatRelativeDay, formatTime, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { WorkAction, WorkRow } from "../types";

interface WorkDetailPanelProps {
  row: WorkRow;
  onClose: () => void;
  onAction: (action: WorkAction, row: WorkRow) => void;
  className?: string;
}

function moneyState(b: BookingDetail): { label: string; tone: StatusTone } {
  if (b.status === "completed") return { label: b.finance.balance_due > 0 ? "Balance due" : "Paid in full", tone: b.finance.balance_due > 0 ? "amber" : "green-muted" };
  if (b.status === "cancelled" || b.status === "lapsed" || b.status === "no_show") return { label: b.status_label, tone: "red-muted" };
  if (b.finance.deposit_waived) return { label: "Deposit waived", tone: "neutral" };
  if (b.finance.deposit_covered && b.finance.paid_total > 0) return { label: "Deposit paid", tone: "green" };
  if (b.proforma_sent_at) return { label: "Deposit due", tone: "amber" };
  return { label: "No proforma yet", tone: "neutral" };
}

function latestEmail(b: BookingDetail): BookingEmail | null {
  if (b.emails.length === 0) return null;
  return [...b.emails].sort((a, c) => (a.sent_at < c.sent_at ? 1 : -1))[0] ?? null;
}

export function WorkDetailPanel({ row, onClose, onAction, className }: WorkDetailPanelProps) {
  const bookingId = row.booking?.id ?? null;
  const detail = useBooking(bookingId);
  const groupType = useGroupTypeLabel();
  const b = detail.data;
  const conversation = [row.primary, ...row.secondary].find((a) => a.action === "open_conversation");

  return (
    <aside className={cn("flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-border", className)} aria-label="Selected item">
      <div className="flex items-start gap-3 border-b border-border px-card py-4">
        <div className="min-w-0 flex-1">
          {row.booking ? (
            <>
              <div className="font-mono text-sm text-muted-foreground">{row.booking.reference}</div>
              <h2 className="text-section truncate">{row.booking.group_name}</h2>
            </>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">Bank credit</div>
              <h2 className="text-section truncate">{row.title}</h2>
            </>
          )}
        </div>
        {row.booking ? <StatusPill status={b?.status ?? row.booking.status} className="mt-1" /> : null}
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      {row.booking ? (
        <div className="flex flex-col gap-4 px-card py-4">
          {b ? (
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <div className="text-body text-foreground tabular">
                {formatDate(b.visit_date)} · {pluralise(b.people_booked, "person", "people")}
                {b.group_type ? ` · ${groupType(b.group_type)}` : ""}
                {b.arrival_time ? ` · arrives ${b.arrival_time}` : ""}
              </div>
              <div className="truncate">
                {b.contact_name}
                {b.contact_mobile ? ` · ${formatPhone(b.contact_mobile)}` : ""}
                {b.contact_email ? ` · ${b.contact_email}` : ""}
              </div>
              {b.hold_expires_on && (b.status === "enquiry" || b.status === "proforma_sent") ? <div className="tabular">Hold until {formatDate(b.hold_expires_on)}</div> : null}
            </div>
          ) : detail.isError ? (
            <p className="text-sm text-red-text">Could not load the booking.</p>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-4 w-40" />
            </div>
          )}

          {b ? <MoneyLadder state={moneyState(b)} rows={ladderRows(b)} className="ring-0 bg-transparent [&>div:first-child]:px-0 [&>dl]:px-0" /> : <Skeleton className="h-40" />}

          <div>
            <SectionHeader as="h3" icon={Mail} tone="blue" title="Latest message" rule={false} className="mb-1" />
            {b ? <LatestMessage email={latestEmail(b)} /> : <Skeleton className="h-12" />}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-card py-4">
          <div className="text-display tabular">{formatMoney(row.amount, { compact: true })}</div>
          <p className="text-sm text-muted-foreground">{row.context}</p>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border bg-nested px-card py-3">
        {row.booking ? (
          <Button variant="outline" onClick={() => onAction({ action: "open_booking", verb: "Open booking", booking_id: row.booking!.id }, row)}>
            Open booking
            <ArrowRight data-icon="inline-end" />
          </Button>
        ) : null}
        {conversation ? (
          <Button variant="outline" onClick={() => onAction(conversation, row)}>
            <Mail data-icon="inline-start" />
            Open in Mail
          </Button>
        ) : null}
        {row.kind === "money" ? (
          <Button
            variant="outline"
            onClick={() => {
              const open = [row.primary, ...row.secondary].find((a) => a.action === "open_transaction");
              if (open) onAction(open, row);
            }}
          >
            <Landmark data-icon="inline-start" />
            Open in Bank
          </Button>
        ) : null}
        <Button className="ml-auto" onClick={() => onAction(row.primary, row)}>
          {row.primary.verb}
        </Button>
      </div>
    </aside>
  );
}

function ladderRows(b: BookingDetail): MoneyRow[] {
  const f = b.finance;
  const paidNote = b.payments.length > 0 ? pluralise(b.payments.length, "payment") : "nothing yet";
  const rows: MoneyRow[] = [
    { key: "total", label: "Total", amount: f.total_amount, note: `${f.people_booked} × ${formatMoney(f.price_per_person, { compact: true })}` },
    {
      key: "deposit",
      label: "Deposit",
      amount: f.deposit_waived ? "Waived" : f.deposit_due,
      note: f.deposit_waived ? undefined : b.hold_expires_on && !f.deposit_covered ? `by ${formatDateShort(b.hold_expires_on)}` : f.deposit_covered ? "covered" : undefined,
      tone: !f.deposit_waived && !f.deposit_covered ? "amber" : "neutral",
    },
    { key: "paid", label: "Paid", amount: f.paid_total, note: paidNote, tone: f.paid_total > 0 ? "green" : "neutral" },
    { key: "balance", label: "Balance", amount: f.balance_due, emphasis: true, note: f.arrived_count !== null ? "after arrivals" : "on the day" },
  ];
  return rows;
}

function LatestMessage({ email }: { email: BookingEmail | null }) {
  if (!email) return <p className="text-sm text-muted-foreground">No email on this booking yet.</p>;
  const inbound = email.direction === "inbound";
  return (
    <div className="rounded-lg bg-nested px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className={cn("size-2 shrink-0 rounded-full", inbound ? "bg-direction-in" : "bg-direction-out")} aria-hidden="true" />
        <span className="truncate text-foreground">{inbound ? `From ${email.from_name ?? email.from_email ?? "customer"}` : "Sent by the office"}</span>
        <span className="ml-auto shrink-0 tabular">
          {formatRelativeDay(email.sent_at)} {formatTime(email.sent_at)}
        </span>
      </div>
      {email.subject ? <div className="mt-1 truncate font-medium text-foreground">{email.subject}</div> : null}
      {email.snippet ? <p className="mt-1 line-clamp-3 text-muted-foreground">{email.snippet}</p> : null}
    </div>
  );
}
