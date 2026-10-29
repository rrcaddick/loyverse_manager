/**
 * /bookings/:id — the booking record (UI round two, owner's plan of 29 Oct
 * 2026). Header (group name, status, facts, one primary button, Edit, ⋯),
 * then seven tabs: Overview · Needs attention (with its count; a request
 * opens on it) · Conversation · Payments · Documents · Activity · Contacts.
 * Keys: E edit, N note (on Activity).
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
import { attentionCount } from "@/features/bookings/attention";
import { AttentionTab } from "@/features/bookings/components/record/attention";
import { ContactsTab } from "@/features/bookings/components/record/contacts-tab";
import { DocumentsTab } from "@/features/bookings/components/record/documents-tab";
import { OverviewTab } from "@/features/bookings/components/record/overview-tab";
import { PaymentsTab } from "@/features/bookings/components/record/payments-tab";
import { RecordHeader } from "@/features/bookings/components/record-header";
import type { BookingDetail } from "@/features/bookings/types";
import { useBookingActions } from "@/features/bookings/use-booking-actions";
import { useBookingConversation } from "@/features/mail/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShortcut } from "@/hooks/use-keyboard";
import { errorMessage, isApiError } from "@/lib/api";

const ConversationView = lazy(() => import("@/features/mail/conversation-view").then((m) => ({ default: m.ConversationView })));

const TABS = ["overview", "attention", "conversation", "payments", "documents", "activity", "contacts"] as const;
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
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : booking.status === "requested" ? "attention" : "overview";
  const attention = attentionCount(booking);
  const actions = useBookingActions();
  const conversation = useBookingConversation(booking.id);

  function setTab(next: Tab) {
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

  useShortcut("e", () => actions.openEdit());
  useShortcut("n", () => {
    if (tab !== "activity") setTab("activity");
    window.setTimeout(actions.focusNote, tab === "activity" ? 0 : 150);
  });

  return (
    <>
      <RecordHeader booking={booking} />

      <SegmentedTabs
        aria-label="Booking record tabs"
        variant="line"
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "Overview" },
          { value: "attention", label: "Needs attention", count: attention },
          { value: "conversation", label: "Conversation", count: conversation.data?.unanswered_count ?? 0 },
          { value: "payments", label: "Payments", count: booking.payments.length + booking.pops.length },
          { value: "documents", label: "Documents", count: booking.documents.length },
          { value: "activity", label: "Activity" },
          { value: "contacts", label: "Contacts", count: Math.max(booking.contacts.length, 1) },
        ]}
      />

      {tab === "overview" ? <OverviewTab booking={booking} onContacts={() => setTab("contacts")} /> : null}
      {tab === "attention" ? <AttentionTab booking={booking} onPayments={() => setTab("payments")} /> : null}
      {tab === "conversation" ? (
        <Suspense fallback={<PageSkeleton rows={6} />}>
          <ConversationView bookingId={booking.id} />
        </Suspense>
      ) : null}
      {tab === "payments" ? <PaymentsTab booking={booking} /> : null}
      {tab === "documents" ? <DocumentsTab booking={booking} /> : null}
      {tab === "activity" ? <Activity booking={booking} /> : null}
      {tab === "contacts" ? <ContactsTab booking={booking} /> : null}
    </>
  );
}
