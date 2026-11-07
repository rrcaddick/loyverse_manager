/**
 * Overview (owner's pass of 6 Nov 2026): Next steps across the top, the
 * Details fact sheet with the payments bar as the big card, and beside it
 * the Group with what it did before, the last message and the notes. The
 * contacts live in the header and the Contacts tab; the record's facts sit
 * as a footer line under Details.
 */

import { Users } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { formatDateShort, formatMoney, pluralise } from "@/lib/format";

import { useSetGroup } from "../../api";
import { groupQuestion } from "../../attention";
import { suggestionLabel, whyText } from "../../groups";
import { useGroupTypeLabel } from "../../lib";
import type { BookingDetail, HistorySummary } from "../../types";
import { QuestionsCard } from "../questions-card";
import { DetailsSheet } from "./details-sheet";
import { NextStepsCard } from "./next-steps-card";
import { LastMessageCard, NotesCard } from "./side-cards";

export function OverviewTab({ booking, unanswered = 0, onHistory, onConversation }: { booking: BookingDetail; unanswered?: number; onHistory: () => void; onConversation: () => void }) {
  return (
    <div className="flex flex-col gap-card-gap">
      <NextStepsCard booking={booking} />
      <div className="grid gap-card-gap xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-card-gap">
          <DetailsSheet booking={booking} />
          {booking.questions.length > 0 ? <QuestionsCard booking={booking} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-card-gap">
          <GroupCard booking={booking} onHistory={onHistory} />
          <LastMessageCard booking={booking} unanswered={unanswered} onConversation={onConversation} />
          <NotesCard booking={booking} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- group

/** The group this booking belongs to, what it did before in a few words, and the way to the group page. */
function GroupCard({ booking, onHistory }: { booking: BookingDetail; onHistory: () => void }) {
  const setGroup = useSetGroup(booking.id);
  const groupType = useGroupTypeLabel();
  const question = groupQuestion(booking);
  const upcoming = booking.history.visits.filter((v) => v.relation === "upcoming");
  const g = booking.group;
  async function answer(input: { group_id: number } | { new: true }) {
    try {
      await setGroup.mutateAsync(input);
      toast.success("new" in input ? "Started a new group" : "Linked to the group");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Users aria-hidden="true" className="size-4 text-muted-foreground" />
          Group
        </span>
      }
      actions={
        g ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/groups/${g.id}`}>Open group</Link>
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 text-body">
        {g ? (
          <p className="text-foreground">
            <span className="font-medium">{g.name}</span>
            <span className="text-muted-foreground">{[g.area, g.group_type ? groupType(g.group_type) : null, pluralise(g.bookings, "booking")].filter(Boolean).map((part) => ` · ${part}`)}</span>
          </p>
        ) : null}
        {question ? (
          <>
            <p className="text-foreground">
              Same group as <span className="font-medium">{suggestionLabel(question)}</span>?
            </p>
            <p className="text-sm text-muted-foreground">{whyText(question.why)}.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="min-w-24" disabled={setGroup.isPending} onClick={() => answer({ group_id: question.group_id })}>
                Yes
              </Button>
              <Button size="sm" variant="outline-primary" className="min-w-24" disabled={setGroup.isPending} onClick={() => answer({ new: true })}>
                New group
              </Button>
            </div>
          </>
        ) : !g ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">Not linked to a group yet.</span>
            <Button size="sm" variant="outline" disabled={setGroup.isPending} onClick={() => answer({ new: true })}>
              New group
            </Button>
          </div>
        ) : booking.history.summary && booking.history.summary.visits + booking.history.summary.cancellations > 0 ? (
          <HistoryStrip summary={booking.history.summary} onOpen={onHistory} />
        ) : (
          <p className="text-muted-foreground">
            First booking for this group.
            {upcoming.length > 0 ? ` Also booked: ${upcoming.map((v) => `${v.reference} on ${formatDateShort(v.visit_date ?? "")}`).join(", ")}.` : ""}
          </p>
        )}
      </div>
    </Section>
  );
}


/** "3 previous visits · arrivals −13% against booked · deposit on time 2 of 3 · R24 500 paid": the History tab in one line. */
function HistoryStrip({ summary: s, onOpen }: { summary: HistorySummary; onOpen: () => void }) {
  const parts: { text: string; tone?: "green" | "amber" | "red" }[] = [];
  parts.push({ text: `${pluralise(s.visits, "previous visit")}${s.first_year ? ` since ${s.first_year}` : ""}` });
  if (s.turnout_avg_pct !== null) {
    const delta = s.turnout_avg_pct - 100;
    parts.push({ text: `arrivals ${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)}% against booked`, tone: delta >= -5 ? "green" : delta >= -20 ? "amber" : "red" });
  }
  if (s.deposit_on_time) parts.push({ text: `deposit on time ${s.deposit_on_time.on_time} of ${s.deposit_on_time.of}`, tone: s.deposit_on_time.on_time === s.deposit_on_time.of ? "green" : s.deposit_on_time.on_time === 0 ? "red" : "amber" });
  if (s.cancellations > 0) parts.push({ text: pluralise(s.cancellations, "cancellation"), tone: "amber" });
  if (s.paid_total > 0) parts.push({ text: `${formatMoney(s.paid_total, { compact: true })} paid over the years` });
  return (
    <button type="button" onClick={onOpen} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-left text-sm">
      {parts.map((p, i) => (
        <span key={i} className={p.tone === "green" ? "text-green-text" : p.tone === "amber" ? "text-amber-text" : p.tone === "red" ? "text-red-text" : "text-foreground"}>
          {p.text}
          {i < parts.length - 1 ? <span aria-hidden="true" className="text-faint-foreground"> · </span> : null}
        </span>
      ))}
    </button>
  );
}
