/**
 * A request (from the public form) is reviewed on the record itself: Accept
 * puts it on the calendar as an enquiry and, by default, sends the proforma
 * in the same step, the one automatic send in the system; Decline closes it
 * with a reason (owner's plan, 29 Oct 2026).
 */

import { Inbox } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { NextStepStrip } from "@/components/next-step-strip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { formatDateLong, pluralise } from "@/lib/format";

import { useAcceptRequest, useDeclineRequest } from "../../api";
import { relativeTo } from "../../lib";
import type { BookingDetail } from "../../types";

export function RequestBanner({ booking }: { booking: BookingDetail }) {
  const accept = useAcceptRequest(booking.id);
  const decline = useDeclineRequest(booking.id);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [sendProforma, setSendProforma] = useState(true);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <>
      <NextStepStrip
        urgency="blue"
        icon={Inbox}
        title="New request to review"
        detail={`${formatDateLong(booking.visit_date)} · ${relativeTo(booking.visit_date)} · ${pluralise(booking.people_booked, "visitor")} · ${booking.contact_name}. Accept puts it on the calendar and sends the proforma; Decline closes it.`}
        primary={<Button onClick={() => setAcceptOpen(true)}>Accept</Button>}
        secondary={
          <Button variant="ghost" onClick={() => setDeclineOpen(true)}>
            Decline
          </Button>
        }
      />
      <ConfirmDialog
        open={acceptOpen}
        onOpenChange={setAcceptOpen}
        title={`Accept ${booking.reference}?`}
        description="The booking goes on the calendar as pending and the hold starts."
        confirmLabel={sendProforma ? "Accept and send proforma" : "Accept"}
        onConfirm={async () => {
          try {
            const detail = await accept.mutateAsync({ send_proforma: sendProforma });
            const to = typeof detail.action_result?.to === "string" ? detail.action_result.to : null;
            toast.success(sendProforma && to ? `Accepted · proforma sent to ${to}` : "Request accepted");
            setAcceptOpen(false);
          } catch (err) {
            toast.error(errorMessage(err, "Could not accept the request"));
          }
        }}
      >
        <Label className="flex items-center gap-2 text-body">
          <Checkbox checked={sendProforma} onCheckedChange={(v) => setSendProforma(v === true)} />
          Send the proforma now{booking.contact_email ? ` to ${booking.contact_email}` : " (no email address on the request)"}
        </Label>
      </ConfirmDialog>
      <ConfirmDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        title={`Decline ${booking.reference}?`}
        description="The request is closed and leaves the calendar. The reason is kept on the record."
        confirmLabel="Decline request"
        destructive
        onConfirm={async () => {
          try {
            await decline.mutateAsync({ reason: reason.trim() || undefined });
            setDeclineOpen(false);
          } catch (err) {
            toast.error(errorMessage(err, "Could not decline the request"));
          }
        }}
      >
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. the day is full" />
      </ConfirmDialog>
    </>
  );
}
