/**
 * Needs attention: everything this booking is waiting on us for, as its own
 * tab with a count (owner's note, 29 Oct 2026). Every send is a manual click
 * until sending rules take over, so each due send is an item here as well as
 * a Work item. A request's review (Accept, Decline) is the first item.
 */

import { AtSign, Bell, CheckCircle2, FileCheck, Mail, UserCheck } from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { NextStepStrip, type Urgency } from "@/components/next-step-strip";
import { Button } from "@/components/ui/button";
import { usePartyDone } from "@/features/mail/api";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";

import { availability } from "../../actions";
import { dueReminders, emailMissing, lapseNoticeDue, onSiteMissing } from "../../attention";
import { relativeTo } from "../../lib";
import { nextStep } from "../../next-step";
import { REMINDER_KIND_LABELS, type BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { NextStepCard } from "../record-header";
import { RequestBanner } from "./request-banner";

export function AttentionTab({
  booking,
  unanswered = 0,
  onPayments,
  onContacts,
  onConversation,
}: {
  booking: BookingDetail;
  /** Messages the customer sent that nobody has answered (the conversation's count). */
  unanswered?: number;
  onPayments: () => void;
  onContacts: () => void;
  onConversation: () => void;
}) {
  const actions = useBookingActions();
  const partyDone = usePartyDone();
  const reminders = booking.status === "requested" ? [] : dueReminders(booking);
  const step = nextStep(booking);
  const items: { key: string; urgency: Urgency; icon: typeof Bell; title: string; detail: string; action: ReactNode; secondary?: ReactNode }[] = [];
  if (unanswered > 0) {
    // A customer waiting for an answer comes before every send we owe.
    items.push({
      key: "unanswered",
      urgency: "amber",
      icon: Mail,
      title: unanswered === 1 ? "1 message waiting on you" : `${unanswered} messages waiting on you`,
      detail: "The customer wrote last. Reply from the conversation, or mark it handled if nothing is needed.",
      action: (
        <Button size="sm" className="min-w-32" onClick={onConversation}>
          Reply
        </Button>
      ),
      secondary: (
        <Button
          size="sm"
          variant="outline-primary"
          className="min-w-32"
          disabled={partyDone.isPending}
          onClick={async () => {
            try {
              await partyDone.mutateAsync({ partyKey: `b:${booking.id}` });
              toast.success("Marked as handled");
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          Mark handled
        </Button>
      ),
    });
  }
  items.push(...reminders.map((r) => {
    const av = availability(booking, r.action);
    return {
      key: `reminder-${r.id}`,
      urgency: (r.kind === "lapse" ? "red" : "amber") as Urgency,
      icon: Bell,
      title: `${REMINDER_KIND_LABELS[r.kind as keyof typeof REMINDER_KIND_LABELS] ?? r.kind} due`,
      detail: `Due ${formatDate(r.due_on)} · ${relativeTo(r.due_on)}`,
      action: (
        <Button size="sm" className="min-w-32" disabled={!av.enabled} title={av.enabled ? undefined : av.reason} onClick={() => actions.send(r.action)}>
          Send
        </Button>
      ),
    };
  }));
  if (booking.status !== "requested" && lapseNoticeDue(booking)) {
    const av = availability(booking, "send-expiry");
    items.push({
      key: "lapse",
      urgency: "red",
      icon: Bell,
      title: "Booking expired",
      detail: "The deposit did not arrive in time. Send the expiry notice; it marks the booking expired.",
      action: (
        <Button size="sm" className="min-w-32" disabled={!av.enabled} title={av.enabled ? undefined : av.reason} onClick={() => actions.send("send-expiry")}>
          Send expiry notice
        </Button>
      ),
    });
  }
  if (booking.status !== "requested" && emailMissing(booking)) {
    items.push({
      key: "email",
      urgency: "amber",
      icon: AtSign,
      title: "No email address",
      detail: "Nothing can be emailed until the booking has one.",
      action: (
        <Button size="sm" className="min-w-32" onClick={() => actions.openEdit("contact")}>
          Add email
        </Button>
      ),
    });
  }
  if (onSiteMissing(booking)) {
    items.push({
      key: "on-site",
      urgency: "amber",
      icon: UserCheck,
      title: "No on-site contact",
      detail: "Mark the person in charge on the day; it is the emergency contact at the gate.",
      action: (
        <Button size="sm" className="min-w-32" onClick={onContacts}>
          Open contacts
        </Button>
      ),
    });
  }
  if (booking.pops.length > 0) {
    const n = booking.pops.length;
    items.push({
      key: "pops",
      urgency: "amber",
      icon: FileCheck,
      title: `${n} ${n === 1 ? "proof of payment" : "proofs of payment"} to verify`,
      detail: "Match it to the bank credit with Find payment, or dismiss it.",
      action: (
        <Button size="sm" className="min-w-32" onClick={onPayments}>
          Open payments
        </Button>
      ),
    });
  }
  const empty = booking.status !== "requested" && !step.primary && items.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {booking.status === "requested" ? <RequestBanner booking={booking} /> : step.primary ? <NextStepCard booking={booking} verbSize="sm" verbClassName="min-w-32" /> : null}
      {items.map((e) => (
        <NextStepStrip key={e.key} urgency={e.urgency} icon={e.icon} title={e.title} detail={e.detail} primary={e.action} secondary={e.secondary} />
      ))}
      {empty ? <EmptyState variant="card" icon={CheckCircle2} title="Nothing needs you" hint="Every send is done and no payment is waiting." /> : null}
    </div>
  );
}
