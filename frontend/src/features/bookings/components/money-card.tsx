/**
 * The money card: a MoneyLadder (Total / Deposit / Paid / Balance) with one
 * state word, the Paid row expanding to the payment rows and Record payment,
 * and a pricing footer (tier, day type, overrides with their reasons).
 */

import { Banknote, Landmark, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { MoneyLadder, type MoneyRow } from "@/components/money-ladder";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettings } from "@/features/settings/api";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { formatDate, formatDateShort, formatMoney, formatNumber, formatPercent, humanise, pluralise } from "@/lib/format";

import { useDeletePayment } from "../api";
import { isTentative } from "../lib";
import { moneyState } from "../money";
import { PAYMENT_KIND_LABELS, type BookingDetail, type Payment } from "../types";
import { useBookingActions } from "../use-booking-actions";

const money = (n: number) => formatMoney(n, { compact: true });

export function MoneyCard({ booking }: { booking: BookingDetail }) {
  const f = booking.finance;
  const actions = useBookingActions();
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const tier = settings.data?.price_tiers.find((t) => t.code === booking.price_tier_code);
  const ended = booking.status === "cancelled" || booking.status === "lapsed" || booking.status === "no_show";
  const tentative = isTentative(booking.status);

  const counted = f.arrived_count !== null && f.final_amount !== null;
  const rows: MoneyRow[] = [
    {
      key: "total",
      label: "Total",
      amount: counted ? f.final_amount! : f.total_amount,
      note: (
        <span className="tabular">
          {counted ? `${formatNumber(f.arrived_count!)} arrived` : formatNumber(f.people_booked)} × {money(f.price_per_person)}
          <span className="hidden sm:inline">
            {counted ? ` · ${formatNumber(f.people_booked)} booked` : ""}
            <span className="text-faint-foreground"> · VAT {money(counted ? (f.final_vat_amount ?? 0) : f.vat_amount)}</span>
          </span>
        </span>
      ),
    },
    {
      key: "deposit",
      label: "Deposit",
      amount: f.deposit_waived ? <span className="text-muted-foreground">Waived</span> : f.deposit_due,
      note: f.deposit_waived ? (
        "not required"
      ) : (
        <span>
          {booking.hold_expires_on && tentative ? `due ${formatDateShort(booking.hold_expires_on)}` : null}
          {f.deposit_covered && f.paid_total > 0 ? <span className="text-green-text">{booking.hold_expires_on && tentative ? " · " : ""}✓ paid</span> : null}
          {!f.deposit_covered && f.paid_total > 0 ? ` · ${money(f.deposit_outstanding)} short` : null}
        </span>
      ),
      tone: f.deposit_waived ? "neutral" : f.deposit_covered && f.paid_total > 0 ? "green" : ended ? "neutral" : "amber",
    },
    {
      key: "paid",
      label: "Paid",
      amount: f.paid_total,
      note: booking.payments.length ? pluralise(booking.payments.length, "payment") : "no payments yet",
      tone: f.paid_total > 0 ? "green" : "neutral",
      onClick: () => setOpen((v) => !v),
    },
    {
      key: "balance",
      label: f.balance_due < -0.005 ? "Credit" : "Balance",
      amount: Math.abs(f.balance_due),
      emphasis: true,
      note: f.balance_due < -0.005 ? "overpaid" : f.balance_due <= 0.005 ? null : booking.status === "completed" ? "owed after the visit" : counted ? "on the counted visitors" : "on the day",
      tone: f.balance_due < -0.005 ? "neutral" : booking.status === "completed" && f.balance_due > 0.005 ? "red" : "neutral",
    },
  ];

  return (
    <div className="rounded-xl bg-card ring-1 ring-border">
      <MoneyLadder rows={rows} state={moneyState(booking)} className="bg-transparent ring-0" />
      {open ? <PaymentsPanel booking={booking} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-card py-2.5 text-sm text-muted-foreground">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <SlidersHorizontal aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{tier ? tier.label : booking.price_tier_code ? humanise(booking.price_tier_code) : "No tier"}</span>
          <span aria-hidden="true">·</span>
          <span>{booking.day_type === "weekend" ? "Weekend rate" : "Weekday rate"}</span>
          {booking.is_peak ? <StatusPill tone="amber" label="Peak" size="sm" dot={false} /> : null}
          {booking.in_no_discount_window && !booking.is_peak ? <StatusPill tone="amber" label="No-discount window" size="sm" dot={false} /> : null}
          {booking.price_overridden ? <OverrideTag label={`Special price ${money(booking.price_per_person)}`} reason={booking.price_override_reason} /> : null}
          {booking.deposit_waived ? <OverrideTag label="Deposit waived" reason={booking.deposit_override_reason} /> : booking.deposit_overridden ? <OverrideTag label="Custom deposit" reason={booking.deposit_override_reason} /> : null}
          {settings.data && !booking.deposit_waived && !booking.deposit_overridden ? (
            <span className="text-faint-foreground">
              · deposit = max({settings.data.settings.deposit.min_people} visitors, {formatPercent(settings.data.settings.deposit.percent)}) × price
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => actions.openEdit("pricing")}>
            Edit pricing
          </Button>
          <Button variant="ghost" size="sm" onClick={actions.openPayment}>
            <Plus data-icon="inline-start" />
            Record payment
          </Button>
        </div>
      </div>
    </div>
  );
}

/** An override as a small blue tag; the reason on hover (research note 04). */
function OverrideTag({ label, reason }: { label: string; reason: string | null }) {
  const pill = <StatusPill tone="blue" label={reason ? `${label} · ${reason}` : label} size="sm" dot={false} className="max-w-[18rem] [&>span]:truncate" />;
  if (!reason) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-selection-ring">
          {pill}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function PaymentsPanel({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const deleting = useSubjectDialog<Payment>();
  const remove = useDeletePayment(booking.id);
  return (
    <div className="border-t border-border bg-nested/60 px-card py-3">
      {booking.payments.length === 0 ? (
        <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Banknote aria-hidden="true" className="size-4" />
          No payments recorded. Bank transfers are matched on the Bank page; cash and card are recorded here or at the gate.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {booking.payments.map((p) => (
            <li key={p.id} className="flex min-h-row items-center gap-3 py-1.5">
              <span className="w-24 shrink-0 text-sm tabular text-muted-foreground">{p.paid_on ? formatDate(p.paid_on) : "—"}</span>
              <StatusPill tone={p.kind === "eft" ? "blue" : "neutral"} label={PAYMENT_KIND_LABELS[p.kind] ?? p.kind} size="sm" dot={false} />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {p.reference ?? ""}
                {p.note ? (p.reference ? ` · ${p.note}` : p.note) : ""}
                {p.bank_transaction_id ? (
                  <Link to={`/bank?tx=${p.bank_transaction_id}`} className="ml-2 inline-flex items-center gap-1 text-blue-text underline-offset-3 hover:underline">
                    <Landmark aria-hidden="true" className="size-3" />
                    Bank #{p.bank_transaction_id}
                  </Link>
                ) : null}
                <span className="text-faint-foreground"> · {p.recorded_by_name ?? (p.bank_transaction_id ? "bank match" : "system")}</span>
              </span>
              <span className="shrink-0 text-body font-medium tabular text-green-text">{money(p.amount)}</span>
              {p.bank_transaction_id ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-selection-ring" aria-label="Matched from the bank; unmatch it on the Bank page">
                      <Button variant="ghost" size="icon-sm" disabled>
                        <Trash2 />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Matched from the bank — unmatch it on the Bank page instead</TooltipContent>
                </Tooltip>
              ) : (
                <Button variant="ghost" size="icon-sm" aria-label={`Delete payment of ${money(p.amount)}`} onClick={() => deleting.show(p)}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={actions.openPayment}>
          <Plus data-icon="inline-start" />
          Record payment
        </Button>
      </div>
      <ConfirmDialog
        open={deleting.open}
        onOpenChange={deleting.onOpenChange}
        title={`Delete the ${formatMoney(deleting.subject?.amount)} payment?`}
        description="The amount comes off the paid total. A confirmation this payment triggered is not reverted — change the status by hand if needed."
        confirmLabel="Delete payment"
        destructive
        onConfirm={async () => {
          if (!deleting.subject) return;
          await remove.mutateAsync(deleting.subject.id);
          deleting.close();
        }}
      />
    </div>
  );
}
