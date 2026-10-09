/**
 * The dispatcher behind every Work verb (docs/handoff/work-today.md, action
 * vocabulary). Pages call `run(action, row, input)`; navigation verbs go
 * straight to a route, sends open a confirmation that names the recipient,
 * and the rest fire at once. A finished row leaves its list immediately
 * (`removeWorkRow`) and the refetch confirms; a bank match gets an undo toast.
 *
 *   const work = useWorkActions();
 *   <WorkRow row={row} onAction={work.run} busy={work.busyRow === row.id} />
 *   {work.dialogs}
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import type { BookingDetail } from "@/features/bookings/types";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { toast, toastWithAction, toastWithUndo } from "@/lib/toast";

import { removeWorkRow, useDismissReminders, useExtendHold, useIgnoreCredit, useMatchCredit, useSetBookingStatus, useUnmatchCredit, useWorkBookingAction } from "./api";
import { BookingActionDialog, SetStatusDialog } from "./components/action-dialogs";
import type { ActionInput } from "./components/work-row";
import { fixedIgnoreReason, type BookingActionAction, type MatchTransactionAction, type SendReminderAction, type SetStatusAction, type WorkAction, type WorkRow } from "./types";

export interface WorkActions {
  run: (action: WorkAction, row: WorkRow, input?: ActionInput) => void;
  /** Mount once near the list. */
  dialogs: ReactNode;
  /** The row whose action is in flight. */
  busyRow: string | null;
}

export function useWorkActions(): WorkActions {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const match = useMatchCredit();
  const unmatch = useUnmatchCredit();
  const ignore = useIgnoreCredit();
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

  async function doMatch(action: MatchTransactionAction, row: WorkRow) {
    const result = await guarded(row, () => match.mutateAsync({ tx_id: action.tx_id, booking_id: action.booking_id }));
    removeWorkRow(qc, row.id);
    const amount = result.payment?.amount ?? row.amount;
    const reference = row.booking?.reference ?? "the booking";
    toastWithUndo(`${formatMoney(amount, { compact: true })} recorded on ${reference}`, {
      description: row.booking?.group_name,
      onUndo: () => unmatch.mutateAsync(action.tx_id),
    });
    // Offer the follow-up when the deposit is now covered (spec §8).
    try {
      const detail = await qc.fetchQuery({ queryKey: ["bookings", action.booking_id], queryFn: () => api.get<BookingDetail>(`/bookings/${action.booking_id}`) });
      if (detail.finance.deposit_covered && detail.contact_email) {
        toastWithAction(`Deposit covered on ${detail.reference}`, {
          label: "Send payment confirmation",
          onClick: () =>
            confirmSend.show({
              action: { action: "booking_action", verb: "Send payment confirmation", booking_id: detail.id, name: "send-payment-confirmation" },
              row,
            }),
        });
      }
    } catch {
      // The match succeeded; the offer is optional.
    }
  }

  function run(action: WorkAction, row: WorkRow, input?: ActionInput) {
    switch (action.action) {
      case "open_conversation":
        // v3: a reply row is a person; Mail opens every conversation with them.
        navigate(action.party_key ? `/mail?party=${encodeURIComponent(action.party_key)}` : `/mail/${action.thrid}`);
        return;
      case "open_booking":
        navigate(`/bookings/${action.booking_id}`);
        return;
      case "open_transaction":
        navigate(`/bank?tx=${action.tx_id}`);
        return;
      case "open_day":
        navigate(`/today/${action.date}`);
        return;
      case "booking_action":
      case "send_reminder":
        confirmSend.show({ action, row });
        return;
      case "set_status":
        confirmStatus.show({ action, row });
        return;
      case "match_transaction":
        void doMatch(action, row);
        return;
      case "ignore_transaction": {
        const chosen = input?.ignore ?? fixedIgnoreReason(action.reason);
        if (!chosen) return;
        void guarded(row, () => ignore.mutateAsync({ tx_id: action.tx_id, ...chosen })).then(() => done(row, "Credit ignored", row.title));
        return;
      }
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
          done(row, `Hold on ${row.booking?.reference ?? "the booking"} extended to ${formatDate(date)}`, row.booking?.group_name),
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

  return { run, dialogs, busyRow };
}
