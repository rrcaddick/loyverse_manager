/**
 * /bookings/:id — the heart of the system. Header, action bar, then tabs
 * (?tab=overview|timeline|emails|documents|payments|questions).
 */

import { AlertCircle, ArrowLeft, CalendarDays, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBooking } from "@/features/bookings/api";
import { ActionBar, SendDialog } from "@/features/bookings/components/action-bar";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import { DocumentsTab } from "@/features/bookings/components/documents-tab";
import { EmailsTab } from "@/features/bookings/components/emails-tab";
import { OverviewTab } from "@/features/bookings/components/overview-tab";
import { PaymentsTab } from "@/features/bookings/components/payments-tab";
import { QuestionsTab } from "@/features/bookings/components/questions-tab";
import { TimelineTab } from "@/features/bookings/components/timeline-tab";
import { relativeDayLabel, useGroupTypeLabel } from "@/features/bookings/lib";
import { ContactChips, HoldExpiryNotice, ProvenanceBadge } from "@/features/bookings/shared";
import type { BookingDetail } from "@/features/bookings/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage, isApiError } from "@/lib/api";
import { formatDateLong, formatNumber, pluralise } from "@/lib/format";

const TABS = ["overview", "timeline", "emails", "documents", "payments", "questions"] as const;
type Tab = (typeof TABS)[number];

export default function BookingDetailPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = Number(raw);
  const valid = Number.isInteger(id) && id > 0;
  const booking = useBooking(valid ? id : null);
  useDocumentTitle(booking.data ? `${booking.data.reference} · ${booking.data.group_name}` : "Booking");

  if (!valid) return <Navigate to="/bookings" replace />;

  if (booking.isPending) {
    return (
      <>
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-80 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <PageSkeleton rows={8} />
      </>
    );
  }

  if (booking.isError) {
    const notFound = isApiError(booking.error) && booking.error.status === 404;
    return (
      <>
        <PageHeader title={notFound ? "Booking not found" : "Booking"} />
        {notFound ? (
          <EmptyState
            icon={AlertCircle}
            title="There is no booking with this id"
            description="It may have been removed, or the link is wrong."
            action={
              <Button asChild variant="outline">
                <Link to="/bookings">
                  <ArrowLeft data-icon="inline-start" />
                  Back to bookings
                </Link>
              </Button>
            }
          />
        ) : (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Could not load the booking</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{errorMessage(booking.error)}</span>
              <Button variant="outline" size="sm" onClick={() => booking.refetch()}>
                <RefreshCw data-icon="inline-start" />
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  return <Detail booking={booking.data} />;
}

function Detail({ booking }: { booking: BookingDetail }) {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";
  const [editOpen, setEditOpen] = useState(false);
  const groupType = useGroupTypeLabel();
  const [answersOpen, setAnswersOpen] = useState(false);

  function setTab(next: string) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === "overview") p.delete("tab");
        else p.set("tab", next);
        return p;
      },
      { replace: true },
    );
  }

  const counts: Record<Tab, number | null> = {
    overview: null,
    timeline: booking.events.length + booking.emails.length,
    emails: booking.emails.length,
    documents: booking.documents.length,
    payments: booking.payments.length,
    questions: booking.questions.length,
  };
  const unanswered = booking.questions.filter((q) => !q.answer).length;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{booking.reference}</span>
            <ProvenanceBadge source={booking.source} className="normal-case tracking-normal" />
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{booking.group_name}</span>
            <StatusBadge status={booking.status} className="h-6 px-2 text-sm" />
          </span>
        }
        description={
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Link to={`/day/${booking.visit_date}`} className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-3 hover:underline">
                <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
                {formatDateLong(booking.visit_date)}
              </Link>
              {relativeDayLabel(booking.visit_date) ? <span className="text-muted-foreground">· {relativeDayLabel(booking.visit_date)}</span> : null}
              <span className="text-muted-foreground" aria-hidden="true">
                ·
              </span>
              <span className="tabular">{pluralise(booking.people_booked, "person", "people")}</span>
              {booking.group_type ? (
                <>
                  <span className="text-muted-foreground" aria-hidden="true">
                    ·
                  </span>
                  <span>{groupType(booking.group_type)}</span>
                </>
              ) : null}
              {booking.arrived_count !== null ? (
                <>
                  <span className="text-muted-foreground" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-primary tabular">{formatNumber(booking.arrived_count)} arrived</span>
                </>
              ) : null}
              <HoldExpiryNotice booking={booking} />
            </div>
            <ContactChips booking={booking} />
          </div>
        }
      />

      <ActionBar booking={booking} onEdit={() => setEditOpen(true)} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="-mb-px h-auto w-full justify-start overflow-x-auto border-b border-border pb-px">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="h-9 flex-none gap-1.5 px-3 capitalize">
              {t}
              {counts[t] !== null && counts[t]! > 0 ? (
                <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular">{formatNumber(counts[t]!)}</span>
              ) : null}
              {t === "questions" && unanswered > 0 ? <span className="size-1.5 rounded-full bg-warning" aria-label={`${unanswered} unanswered`} /> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div key={tab}>
        {tab === "overview" ? <OverviewTab booking={booking} onEdit={() => setEditOpen(true)} /> : null}
        {tab === "timeline" ? <TimelineTab booking={booking} /> : null}
        {tab === "emails" ? <EmailsTab booking={booking} /> : null}
        {tab === "documents" ? <DocumentsTab booking={booking} /> : null}
        {tab === "payments" ? <PaymentsTab booking={booking} /> : null}
        {tab === "questions" ? (
          <QuestionsTab booking={booking} onSendAnswers={() => setAnswersOpen(true)} />
        ) : null}
      </div>

      <BookingFormDialog open={editOpen} onOpenChange={setEditOpen} booking={booking} />
      <SendDialog booking={booking} action={answersOpen ? "send-answers" : null} onClose={() => setAnswersOpen(false)} />
    </>
  );
}
