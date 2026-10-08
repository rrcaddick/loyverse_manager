/**
 * Payments tab: what has been paid, by what means, and the bank link.
 */

import { Banknote, Landmark, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useDeletePayment } from "../api";
import { PAYMENT_KIND_LABELS, type BookingDetail, type Payment } from "../types";
import { RecordPaymentDialog } from "./record-payment-dialog";

export function PaymentsTab({ booking }: { booking: BookingDetail }) {
  const [recordOpen, setRecordOpen] = useState(false);
  const deleting = useSubjectDialog<Payment>();
  const remove = useDeletePayment(booking.id);
  const f = booking.finance;

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Payments"
        description={`${formatMoney(f.paid_total)} received against ${formatMoney(f.total_amount)}.`}
        actions={
          <Button size="sm" onClick={() => setRecordOpen(true)}>
            <Plus data-icon="inline-start" />
            Record payment
          </Button>
        }
        flush
        footer={
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Figure label="Deposit due" value={f.deposit_waived ? "Waived" : formatMoney(f.deposit_due)} />
            <Figure label="Paid" value={formatMoney(f.paid_total)} tone={f.paid_total > 0 ? "ok" : undefined} />
            <Figure label="Deposit outstanding" value={f.deposit_waived ? "—" : f.deposit_covered ? "Covered" : formatMoney(f.deposit_outstanding)} tone={f.deposit_covered ? "ok" : "warn"} />
            <Figure label="Balance due" value={formatMoney(f.balance_due)} strong />
          </dl>
        }
      >
        {booking.payments.length === 0 ? (
          <EmptyState compact icon={Banknote} title="No payments recorded" description="Bank transfers are matched from the Payments page; cash and card are recorded here or at the gate." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="[&_td]:align-middle">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs tracking-wide uppercase">Paid on</TableHead>
                  <TableHead className="text-xs tracking-wide uppercase">Kind</TableHead>
                  <TableHead className="text-right text-xs tracking-wide uppercase">Amount</TableHead>
                  <TableHead className="text-xs tracking-wide uppercase">Reference</TableHead>
                  <TableHead className="text-xs tracking-wide uppercase">Recorded</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {booking.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap tabular">{p.paid_on ? formatDate(p.paid_on) : "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.kind} label={PAYMENT_KIND_LABELS[p.kind] ?? p.kind} tone={p.kind === "eft" ? "blue" : "neutral"} dot={false} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular">{formatMoney(p.amount)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate">{p.reference ?? <span className="text-muted-foreground">—</span>}</span>
                        {p.note ? <span className="text-xs text-muted-foreground">{p.note}</span> : null}
                        {p.bank_transaction_id ? (
                          <Link to={`/payments?transaction=${p.bank_transaction_id}`} className="inline-flex w-fit items-center gap-1 text-xs text-status-blue-fg underline-offset-3 hover:underline">
                            <Landmark aria-hidden="true" className="size-3" />
                            Bank transaction #{p.bank_transaction_id}
                          </Link>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.recorded_by_name ?? (p.bank_transaction_id ? "Bank match" : "System")}
                      <div className="tabular">{formatDate(p.created_at)}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.bank_transaction_id ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="Matched from the bank; unmatch it on the Payments page">
                              <Button variant="ghost" size="icon-sm" disabled>
                                <Trash2 />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Matched from the bank — unmatch it on the Payments page instead</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete payment of ${formatMoney(p.amount)}`} onClick={() => deleting.show(p)}>
                          <Trash2 />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <RecordPaymentDialog open={recordOpen} onOpenChange={setRecordOpen} booking={booking} />
      <ConfirmDialog
        open={deleting.open}
        onOpenChange={deleting.onOpenChange}
        title={`Delete the ${formatMoney(deleting.subject?.amount)} payment?`}
        description="The amount comes off the paid total. A confirmation that this payment triggered is not reverted — change the status by hand if needed."
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

function Figure({ label, value, tone, strong }: { label: string; value: string; tone?: "ok" | "warn"; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular", strong && "font-semibold", tone === "ok" && "text-success", tone === "warn" && "text-status-amber-fg")}>{value}</dd>
    </div>
  );
}
