/**
 * Manual status change (POST /bookings/:id/status) with the reason the
 * event trail will show. Targets come from `allowed_transitions`.
 */

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusPill } from "@/components/status-pill";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { humanise } from "@/lib/format";
import type { BookingStatus } from "@/types/api";

import { STATUS_CHANGE_COPY, statusChangeNeedsReason } from "../actions";
import { useSetStatus } from "../api";
import type { BookingDetail } from "../types";

export interface StatusDialogProps {
  booking: BookingDetail;
  target: BookingStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StatusDialog(props: StatusDialogProps) {
  if (!props.target) return null;
  // A fresh instance per opening so the reason starts empty every time.
  return <StatusDialogInner key={`${props.target}-${props.open ? "open" : "closed"}`} {...props} target={props.target} />;
}

function StatusDialogInner({ booking, target, open, onOpenChange }: StatusDialogProps & { target: BookingStatus }) {
  const setStatus = useSetStatus(booking.id);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const copy = STATUS_CHANGE_COPY[target] ?? { label: `Mark ${humanise(target).toLowerCase()}`, description: "" };
  const required = statusChangeNeedsReason(target);
  const missing = required && !reason.trim();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${copy.label}?`}
      description={copy.description}
      confirmLabel={copy.label}
      destructive={copy.destructive}
      onConfirm={async () => {
        if (missing) {
          setTouched(true);
          throw new Error("reason required");
        }
        await setStatus.mutateAsync({ status: target, reason: reason.trim() || undefined });
        toast.success(`${booking.reference} is now ${humanise(target).toLowerCase()}`);
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-body">
          <StatusPill status={booking.status} />
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <StatusPill status={target} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status-reason">
            Reason{required ? "" : <span className="font-normal text-muted-foreground"> (optional)</span>}
          </Label>
          <Textarea
            id="status-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={touched && missing ? true : undefined}
            aria-describedby={touched && missing ? "status-reason-error" : undefined}
            placeholder={target === "cancelled" ? "e.g. customer phoned to cancel" : undefined}
          />
          {touched && missing ? (
            <p id="status-reason-error" role="alert" className="text-sm text-red-text">
              Give a reason — it is recorded on the booking.
            </p>
          ) : null}
        </div>
      </div>
    </ConfirmDialog>
  );
}
