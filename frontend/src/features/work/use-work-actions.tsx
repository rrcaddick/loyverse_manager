/**
 * The dispatcher behind every Work verb (docs/handoff/work-today.md, action
 * vocabulary). Pages call `run(action, row, input)`; navigation verbs go
 * straight to a route, sends open a confirmation that names the recipient,
 * and the rest fire at once. A finished row leaves its list immediately
 * (`removeWorkRow`) and the refetch confirms.
 *
 *   const work = useWorkActions();
 *   <WorkRow row={row} onAction={work.run} busy={work.busyRow === row.id} />
 *   {work.dialogs}
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";

import { removeWorkRow, useDismissReminders, useExtendHold, useSetBookingStatus, useWorkBookingAction } from "./api";
import { BookingActionDialog, SetStatusDialog } from "./components/action-dialogs";
import type { ActionInput } from "./components/work-row";
import { destinationFor } from "./lib";
import type { BookingActionAction, SendReminderAction, SetStatusAction, WorkAction, WorkRow } from "./types";

export interface WorkActions {
  run: (action: WorkAction, row: WorkRow, input?: ActionInput) => void;
  /** Open the booking or enquiry the row is about. */
  open: (row: WorkRow) => void;
  /** Mount once near the list. */
  dialogs: ReactNode;
  /** The row whose action is in flight. */
  busyRow: string | null;
}

export function useWorkActions(): WorkActions {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const dismiss = useDismissReminders();
  const extend = useExtendHold();
  const bookingAction = useWorkBookingAction();
  const setStatus = useSetBookingStatus();
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const confirmSend = useSubjectDialog<{ action: BookingActionAction | SendReminderAction; row: WorkRow }>();
  const confirmStatus = useSubjectDialog<{ action: SetStatusAction; row: WorkRow }>();

  async function guarded<T>(row: WorkRow, work: () => Promise<T>): Promise<T> {
    setBusyRow(row.id);
    try {
      return await work();
    } finally {
      setBusyRow((current) => (current === row.id ? null : current));
    }
  }

  function done(row: WorkRow, message: string, description?: string) {
    removeWorkRow(qc, row.id);
    toast.success(message, { description });
  }

  function open(row: WorkRow) {
    const to = destinationFor(row);
    if (to) navigate(to);
  }

  function run(action: WorkAction, row: WorkRow, input?: ActionInput) {
    switch (action.action) {
      case "open_conversation":
        // A reply row is a person: their booking's conversation, or the enquiries that address is on.
        if (action.party_key?.startsWith("e:")) navigate(`/enquiries?q=${encodeURIComponent(action.party_key.slice(2))}`);
        else navigate(`/bookings/${action.booking_id}?tab=conversation`);
        return;
      case "open_booking":
        navigate(action.tab ? `/bookings/${action.booking_id}?tab=${action.tab}` : `/bookings/${action.booking_id}`);
        return;
      case "open_enquiry":
        navigate(action.tab ? `/enquiries/${action.enquiry_id}?tab=${action.tab}` : `/enquiries/${action.enquiry_id}`);
        return;
      case "assign_message":
        void guarded(row, () => api.post(`/inbound/messages/${action.message_id}/assign`, { booking_id: action.booking_id })).then(() => {
          void qc.invalidateQueries({ queryKey: ["bookings"] });
          done(row, "Mail assigned", row.title);
        });
        return;
      case "booking_action":
      case "send_reminder":
        confirmSend.show({ action, row });
        return;
      case "set_status":
        confirmStatus.show({ action, row });
        return;
      case "dismiss_reminders": {
        const count = action.ids.length;
        void guarded(row, () => dismiss.mutateAsync({ ids: action.ids })).then(() =>
          done(row, count > 1 ? `${count} reminders dismissed` : "Reminder dismissed", row.booking ? `${row.booking.reference} · ${row.booking.group_name}` : undefined),
        );
        return;
      }
      case "extend_hold": {
        const date = input?.date;
        if (!date) return;
        void guarded(row, () => extend.mutateAsync({ booking_id: action.booking_id, hold_expires_on: date })).then(() =>
          done(row, `${row.booking?.reference ?? "The booking"} now expires on ${formatDate(date)}`, row.booking?.group_name),
        );
        return;
      }
    }
  }

  async function onConfirmSend() {
    const subject = confirmSend.subject;
    if (!subject) return;
    const { action, row } = subject;
    const name = action.action === "send_reminder" ? "send-reminder" : action.name;
    const body: Record<string, unknown> = {};
    if (action.action === "send_reminder") body.kind = action.kind;
    else {
      for (const [key, value] of Object.entries(action)) {
        if (!["action", "verb", "booking_id", "name"].includes(key) && value !== undefined) body[key] = value;
      }
    }
    const detail = await guarded(row, () => bookingAction.mutateAsync({ booking_id: action.booking_id, name, body }));
    const to = typeof detail.action_result?.to === "string" ? detail.action_result.to : null;
    done(row, `${action.verb} · ${detail.reference}`, to ? `Sent to ${to}` : detail.group_name);
  }

  async function onConfirmStatus() {
    const subject = confirmStatus.subject;
    if (!subject) return;
    const { action, row } = subject;
    const detail = await guarded(row, () => setStatus.mutateAsync({ booking_id: action.booking_id, status: action.status }));
    done(row, `${detail.reference} marked ${detail.status_label.toLowerCase()}`, detail.group_name);
  }

  const dialogs = (
    <>
      {confirmSend.subject ? <BookingActionDialog open={confirmSend.open} onOpenChange={confirmSend.onOpenChange} subject={confirmSend.subject} onConfirm={onConfirmSend} /> : null}
      {confirmStatus.subject ? <SetStatusDialog open={confirmStatus.open} onOpenChange={confirmStatus.onOpenChange} subject={confirmStatus.subject} onConfirm={onConfirmStatus} /> : null}
    </>
  );

  return { run, open, dialogs, busyRow };
}
