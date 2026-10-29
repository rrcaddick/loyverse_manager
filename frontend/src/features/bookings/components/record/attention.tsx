/**
 * Needs attention: everything this booking is waiting on us for, as its own
 * tab with a count (owner's note, 29 Oct 2026). Every send is a manual click
 * until sending rules take over, so each due send is an item here as well as
 * a Work item. A request's review (Accept, Decline) is the first item.
 */

import { Bell, CheckCircle2, FileCheck } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { NextStepStrip, type Urgency } from "@/components/next-step-strip";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

import { availability } from "../../actions";
import { dueReminders } from "../../attention";
import { relativeTo } from "../../lib";
import { nextStep } from "../../next-step";
import { REMINDER_KIND_LABELS, type BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { NextStepCard } from "../record-header";
import { RequestBanner } from "./request-banner";

export function AttentionTab({ booking, onPayments }: { booking: BookingDetail; onPayments: () => void }) {
  const actions = useBookingActions();
  const reminders = booking.status === "requested" ? [] : dueReminders(booking);
  const step = nextStep(booking);
  const items: { key: string; urgency: Urgency; icon: typeof Bell; title: string; detail: string; action: ReactNode }[] = reminders.map((r) => {
    const av = availability(booking, r.action);
    return {
      key: `reminder-${r.id}`,
      urgency: r.kind === "lapse" ? "red" : "amber",
      icon: Bell,
      title: `${REMINDER_KIND_LABELS[r.kind as keyof typeof REMINDER_KIND_LABELS] ?? r.kind} due`,
      detail: `Due ${formatDate(r.due_on)} · ${relativeTo(r.due_on)}`,
      action: (
        <Button size="sm" disabled={!av.enabled} title={av.enabled ? undefined : av.reason} onClick={() => actions.send(r.action)}>
          Send
        </Button>
      ),
    };
  });
  if (booking.pops.length > 0) {
    const n = booking.pops.length;
    items.push({
      key: "pops",
      urgency: "amber",
      icon: FileCheck,
      title: `${n} ${n === 1 ? "proof of payment" : "proofs of payment"} to verify`,
      detail: "Match it to the bank credit with Find payment, or dismiss it.",
      action: (
        <Button size="sm" variant="outline" onClick={onPayments}>
          Open payments
        </Button>
      ),
    });
  }
  const empty = booking.status !== "requested" && !step.primary && items.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {booking.status === "requested" ? <RequestBanner booking={booking} /> : step.primary ? <NextStepCard booking={booking} /> : null}
      {items.map((e) => (
        <NextStepStrip key={e.key} urgency={e.urgency} icon={e.icon} title={e.title} detail={e.detail} primary={e.action} />
      ))}
      {empty ? <EmptyState variant="card" icon={CheckCircle2} title="Nothing needs you" hint="Every send is done and no payment is waiting." /> : null}
    </div>
  );
}
