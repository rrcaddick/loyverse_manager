/**
 * Payments (owner's notes, 29 Oct 2026): three figures across the top
 * (deposit, total, balance) with Find payment beside them, any proof of
 * payment waiting, then the payments received as a list. There is no manual
 * "record payment": every amount reaches the bank and is found by the search;
 * cash on the day comes from Loyverse later.
 */

import { Banknote, FileCheck, Landmark, Mail, Search, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import { BigNumber, BigNumberRow } from "@/components/big-number";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateShort, formatMoney, formatNumber } from "@/lib/format";

import { useDeletePayment, usePopDismiss } from "../../api";
import { isTentative } from "../../lib";
import { moneyState } from "../../money";
import { PAYMENT_KIND_LABELS, type BookingDetail, type Payment } from "../../types";
import { useBookingActions } from "../../use-booking-actions";

const money = (n: number) => formatMoney(n, { compact: true });

export function PaymentsTab({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const f = booking.finance;
  const state = moneyState(booking);
  const counted = f.arrived_count !== null && f.final_amount !== null;
  const total = counted ? f.final_amount! : f.total_amount;
  const depositDetail = f.deposit_waived ? "waived" : f.deposit_covered && f.paid_total > 0 ? "paid" : booking.hold_expires_on && isTentative(booking.status) ? `due ${formatDateShort(booking.hold_expires_on)}` : f.paid_total > 0 ? `${money(f.deposit_outstanding)} short` : "not paid yet";
  const balanceDetail = f.balance_due < -0.005 ? "overpaid" : f.balance_due <= 0.005 ? "paid in full" : booking.status === "completed" ? "owed after the visit" : counted ? "on the counted visitors" : "on the day";

  return (
    <div className="flex flex-col gap-card-gap">
      <div className="flex flex-wrap items-start gap-3">
        <BigNumberRow className="min-w-0 flex-1" columns={3}>
          <BigNumber label="Deposit" value={f.deposit_waived ? "Waived" : money(f.deposit_due)} detail={depositDetail} tone={f.deposit_waived ? "neutral" : f.deposit_covered && f.paid_total > 0 ? "green" : "amber"} />
          <BigNumber label="Total" value={money(total)} detail={`${formatNumber(counted ? f.arrived_count! : f.people_booked)} × ${money(f.price_per_person)}${counted ? " arrived" : ""}`} />
          <BigNumber label={f.balance_due < -0.005 ? "Credit" : "Balance"} value={money(Math.abs(f.balance_due))} detail={balanceDetail} tone={f.balance_due <= 0.005 ? "green" : booking.status === "completed" ? "red" : "neutral"} />
        </BigNumberRow>
        <div className="flex flex-col items-end gap-2 self-stretch justify-center">
          <Button onClick={() => actions.openFindPayment()}>
            <Search data-icon="inline-start" />
            Find payment
          </Button>
          <StatusPill tone={state.tone} label={state.label} />
        </div>
      </div>
      {booking.pops.length > 0 ? <PopsCard booking={booking} /> : null}
      <PaymentsList booking={booking} />
    </div>
  );
}

function PaymentsList({ booking }: { booking: BookingDetail }) {
  const deleting = useSubjectDialog<Payment>();
  const remove = useDeletePayment(booking.id);
  const rows = [...booking.payments].sort((a, b) => ((a.paid_on ?? a.created_at) < (b.paid_on ?? b.created_at) ? 1 : -1));
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Banknote aria-hidden="true" className="size-4 text-muted-foreground" />
          Payments received
          {rows.length ? <span className="text-sm font-normal text-muted-foreground">{rows.length}</span> : null}
        </span>
      }
      description="Found in the bank feed, or recorded from the gate on the day."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing received yet. Find payment searches the bank feed for this booking's credits.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              {p.bank_transaction_id ? <Landmark aria-hidden="true" className="size-4 shrink-0 text-green-text" /> : <Banknote aria-hidden="true" className="size-4 shrink-0 text-green-text" />}
              <span className="w-28 shrink-0 text-body tabular text-foreground">{p.paid_on ? formatDate(p.paid_on) : formatDate(p.created_at)}</span>
              <span className="w-24 shrink-0 text-body font-medium tabular text-green-text">{money(p.amount)}</span>
              <span className="w-12 shrink-0 text-sm text-muted-foreground">{PAYMENT_KIND_LABELS[p.kind] ?? p.kind}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={[p.reference, p.note].filter(Boolean).join(" · ") || undefined}>
                {p.reference ?? ""}
                {p.note ? (p.reference ? ` · ${p.note}` : p.note) : ""}
              </span>
              <span className="text-sm text-muted-foreground">{p.bank_transaction_id ? "Bank feed" : (p.recorded_by_name ?? "System")}</span>
              {p.bank_transaction_id ? (
                <span className="w-9" aria-hidden="true" />
              ) : (
                <Button variant="ghost" size="icon-sm" aria-label={`Remove the ${money(p.amount)} payment`} onClick={() => deleting.show(p)}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting.open}
        onOpenChange={deleting.onOpenChange}
        title={`Remove the ${formatMoney(deleting.subject?.amount)} payment?`}
        description="The amount comes off the paid total. A confirmation this payment triggered is not reverted."
        confirmLabel="Remove payment"
        destructive
        onConfirm={async () => {
          if (!deleting.subject) return;
          await remove.mutateAsync(deleting.subject.id);
          deleting.close();
        }}
      />
    </Section>
  );
}

function PopsCard({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const dismiss = usePopDismiss(booking.id);
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <FileCheck aria-hidden="true" className="size-4 text-amber-text" />
          Proof of payment to verify
        </span>
      }
      description="Sent by the customer. Find the credit in the bank feed and record it, or dismiss the proof."
    >
      <ul className="divide-y divide-border">
        {booking.pops.map((pop) => (
          <li key={pop.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-foreground">
                <span className="font-medium tabular">{pop.amount != null ? money(pop.amount) : "Amount not read"}</span>
                {pop.reference ? <span className="font-mono text-sm">{pop.reference}</span> : null}
                {pop.bank_name ? <span className="text-sm text-muted-foreground">{pop.bank_name}</span> : null}
                {pop.paid_on ? <span className="text-sm tabular text-muted-foreground">paid {formatDate(pop.paid_on)}</span> : null}
                <span className="text-sm text-muted-foreground">{pop.parsed ? "read from the PDF" : pop.text_signal ? "mentioned in the mail" : "attachment"}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Received {formatDate(pop.created_at)} ·{" "}
                <Link to="?tab=conversation" className="inline-flex items-center gap-1 underline-offset-3 hover:underline">
                  <Mail aria-hidden="true" className="size-3.5" />
                  open the mail
                </Link>
              </div>
            </div>
            <Button size="sm" onClick={() => actions.openFindPayment({ reference: pop.reference ?? undefined, amount: pop.amount, popId: pop.id })}>
              Find payment
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={dismiss.isPending}
              onClick={async () => {
                try {
                  await dismiss.mutateAsync(pop.id);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              Dismiss
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
