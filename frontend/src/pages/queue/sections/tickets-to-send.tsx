import { Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { BookingLine, Facts, type Fact } from "@/features/queue/booking-line";
import { useBookingAction } from "@/features/queue/bookings";
import type { QueueSection, TicketItem } from "@/features/queue/types";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { formatDateTime, formatPhone, formatRelativeDay, pluralise } from "@/lib/format";

import { QueueList, QueueRow, QueueSectionCard, relativeDays } from "../shared";

type Section = Extract<QueueSection, { key: "tickets_to_send" }>;

export function TicketsToSendSection({ section }: { section: Section }) {
  const action = useBookingAction();
  const emailing = useSubjectDialog<TicketItem>();
  const whatsapping = useSubjectDialog<TicketItem>();

  return (
    <QueueSectionCard sectionKey={section.key} title={section.title} count={section.count}>
      <QueueList
        items={section.items}
        getKey={(item) => item.booking.id}
        label="tickets"
        render={(item) => {
          const facts: Fact[] = [
            { label: "Visit", value: relativeDays(item.days_to_visit), tone: item.days_to_visit <= 2 ? "warning" : "default" },
            { label: "Confirmed", value: formatRelativeDay(item.confirmed_at), title: item.confirmed_at ? formatDateTime(item.confirmed_at) : undefined },
            { label: "Vehicles", value: item.vehicles > 0 ? pluralise(item.vehicles, "vehicle") : "not stated", tone: item.vehicles > 0 ? "default" : "muted" },
            { label: "Mobile", value: item.contact_mobile ? formatPhone(item.contact_mobile) : "none", tone: item.contact_mobile ? "default" : "danger" },
            { label: "Email", value: item.contact_email ?? "none", tone: item.contact_email ? "default" : "danger" },
          ];
          return (
            <QueueRow
              actions={
                <>
                  <Button variant="outline" size="sm" disabled={!item.contact_email} onClick={() => emailing.show(item)} aria-label={`Email ticket to ${item.booking.reference}`}>
                    <Mail data-icon="inline-start" />
                    Email ticket
                  </Button>
                  <Button variant="outline" size="sm" disabled={!item.contact_mobile} onClick={() => whatsapping.show(item)} aria-label={`WhatsApp ticket to ${item.booking.reference}`}>
                    <MessageCircle data-icon="inline-start" />
                    WhatsApp ticket
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
        open={emailing.open}
        onOpenChange={emailing.onOpenChange}
        title={`Email the ticket for ${emailing.subject?.booking.reference ?? ""}?`}
        description={emailing.subject ? `Sends the vehicle entry ticket PDF to ${emailing.subject.contact_email} with the ticket email. The booking is stamped as emailed.` : undefined}
        confirmLabel="Send email"
        onConfirm={async () => {
          const item = emailing.subject;
          if (!item) return;
          await action.mutateAsync({ id: item.booking.id, action: "send-ticket-email" });
          toast.success(`Ticket emailed to ${item.contact_email}`);
        }}
      />
      <ConfirmDialog
        open={whatsapping.open}
        onOpenChange={whatsapping.onOpenChange}
        title={`WhatsApp the ticket for ${whatsapping.subject?.booking.reference ?? ""}?`}
        description={
          whatsapping.subject
            ? `Sends the vehicle ticket template to ${formatPhone(whatsapping.subject.contact_mobile)} over WhatsApp. The customer receives it straight away and the booking is stamped as sent.`
            : undefined
        }
        confirmLabel="Send WhatsApp"
        onConfirm={async () => {
          const item = whatsapping.subject;
          if (!item) return;
          await action.mutateAsync({ id: item.booking.id, action: "send-ticket-whatsapp" });
          toast.success(`Ticket sent to ${formatPhone(item.contact_mobile)}`);
        }}
      />
    </QueueSectionCard>
  );
}
