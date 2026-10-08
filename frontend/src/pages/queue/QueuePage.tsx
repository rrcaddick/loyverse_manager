/**
 * The admin home: GET /queue rendered as a prioritised worklist. Sections keep
 * the server's order; non-empty ones are cards with the right action per row,
 * empty ones collapse to one quiet line each.
 */

import { AlertCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueue } from "@/features/queue/api";
import type { QueueResponse, QueueSection } from "@/features/queue/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/lib/api";
import { formatDateLong, formatNumber, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ArrivalsToRecordSection } from "./sections/arrivals-to-record";
import { LapsingSection } from "./sections/lapsing";
import { NeedsReplySection } from "./sections/needs-reply";
import { NewRequestsSection } from "./sections/new-requests";
import { PaymentsToConfirmSection } from "./sections/payments-to-confirm";
import { RemindersDueSection } from "./sections/reminders-due";
import { TicketsToSendSection } from "./sections/tickets-to-send";
import { UnmatchedCreditsSection } from "./sections/unmatched-credits";
import { UnmatchedEmailsSection } from "./sections/unmatched-emails";
import { VisitsThisWeekSection } from "./sections/visits-this-week";
import { EmptySectionLine } from "./shared";

export default function QueuePage() {
  useDocumentTitle("Queue");
  const queue = useQueue();
  const data = queue.data;

  return (
    <>
      <PageHeader
        eyebrow={data ? formatDateLong(data.today) : <Skeleton className="h-3.5 w-48" />}
        title="Queue"
        description="Everything that needs a decision, in the order it matters. Work from the top down; each row carries the one action that moves it on."
        actions={
          <div className="flex items-center gap-3">
            {data ? (
              <span className="hidden text-xs text-muted-foreground tabular sm:inline" aria-live="polite">
                Updated {formatTime(data.generated_at)}
              </span>
            ) : null}
            <Button variant="outline" onClick={() => void queue.refetch()} disabled={queue.isFetching} aria-label="Refresh the queue">
              <RefreshCw data-icon="inline-start" className={cn(queue.isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      >
        {data ? <SummaryStrip queue={data} /> : queue.isPending ? <SummaryStripSkeleton /> : null}
      </PageHeader>

      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>The queue could not be loaded</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(queue.error)}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void queue.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : data ? (
        <QueueSections queue={data} />
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------- summary

function SummaryStrip({ queue }: { queue: QueueResponse }) {
  const open = queue.sections.filter((s) => s.count > 0).length;
  return (
    <nav aria-label="Queue sections" className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-10">
        {queue.sections.map((section) => {
          const empty = section.count === 0;
          return (
            <li key={section.key}>
              <a
                href={`#queue-${section.key}`}
                onClick={(event) => {
                  const target = document.getElementById(`queue-${section.key}`);
                  if (!target) return;
                  event.preventDefault();
                  target.scrollIntoView({ behavior: "smooth", block: "start" });
                  target.focus({ preventScroll: true });
                }}
                aria-label={`${section.title}: ${formatNumber(section.count)}`}
                className={cn(
                  "flex h-full flex-col gap-1 rounded-lg border px-3 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                  empty ? "border-transparent bg-muted/40 text-muted-foreground" : "border-border bg-card hover:bg-muted/60",
                )}
              >
                <span className={cn("text-xl font-semibold leading-none", empty ? "text-muted-foreground" : "text-foreground")}>{formatNumber(section.count)}</span>
                <span className="text-xs leading-tight text-muted-foreground">{section.title}</span>
              </a>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground tabular">
        {queue.total === 0 ? "Nothing is waiting." : `${formatNumber(queue.total)} items across ${formatNumber(open)} ${open === 1 ? "section" : "sections"}.`}
      </p>
    </nav>
  );
}

function SummaryStripSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-10" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- sections

function renderSection(section: QueueSection, today: string): ReactNode {
  switch (section.key) {
    case "needs_reply":
      return <NeedsReplySection section={section} today={today} />;
    case "unmatched_emails":
      return <UnmatchedEmailsSection section={section} />;
    case "new_requests":
      return <NewRequestsSection section={section} />;
    case "payments_to_confirm":
      return <PaymentsToConfirmSection section={section} />;
    case "unmatched_credits":
      return <UnmatchedCreditsSection section={section} />;
    case "reminders_due":
      return <RemindersDueSection section={section} />;
    case "tickets_to_send":
      return <TicketsToSendSection section={section} />;
    case "visits_this_week":
      return <VisitsThisWeekSection section={section} />;
    case "arrivals_to_record":
      return <ArrivalsToRecordSection section={section} />;
    case "lapsing":
      return <LapsingSection section={section} />;
  }
}

/** Non-empty sections become cards; runs of empty ones share one quiet block. */
function QueueSections({ queue }: { queue: QueueResponse }) {
  if (queue.total === 0) {
    return (
      <EmptyState
        title="All clear"
        description="Nothing needs a decision right now. New emails, payments and reminders appear here as they arrive."
        action={
          <ul className="flex flex-col gap-1 text-left">
            {queue.sections.map((s) => (
              <EmptySectionLine key={s.key} sectionKey={s.key} title={s.title} />
            ))}
          </ul>
        }
      />
    );
  }

  const blocks: ReactNode[] = [];
  let emptyRun: QueueSection[] = [];
  const flush = () => {
    if (emptyRun.length === 0) return;
    blocks.push(
      <div key={`empty-${emptyRun.map((s) => s.key).join("-")}`} className="divide-y divide-border rounded-xl border border-dashed border-border px-2 py-1">
        {emptyRun.map((s) => (
          <EmptySectionLine key={s.key} sectionKey={s.key} title={s.title} />
        ))}
      </div>,
    );
    emptyRun = [];
  };
  for (const section of queue.sections) {
    if (section.count === 0) {
      emptyRun.push(section);
      continue;
    }
    flush();
    blocks.push(<div key={section.key}>{renderSection(section, queue.today)}</div>);
  }
  flush();
  return <div className="flex flex-col gap-6">{blocks}</div>;
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, r) => (
              <div key={r} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:justify-between">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3.5 w-1/2" />
                </div>
                <Skeleton className="h-7 w-28 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
