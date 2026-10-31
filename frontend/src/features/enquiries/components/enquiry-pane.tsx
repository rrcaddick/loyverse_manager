/**
 * The reading pane: the enquiry's header with the five decisions across it,
 * then the conversation with the same reader and composer the booking's
 * Conversation tab uses, so Reply is the composer at the bottom.
 *
 * Decisions (agreed 26 Oct 2026): Convert (send the form again; the request
 * that comes back attaches itself), Create request (we fill the form for
 * them, prefilled from the mail, still through Accept), Attach to booking,
 * Resolve, Not an enquiry. Resolved ones offer Reopen.
 */

import { ArrowLeft, ArrowUpRight, Check, FileInput, Link2, Mail, RotateCcw, Send, XCircle } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { BookingFormDialog } from "@/features/bookings/components/booking-form-dialog";
import { BookingPicker } from "@/features/bookings/components/booking-picker";
import type { BookingInput } from "@/features/bookings/types";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useAttachEnquiry, useCreateRequest, useEnquiryAction, useEnquiryBooking, useEnquiryPrefill } from "../api";
import { ENQUIRY_STATUS_META, type Enquiry, type EnquiryPrefill } from "../types";
import { senderLabel, waitingLabel } from "../lib";

const ConversationView = lazy(() => import("@/features/mail/conversation-view").then((m) => ({ default: m.ConversationView })));

export interface EnquiryPaneProps {
  enquiry: Enquiry;
  /** Where to go once this one is dealt with (the next open row, or the list). */
  onDone: (enquiry: Enquiry) => void;
  /** Narrow screens: the pane is the whole page and offers a way back. */
  backTo?: string;
  className?: string;
}

