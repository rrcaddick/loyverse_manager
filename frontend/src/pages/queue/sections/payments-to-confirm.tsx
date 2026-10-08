import { ArrowUpRight, Check } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Facts } from "@/features/queue/booking-line";
import type { PaymentToConfirmItem, QueueSection } from "@/features/queue/types";
import { ConfirmSuggestionDialog } from "@/features/payments/dialogs";
import { SuggestionPicker } from "@/features/payments/suggestion-picker";
import type { BankSuggestion } from "@/features/payments/types";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { formatDate, formatDateTime, formatMoney, formatRelativeDay } from "@/lib/format";

import { QueueList, QueueRow, QueueSectionCard } from "../shared";

type Section = Extract<QueueSection, { key: "payments_to_confirm" }>;

export function PaymentsToConfirmSection({ section }: { section: Section }) {
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Record<number, number>>({});
  const confirming = useSubjectDialog<{ tx: PaymentToConfirmItem; suggestion: BankSuggestion }>();

  function selectedFor(tx: PaymentToConfirmItem): BankSuggestion | null {
    const id = picked[tx.id] ?? tx.suggestions[0]?.booking_id;
    return tx.suggestions.find((s) => s.booking_id === id) ?? null;
  }

  return (
    <QueueSectionCard sectionKey={section.key} title={section.title} count={section.count}>
      <QueueList
        items={section.items}
        getKey={(tx) => tx.id}
        label="credits"
        limit={4}
        render={(tx) => {
          const selected = selectedFor(tx);
          return (
            <QueueRow
              actions={
                <>
                  <Button size="sm" disabled={!selected} onClick={() => selected && confirming.show({ tx, suggestion: selected })}>
                    <Check data-icon="inline-start" />
                    Confirm match
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/payments?tx=${tx.id}`)}>
                    More
                    <ArrowUpRight data-icon="inline-end" />
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
              <SuggestionPicker
                suggestions={tx.suggestions}
                selectedId={selected?.booking_id ?? null}
                onSelect={(bookingId) => setPicked((p) => ({ ...p, [tx.id]: bookingId }))}
                amount={tx.amount}
                label={`Suggested bookings for ${formatMoney(tx.amount)} ${tx.description}`}
              />
            </QueueRow>
          );
        }}
      />
      <ConfirmSuggestionDialog
        tx={confirming.subject?.tx ?? null}
        suggestion={confirming.subject?.suggestion ?? null}
        open={confirming.open}
        onOpenChange={confirming.onOpenChange}
      />
    </QueueSectionCard>
  );
}
