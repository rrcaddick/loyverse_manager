/**
 * Payments (owner's notes, 29 Oct 2026): deposit, total and balance as three
 * short tiles with their state as a pill, any proof of payment waiting, then
 * the payments received with the money state and Find payment in the list's
 * header. There is no manual "record payment": every amount reaches the bank
 * and is found by the search; cash on the day comes from Loyverse later.
 */

import { Banknote, FileCheck, Landmark, Mail, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { BigNumber, BigNumberRow } from "@/components/big-number";
import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateShort, formatMoney, formatNumber } from "@/lib/format";

import { usePopDismiss } from "../../api";
import { isTentative } from "../../lib";
import { moneyState } from "../../money";
import { PAYMENT_KIND_LABELS, type BookingDetail, type Payment } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { PaymentDialog } from "./payment-dialog";

const money = (n: number) => formatMoney(n, { compact: true });

export function PaymentsTab({ booking }: { booking: BookingDetail }) {
  const f = booking.finance;
  const counted = f.arrived_count !== null && f.final_amount !== null;
  const total = counted ? f.final_amount! : f.total_amount;
  const depositPill = f.deposit_waived
    ? { label: "Waived", tone: "neutral" as const }
    : f.deposit_covered && f.paid_total > 0
      ? { label: "Paid", tone: "green" as const }
      : booking.hold_expires_on && isTentative(booking.status)
        ? { label: `Due ${formatDateShort(booking.hold_expires_on)}`, tone: "amber" as const }
        : f.paid_total > 0
          ? { label: `${money(f.deposit_outstanding)} short`, tone: "amber" as const }
          : { label: "Not paid", tone: "amber" as const };
  const balancePill =
    f.balance_due < -0.005
      ? { label: "Overpaid", tone: "blue" as const }
      : f.balance_due <= 0.005
        ? { label: "Paid in full", tone: "green" as const }
        : booking.status === "completed"
          ? { label: "Owed after the visit", tone: "red" as const }
          : { label: counted ? "On counted visitors" : "On the day", tone: "neutral" as const };

  return (
    <div className="flex flex-col gap-card-gap">
      <BigNumberRow columns={3}>
        <BigNumber label="Deposit" value={f.deposit_waived ? "—" : money(f.deposit_due)} badge={<StatusPill tone={depositPill.tone} label={depositPill.label} size="sm" dot={false} />} tone={f.deposit_waived ? "neutral" : f.deposit_covered && f.paid_total > 0 ? "green" : "amber"} />
        <BigNumber label="Total" value={money(total)} badge={<StatusPill tone="neutral" label={`${formatNumber(counted ? f.arrived_count! : f.people_booked)} × ${money(f.price_per_person)}`} size="sm" dot={false} />} />
        <BigNumber label={f.balance_due < -0.005 ? "Credit" : "Balance"} value={money(Math.abs(f.balance_due))} badge={<StatusPill tone={balancePill.tone} label={balancePill.label} size="sm" dot={false} />} tone={f.balance_due <= 0.005 ? "green" : booking.status === "completed" ? "red" : "neutral"} />
      </BigNumberRow>
      {booking.pops.length > 0 ? <PopsCard booking={booking} /> : null}
      <PaymentsList booking={booking} />
    </div>
  );
}

function PaymentsList({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const state = moneyState(booking);
  const [selected, setSelected] = useState<Payment | null>(null);
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
      actions={
        <div className="flex items-center gap-4">
          <StatusPill tone={state.tone} label={state.label} className="h-9 px-3.5 text-body" />
          <Button onClick={() => actions.openFindPayment()}>
            <Search data-icon="inline-start" />
            Find payment
          </Button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing received yet.</p>
      ) : (
        <ul className="-mx-5 divide-y divide-border">
          {rows.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setSelected(p)} className="flex w-full items-center gap-x-4 px-5 py-2.5 text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:ring-inset">
                {p.bank_transaction_id ? <Landmark aria-hidden="true" className="size-4 shrink-0 text-green-text" /> : <Banknote aria-hidden="true" className="size-4 shrink-0 text-green-text" />}
                <span className="w-28 shrink-0 text-body tabular text-foreground">{p.paid_on ? formatDate(p.paid_on) : formatDate(p.created_at)}</span>
                <span className="w-24 shrink-0 text-body font-medium tabular text-green-text">{money(p.amount)}</span>
                <span className="w-28 shrink-0 text-sm text-muted-foreground">{PAYMENT_KIND_LABELS[p.kind] ?? p.kind}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={[p.reference, p.note].filter(Boolean).join(" · ") || undefined}>
                  {p.reference ?? ""}
                  {p.note ? (p.reference ? ` · ${p.note}` : p.note) : ""}
                </span>
                <span className="w-24 shrink-0 text-right text-sm text-muted-foreground">{p.bank_transaction_id ? "Bank feed" : (p.recorded_by_name ?? "System")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <PaymentDialog booking={booking} payment={selected} open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} />
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
    >
      <ul className="divide-y divide-border">
        {booking.pops.map((pop) => (
          <li key={pop.id} className="flex items-center gap-x-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-foreground">
                <span className="font-medium tabular">{pop.amount != null ? money(pop.amount) : "Amount not read"}</span>
                {pop.reference ? <span className="font-mono text-sm">{pop.reference}</span> : null}
                {pop.bank_name ? <span className="text-sm text-muted-foreground">{pop.bank_name}</span> : null}
                {pop.paid_on ? <span className="text-sm tabular text-muted-foreground">Paid {formatDate(pop.paid_on)}</span> : null}
                <StatusPill tone={pop.parsed ? "blue" : "neutral"} label={pop.parsed ? "Read from the PDF" : pop.text_signal ? "Mentioned in the mail" : "Attachment"} size="sm" dot={false} />
              </div>
              <div className="text-sm text-muted-foreground">
                Received {formatDate(pop.created_at)} ·{" "}
                <Link to="?tab=conversation" className="inline-flex items-center gap-1 underline-offset-3 hover:underline">
                  <Mail aria-hidden="true" className="size-3.5" />
                  Open the mail
                </Link>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1">
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
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
