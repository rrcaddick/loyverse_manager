import { MailX } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { BookingLine, Facts, type Fact } from "@/features/queue/booking-line";
import { useBookingAction } from "@/features/queue/bookings";
import { ExtendHoldButton } from "@/features/queue/extend-hold";
import type { LapsingItem, QueueSection } from "@/features/queue/types";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { formatDate, formatDateTime, formatMoney, formatRelativeDay } from "@/lib/format";

import { QueueList, QueueRow, QueueSectionCard, relativeDays } from "../shared";

type Section = Extract<QueueSection, { key: "lapsing" }>;

export function LapsingSection({ section }: { section: Section }) {
  const action = useBookingAction();
  const expiring = useSubjectDialog<LapsingItem>();

  return (
    <QueueSectionCard sectionKey={section.key} title={section.title} count={section.count}>
      <QueueList
        items={section.items}
        getKey={(item) => item.booking.id}
        label="holds"
        render={(item) => {
          const expired = item.days_left < 0;
          const facts: Fact[] = [
            {
              label: "Hold",
              value: item.hold_expires_on
                ? `${expired ? "expired" : "expires"} ${relativeDays(item.days_left)} · ${formatDate(item.hold_expires_on)}`
                : `${expired ? "expired" : "expires"} ${relativeDays(item.days_left)}`,
              tone: expired ? "danger" : item.days_left <= 1 ? "warning" : "default",
            },
            { label: "Deposit", value: item.deposit_due !== null ? formatMoney(item.deposit_due) : null },
            { label: "Proforma", value: item.proforma_sent_at ? `sent ${formatRelativeDay(item.proforma_sent_at).toLowerCase()}` : "not sent", title: item.proforma_sent_at ? formatDateTime(item.proforma_sent_at) : undefined, tone: item.proforma_sent_at ? "default" : "muted" },
            { label: "Email", value: item.contact_email ?? "none on the booking", tone: item.contact_email ? "default" : "danger" },
          ];
          return (
            <QueueRow
              actions={
                <>
                  <ExtendHoldButton booking={item.booking} currentHold={item.hold_expires_on} />
                  <Button variant="ghost" size="sm" disabled={!item.contact_email} onClick={() => expiring.show(item)} aria-label={`Send expiry notice for ${item.booking.reference}`}>
                    <MailX data-icon="inline-start" />
                    Send expiry
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
      <ConfirmDialog
        open={expiring.open}
        onOpenChange={expiring.onOpenChange}
        title={`Let the hold on ${expiring.subject?.booking.reference ?? ""} lapse?`}
        description={
          expiring.subject
            ? `Emails ${expiring.subject.contact_email} that the hold has expired and marks ${expiring.subject.booking.reference} ${expiring.subject.booking.group_name} lapsed, releasing ${formatDate(expiring.subject.booking.visit_date)}. It can be reopened from the booking.`
            : undefined
        }
        confirmLabel="Send and lapse"
        destructive
        onConfirm={async () => {
          const item = expiring.subject;
          if (!item) return;
          await action.mutateAsync({ id: item.booking.id, action: "send-expiry" });
          toast.success(`${item.booking.reference} marked lapsed and the customer emailed`);
        }}
      />
    </QueueSectionCard>
  );
}
