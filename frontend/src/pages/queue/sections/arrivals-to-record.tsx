import { ArrowUpRight, ClipboardCheck } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { BookingLine, Facts } from "@/features/queue/booking-line";
import type { QueueSection } from "@/features/queue/types";

import { QueueList, QueueRow, QueueSectionCard, relativeDays } from "../shared";

type Section = Extract<QueueSection, { key: "arrivals_to_record" }>;

export function ArrivalsToRecordSection({ section }: { section: Section }) {
  return (
    <QueueSectionCard sectionKey={section.key} title={section.title} count={section.count}>
      <QueueList
        items={section.items}
        getKey={(item) => item.booking.id}
        label="visits"
        render={(item) => (
          <QueueRow
            actions={
              <>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/day/${item.booking.visit_date}`}>
                    <ClipboardCheck data-icon="inline-start" />
                    Record arrivals
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/bookings/${item.booking.id}`}>
                    Open booking
                    <ArrowUpRight data-icon="inline-end" />
                  </Link>
                </Button>
              </>
            }
          >
            <BookingLine booking={item.booking} />
            <Facts
              items={[
                { label: "Visited", value: relativeDays(-item.days_ago), tone: item.days_ago > 3 ? "warning" : "default" },
                { label: "Barcode", value: item.barcode ? <span className="font-mono">{item.barcode}</span> : null },
              ]}
            />
          </QueueRow>
        )}
      />
    </QueueSectionCard>
  );
}
