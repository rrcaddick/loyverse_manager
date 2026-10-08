import { BellOff, Send } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useDismissReminder } from "@/features/queue/api";
import { BookingLine, Facts, type Fact } from "@/features/queue/booking-line";
import { useBookingAction, type ReminderKind } from "@/features/queue/bookings";
import type { QueueSection, ReminderGroup, ReminderItem } from "@/features/queue/types";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

import { CountBadge, QueueList, QueueRow, QueueSectionCard, overdueLabel } from "../shared";

type Section = Extract<QueueSection, { key: "reminders_due" }>;

interface SendCopy {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
}

/** What each reminder kind sends, stated plainly before the operator confirms. */
function describeSend(item: ReminderItem): SendCopy {
  const to = item.contact_email ?? "the contact";
  const ref = `${item.booking.reference} ${item.booking.group_name}`;
  switch (item.kind) {
    case "still_interested":
      return {
        title: `Ask ${item.booking.reference} whether they are still interested?`,
        description: `Emails ${to} to ask whether they still want ${formatDate(item.booking.visit_date)}. The latest proforma is attached. The reminder is marked sent.`,
        confirmLabel: "Send reminder",
      };
    case "deposit_reminder":
      return {
        title: `Send the deposit reminder for ${item.booking.reference}?`,
        description: `Emails ${to} that the deposit${item.deposit_due ? ` of ${formatMoney(item.deposit_due)}` : ""} is due${item.hold_expires_on ? ` before the hold expires on ${formatDate(item.hold_expires_on)}` : ""}. The latest proforma is attached.`,
        confirmLabel: "Send reminder",
      };
    case "final_details":
      return {
        title: `Send final details to ${item.booking.reference}?`,
        description: `Emails ${to} the final details for ${formatDate(item.booking.visit_date)}. The vehicle ticket is attached if it has not been emailed before.`,
        confirmLabel: "Send details",
      };
    case "lapse":
      return {
        title: `Let the hold on ${item.booking.reference} lapse?`,
        description: `Emails ${to} that the hold on ${ref} has expired and marks the booking lapsed, releasing ${formatDate(item.booking.visit_date)}. This can be reopened later from the booking.`,
        confirmLabel: "Send and lapse",
        destructive: true,
      };
  }
}

export function RemindersDueSection({ section }: { section: Section }) {
  const send = useBookingAction();
  const dismiss = useDismissReminder();
  const sending = useSubjectDialog<ReminderItem>();
  const copy = sending.subject ? describeSend(sending.subject) : null;

  return (
    <QueueSectionCard sectionKey={section.key} title={section.title} count={section.count}>
      <div className="divide-y divide-border">
        {section.items.map((group) => (
          <ReminderGroupBlock key={group.kind} group={group} onSend={(item) => sending.show(item)} onDismiss={(item) => dismiss.mutate(item.reminder_id)} dismissingId={dismiss.isPending ? dismiss.variables ?? null : null} />
        ))}
      </div>
      <ConfirmDialog
        open={sending.open}
        onOpenChange={sending.onOpenChange}
        title={copy?.title ?? ""}
        description={copy?.description}
        confirmLabel={copy?.confirmLabel ?? "Send"}
        destructive={copy?.destructive}
        onConfirm={async () => {
          const item = sending.subject;
          if (!item) return;
          await send.mutateAsync(
            item.kind === "lapse"
              ? { id: item.booking.id, action: "send-expiry" }
              : { id: item.booking.id, action: "send-reminder", body: { kind: item.kind satisfies ReminderKind } },
          );
          toast.success(item.kind === "lapse" ? `${item.booking.reference} marked lapsed and the customer emailed` : `Reminder emailed to ${item.contact_email}`);
        }}
      />
    </QueueSectionCard>
  );
}

function ReminderGroupBlock({
  group,
  onSend,
  onDismiss,
  dismissingId,
}: {
  group: ReminderGroup;
  onSend: (item: ReminderItem) => void;
  onDismiss: (item: ReminderItem) => void;
  dismissingId: number | null;
}) {
  return (
    <section aria-label={group.title}>
      <h3 className="flex items-center gap-2 bg-muted/40 px-5 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {group.title}
        <CountBadge count={group.count} className="bg-background" />
      </h3>
      <QueueList
        items={group.items}
        getKey={(item) => item.reminder_id}
        label="reminders"
        limit={5}
        render={(item) => {
          const noEmail = !item.contact_email;
          const facts: Fact[] = [
            { label: "Due", value: `${formatDate(item.due_on)} · ${overdueLabel(item.days_overdue)}`, tone: item.days_overdue > 7 ? "danger" : item.days_overdue > 0 ? "warning" : "default" },
            { label: "Deposit", value: item.deposit_due !== null ? formatMoney(item.deposit_due) : null },
            { label: "Hold expires", value: item.hold_expires_on ? formatDate(item.hold_expires_on) : null },
            { label: "Email", value: item.contact_email ?? "none on the booking", tone: noEmail ? "danger" : "default" },
          ];
          const busy = dismissingId === item.reminder_id;
          return (
            <QueueRow
              actions={
                <>
                  <Button variant="outline" size="sm" disabled={noEmail} onClick={() => onSend(item)} aria-label={`Send ${group.title.toLowerCase()} to ${item.booking.reference}`}>
                    <Send data-icon="inline-start" />
                    Send
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDismiss(item)} aria-label={`Dismiss reminder for ${item.booking.reference}`}>
                    <BellOff data-icon="inline-start" />
                    Dismiss
                  </Button>
                </>
              }
            >
              <BookingLine booking={item.booking} />
              <Facts items={facts} />
            </QueueRow>
          );
        }}
      />
      {group.items.length === 0 ? <p className="px-5 py-3 text-sm text-muted-foreground">{formatNumber(0)} reminders</p> : null}
    </section>
  );
}
