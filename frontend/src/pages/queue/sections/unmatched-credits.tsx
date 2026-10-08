import { ArrowUpRight, EyeOff, Link2 } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Facts } from "@/features/queue/booking-line";
import type { CreditItem, QueueSection } from "@/features/queue/types";
import { IgnoreDialog, MatchBookingDialog } from "@/features/payments/dialogs";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { formatDate, formatDateTime, formatMoney, formatRelativeDay } from "@/lib/format";

import { QueueList, QueueRow, QueueSectionCard } from "../shared";

type Section = Extract<QueueSection, { key: "unmatched_credits" }>;

export function UnmatchedCreditsSection({ section }: { section: Section }) {
  const matching = useSubjectDialog<CreditItem>();
  const ignoring = useSubjectDialog<CreditItem>();
  const total = section.items.reduce((sum, tx) => sum + tx.amount, 0);

  return (
    <QueueSectionCard
      sectionKey={section.key}
      title={section.title}
      count={section.count}
      actions={
        <>
          <span className="text-sm text-muted-foreground tabular">{formatMoney(total)} in total</span>
          <Button asChild variant="ghost" size="sm">
            <Link to="/payments?status=unmatched&type=credit">
              All credits
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </>
      }
    >
      <QueueList
        items={section.items}
        getKey={(tx) => tx.id}
        label="credits"
        render={(tx) => (
          <QueueRow
            actions={
              <>
                <Button variant="outline" size="sm" onClick={() => matching.show(tx)}>
                  <Link2 data-icon="inline-start" />
                  Match…
                </Button>
                <Button variant="ghost" size="sm" onClick={() => ignoring.show(tx)}>
                  <EyeOff data-icon="inline-start" />
                  Ignore
                </Button>
              </>
            }
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-lg font-semibold text-primary tabular">{formatMoney(tx.amount)}</span>
              <span className="min-w-0 truncate font-medium text-foreground">{tx.description}</span>
            </div>
            <Facts
              items={[
                { label: "Dated", value: formatDate(tx.booking_date) },
                { label: "Seen", value: formatRelativeDay(tx.first_seen_at), title: formatDateTime(tx.first_seen_at) },
              ]}
            />
          </QueueRow>
        )}
      />
      <MatchBookingDialog tx={matching.subject} open={matching.open} onOpenChange={matching.onOpenChange} />
      <IgnoreDialog tx={ignoring.subject} open={ignoring.open} onOpenChange={ignoring.onOpenChange} />
    </QueueSectionCard>
  );
}
