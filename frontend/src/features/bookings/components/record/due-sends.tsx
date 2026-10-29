/**
 * What this booking is waiting on us for. Every send is a manual click until
 * the owner's mother trusts the system (plan, 29 Oct 2026), so each due send
 * is a prompt here as well as a Work item: the computed next step first, then
 * any reminder that has fallen due and any proof of payment waiting.
 */

import { Bell, FileCheck } from "lucide-react";
import type { ReactNode } from "react";

import { NextStepStrip, type Urgency } from "@/components/next-step-strip";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

import { availability, type ActionId } from "../../actions";
import { daysFromToday, relativeTo } from "../../lib";
import { nextStep } from "../../next-step";
import { REMINDER_KIND_LABELS, type BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { NextStepCard } from "../record-header";

interface Extra {
  key: string;
  urgency: Urgency;
  icon: typeof Bell;
  title: string;
  detail: string;
  action: ReactNode;
}

export function DueSends({ booking, onPayments }: { booking: BookingDetail; onPayments: () => void }) {
  const actions = useBookingActions();
  const step = nextStep(booking);
  const primaryAction = step.primary?.kind === "send" ? step.primary.action : null;
  const extras: Extra[] = [];

  for (const r of booking.reminders) {
    if (r.status !== "due" || daysFromToday(r.due_on) > 0) continue;
    const id: ActionId = r.kind === "lapse" ? "send-expiry" : `reminder:${r.kind}`;
    if (id === primaryAction) continue;
    const av = availability(booking, id);
    if (av.hidden) continue;
    extras.push({
      key: `reminder-${r.id}`,
      urgency: r.kind === "lapse" ? "red" : "amber",
      icon: Bell,
      title: `${REMINDER_KIND_LABELS[r.kind] ?? r.kind} due`,
      detail: `Due ${formatDate(r.due_on)} · ${relativeTo(r.due_on)}`,
      action: (
        <Button size="sm" disabled={!av.enabled} title={av.enabled ? undefined : av.reason} onClick={() => actions.send(id)}>
          Send
        </Button>
      ),
    });
  }
  if (booking.pops.length > 0) {
    const n = booking.pops.length;
    extras.push({
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

  return (
    <div className="flex flex-col gap-3">
      <NextStepCard booking={booking} />
      {extras.slice(0, 3).map((e) => (
        <NextStepStrip key={e.key} urgency={e.urgency} icon={e.icon} title={e.title} detail={e.detail} primary={e.action} />
      ))}
    </div>
  );
}
