import { ArrowUpRight, MessageCircleQuestion } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { BookingLine, Facts, type Fact } from "@/features/queue/booking-line";
import { visitDateLabel } from "@/features/queue/bookings";
import type { NewRequestItem, QueueSection } from "@/features/queue/types";
import { formatDateTime, formatPhone, formatRelativeDay, pluralise } from "@/lib/format";

import { QueueList, QueueRow, QueueSectionCard, groupTypeLabel, sourceLabel } from "../shared";

type Section = Extract<QueueSection, { key: "new_requests" }>;

export function NewRequestsSection({ section }: { section: Section }) {
  return (
    <QueueSectionCard sectionKey={section.key} title={section.title} count={section.count}>
      <QueueList items={section.items} getKey={(item) => item.booking.id} label="requests" render={(item) => <RequestRow item={item} />} />
    </QueueSectionCard>
  );
}

function RequestRow({ item }: { item: NewRequestItem }) {
  const facts: Fact[] = [
    { label: "Received", value: formatRelativeDay(item.created_at), title: formatDateTime(item.created_at) },
    { label: "Via", value: sourceLabel(item.source) },
    { label: "Type", value: groupTypeLabel(item.group_type) },
    { label: "Email", value: item.contact_email ?? "none", tone: item.contact_email ? "default" : "danger" },
    { label: "Mobile", value: item.contact_mobile ? formatPhone(item.contact_mobile) : "none", tone: item.contact_mobile ? "default" : "muted" },
    { label: "Alternative", value: item.alternative_date ? visitDateLabel(item.alternative_date) : null },
  ];
  return (
    <QueueRow
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to={`/bookings/${item.booking.id}`}>
            Open booking
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      }
    >
      <BookingLine booking={item.booking} />
      <Facts items={facts} />
      {item.questions_count > 0 ? (
        <div className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <MessageCircleQuestion aria-hidden="true" className="size-3.5" />
          {pluralise(item.questions_count, "question")}
          {item.unanswered_count > 0 ? <span className="font-medium text-status-amber-fg">· {item.unanswered_count} unanswered</span> : <span>· all answered</span>}
        </div>
      ) : null}
    </QueueRow>
  );
}
