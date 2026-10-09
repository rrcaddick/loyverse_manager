/**
 * /bookings/:id — the booking record (spec §6).
 *
 * Header (group name, status pill, facts line, one primary button, Edit, ⋯)
 * then two tabs: Booking — next-step strip, money ladder, questions (when
 * any), activity timeline, with the rail (details, contact, documents, hold
 * & reminders, internal note, record) beside it — and Conversation, which
 * mounts the Mail agent's ConversationView. Keys: E edit, N note.
 */

import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { Suspense, lazy } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBooking } from "@/features/bookings/api";
import { Activity } from "@/features/bookings/components/activity";
import { BookingActionsProvider } from "@/features/bookings/components/booking-actions";
import { useBookingActions } from "@/features/bookings/use-booking-actions";
import { MoneyCard } from "@/features/bookings/components/money-card";
import { QuestionsCard } from "@/features/bookings/components/questions-card";
import { Rail } from "@/features/bookings/components/rail";
import { NextStepCard, RecordHeader } from "@/features/bookings/components/record-header";
import type { BookingDetail } from "@/features/bookings/types";
import { useBookingConversation } from "@/features/mail/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShortcut } from "@/hooks/use-keyboard";
import { errorMessage, isApiError } from "@/lib/api";

const ConversationView = lazy(() => import("@/features/mail/conversation-view").then((m) => ({ default: m.ConversationView })));

type Tab = "booking" | "conversation";

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
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-80 max-w-full" />
          <Skeleton className="h-5 w-[32rem] max-w-full" />
        </div>
        <Skeleton className="h-14 w-full rounded-lg" />
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
            variant="page"
            icon={AlertCircle}
            title="There is no booking with this id"
            hint="It may have been removed, or the link is wrong."
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

  return (
    <BookingActionsProvider booking={booking.data}>
      <Record booking={booking.data} />
    </BookingActionsProvider>
  );
}

function Record({ booking }: { booking: BookingDetail }) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "conversation" ? "conversation" : "booking";
  const actions = useBookingActions();
  // v3: shares ["mail","booking-conversation",id] with the Conversation tab's ConversationView.
  const conversation = useBookingConversation(booking.id);

  useShortcut("e", () => actions.openEdit());
  useShortcut("n", () => {
    if (tab !== "booking") setTab("booking");
    window.setTimeout(actions.focusNote, tab === "booking" ? 0 : 150);
  });

  function setTab(next: Tab) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === "booking") p.delete("tab");
        else p.set("tab", next);
        return p;
      },
      { replace: true },
    );
  }

  return (
    <>
      <RecordHeader booking={booking} />

      <SegmentedTabs
        aria-label="Booking record tabs"
        variant="line"
        value={tab}
        onChange={setTab}
        items={[
          { value: "booking", label: "Booking" },
          // v3: the badge is what the person is still waiting on, not the email count.
          { value: "conversation", label: "Conversation", count: conversation.data?.unanswered_count ?? 0 },
        ]}
      />

      {tab === "booking" ? (
        <div className="grid gap-card-gap xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="flex min-w-0 flex-col gap-card-gap xl:col-start-1">
            <NextStepCard booking={booking} />
            <MoneyCard booking={booking} />
            {booking.questions.length > 0 ? <QuestionsCard booking={booking} /> : null}
          </div>
          {/* Phones: strip, money, rail accordions, then activity last (research note 04). */}
          <div className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1">
            <Rail booking={booking} />
          </div>
          <div className="min-w-0 xl:col-start-1">
            <Activity booking={booking} />
          </div>
        </div>
      ) : (
        <Suspense fallback={<PageSkeleton rows={6} />}>
          <ConversationView bookingId={booking.id} />
        </Suspense>
      )}
    </>
  );
}
