/**
 * Payments (owner's plan, 29 Oct 2026): any proof of payment waiting at the
 * top, then the money ladder with every payment received and Find payment,
 * the search that matches a bank credit to this booking.
 */

import { FileCheck, Mail } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";

import { usePopDismiss } from "../../api";
import type { BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { MoneyCard } from "../money-card";

const money = (n: number) => formatMoney(n, { compact: true });

export function PaymentsTab({ booking }: { booking: BookingDetail }) {
  return (
    <div className="flex flex-col gap-card-gap">
      {booking.pops.length > 0 ? <PopsCard booking={booking} /> : null}
      <MoneyCard booking={booking} expanded />
    </div>
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
                <StatusPill tone={pop.parsed ? "blue" : "neutral"} label={pop.parsed ? "Read from the PDF" : pop.text_signal ? "Mentioned in the mail" : "Attachment"} size="sm" dot={false} />
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
