/**
 * History (2 Nov 2026, history only since 6 Nov): what this group did
 * before, so we know what to expect this time. The numbers across the top,
 * one row per other booking, the questions they asked before. The group
 * itself (its aliases, everyone seen on it) lives on the group page; an
 * unlinked booking is linked from the Overview or Needs attention.
 */

import { History, MessageCircleQuestion } from "lucide-react";
import { Link } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";

import type { BookingDetail } from "../../types";
import { SummaryNumbers, VisitsTable } from "./history-parts";

export function HistoryTab({ booking }: { booking: BookingDetail }) {
  if (!booking.group) {
    return (
      <EmptyState
        variant="card"
        icon={History}
        title="No history until the booking is linked to a group"
        hint="Answer the group question on the Overview, or find the group there."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="?">Open the Overview</Link>
          </Button>
        }
      />
    );
  }
  const { visits, summary } = booking.history;
  const questions = visits.flatMap((v) => v.questions.map((q) => ({ ref: v.reference, q }))).slice(0, 8);
  return (
    <div className="flex flex-col gap-card-gap">
      {summary ? <SummaryNumbers summary={summary} /> : null}
      <VisitsTable visits={visits} />
      {questions.length > 0 ? (
        <Section
          title={
            <span className="inline-flex items-center gap-2">
              <MessageCircleQuestion aria-hidden="true" className="size-4 text-muted-foreground" />
              Questions they asked before
            </span>
          }
        >
          <ul className="flex flex-col gap-2 text-body">
            {questions.map((item, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 font-mono text-sm text-muted-foreground">{item.ref}</span>
                <span className="text-foreground">{item.q}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