export function EnquiryPane({ enquiry, onDone, backTo, className }: EnquiryPaneProps) {
  const navigate = useNavigate();
  const act = useEnquiryAction(enquiry.id);
  const attach = useAttachEnquiry(enquiry.id);
  const createRequest = useCreateRequest(enquiry.id);
  const [confirm, setConfirm] = useState<"convert" | "not_booking" | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const prefill = useEnquiryPrefill(enquiry.id, requestOpen);
  const booking = useEnquiryBooking(enquiry.booking_id);
  const meta = ENQUIRY_STATUS_META[enquiry.status];
  const open = enquiry.waiting;
  const busy = act.isPending || attach.isPending;

  async function run(action: "resolve" | "reopen" | "not-booking" | "convert", success: string) {
    try {
      await act.mutateAsync(action);
      toast.success(success);
      if (action !== "reopen") onDone(enquiry);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const header = (
    <header className="flex shrink-0 flex-col gap-3 border-b border-border pb-3">
      <div className="flex min-w-0 items-start gap-3">
        {backTo ? (
          <Button asChild variant="ghost" size="icon-sm" className="-ml-1 shrink-0" aria-label="Back to the list">
            <Link to={backTo}>
              <ArrowLeft />
            </Link>
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-section truncate text-foreground">{senderLabel(enquiry)}</h2>
            <StatusPill tone={meta.tone} label={meta.label} />
          </div>
          <p className="truncate text-body text-foreground">{enquiry.subject?.trim() || "(no subject)"}</p>
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground tabular">
            <span className="inline-flex items-center gap-1">
              <Mail aria-hidden="true" className="size-3.5" />
              {enquiry.sender_email}
            </span>
            <span>{pluralise(enquiry.message_count, "message")}</span>
            <span>{open ? `Waiting since ${formatDate(enquiry.last_inbound_at ?? enquiry.first_message_at ?? enquiry.created_at)}` : enquiry.resolved_at ? `Closed ${formatDateTime(enquiry.resolved_at)}` : `Last message ${waitingLabel(enquiry).toLowerCase()}`}</span>
            {enquiry.convert_sent_at ? <span>Form sent {formatDateTime(enquiry.convert_sent_at)}</span> : null}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {open ? (
          <>
            <Button size="sm" className="border-transparent bg-[#f59e0b] text-[#1f1a0a] hover:bg-[#d97706]" disabled={busy} onClick={() => setConfirm("convert")}>
              <Send data-icon="inline-start" />
              {enquiry.convert_sent_at ? "Send the form again" : "Send the form"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRequestOpen(true)}>
              <FileInput data-icon="inline-start" />
              Create request
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setAttachOpen(true)}>
              <Link2 data-icon="inline-start" />
              Attach to booking
            </Button>
            <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("resolve", "Enquiry resolved")}>
              <Check data-icon="inline-start" />
              Resolve
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => setConfirm("not_booking")}>
              <XCircle data-icon="inline-start" />
              Not an enquiry
            </Button>
          </>
        ) : enquiry.booking_id ? (
          <Button asChild size="sm">
            <Link to={`/bookings/${enquiry.booking_id}`}>
              Open booking {booking.data?.reference ?? ""}
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("reopen", "Enquiry reopened")}>
            <RotateCcw data-icon="inline-start" />
            Reopen
          </Button>
        )}
      </div>
    </header>
  );

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col gap-3", className)} aria-label={`Enquiry from ${senderLabel(enquiry)}`}>
      {header}
      {enquiry.gmail_thrid ? (
        <Suspense fallback={<PageSkeleton rows={6} />}>
          <ConversationView key={String(enquiry.gmail_thrid)} thrid={String(enquiry.gmail_thrid)} markDone="none" waitingStrip={false} className="min-h-0 flex-1" />
        </Suspense>
      ) : (
        <p className="text-sm text-muted-foreground">This enquiry has no conversation attached.</p>
      )}

      <ConfirmDialog
        open={confirm === "convert"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Send the booking form to ${enquiry.sender_email}?`}
        description="They get an email with a link to the request form. The request that comes back attaches itself to this conversation."
        confirmLabel="Send the form"
        onConfirm={async () => {
          await run("convert", `Form sent to ${enquiry.sender_email}`);
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "not_booking"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Not an enquiry?"
        description="The conversation goes back to Gmail and later replies in it stay out of the app. Nothing is remembered about the sender."
        confirmLabel="Not an enquiry"
        destructive
        onConfirm={async () => {
          await run("not-booking", "Marked as not an enquiry");
          setConfirm(null);
        }}
      />

      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Attach to a booking</DialogTitle>
            <DialogDescription>The conversation and its contacts join the booking you pick.</DialogDescription>
          </DialogHeader>
          <BookingPicker
            actionLabel="Attach"
            busy={attach.isPending}
            onPick={async (b) => {
              try {
                await attach.mutateAsync(b.id);
                toast.success(`Attached to ${b.reference}`);
                setAttachOpen(false);
                onDone(enquiry);
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          />
        </DialogContent>
      </Dialog>

      {requestOpen && prefill.isPending ? (
        <Dialog open onOpenChange={(o) => !o && setRequestOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create request</DialogTitle>
              <DialogDescription>Reading the conversation for the details…</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Spinner /> One moment
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <BookingFormDialog
          open={requestOpen && !prefill.isPending}
          onOpenChange={setRequestOpen}
          prefill={prefillToForm(enquiry, prefill.data)}
          extraInput={{ questions: prefill.data?.questions ?? undefined }}
          copy={{
            title: "Create request",
            description: "The form filled in for the customer from what they wrote. It still goes through Accept, which sends the proforma.",
            submit: "Create request",
          }}
          onCreate={async (input: BookingInput) => {
            const result = await createRequest.mutateAsync(input);
            return { id: result.booking_id } as never;
          }}
          onCreated={(created) => {
            toast.success("Request created from the enquiry");
            onDone(enquiry);
            navigate(`/bookings/${created.id}`);
          }}
        />
      )}
    </section>
  );
}

function prefillToForm(enquiry: Enquiry, data: EnquiryPrefill | undefined) {
  const people = data?.people_booked ?? ((data?.adults ?? 0) + (data?.children ?? 0) || undefined);
  return {
    group_name: data?.group_name ?? "",
    group_type: data?.group_type ?? "",
    area: data?.area ?? "",
    contact_name: data?.contact_name ?? enquiry.sender_name ?? "",
    contact_email: data?.contact_email ?? enquiry.sender_email,
    contact_mobile: data?.contact_mobile ?? "",
    visit_date: data?.visit_date ?? "",
    alternative_date: data?.alternative_date ?? "",
    visitors: people,
    customer_notes: data?.notes ?? "",
  };
}
