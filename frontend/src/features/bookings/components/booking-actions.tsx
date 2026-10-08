/**
 * One place that owns every dialog on the booking record and runs a
 * StepVerb (features/bookings/next-step.ts). The header, the next-step
 * strip, the money card and the rail all call `useBookingActions().run(verb)`
 * so the same verb opens the same dialog wherever it is clicked.
 *
 *   const { run, openEdit, focusNote } = useBookingActions();
 *   run({ kind: "send", action: "send-proforma", label: "Send proforma" });
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import type { BookingStatus } from "@/types/api";

import type { ActionId } from "../actions";
import type { BookingDetail } from "../types";
import { BookingActionsContext, type BookingActionsValue } from "../use-booking-actions";
import { ArrivalsDialog } from "./arrivals-dialog";
import { BookingFormDialog, type EditFocus } from "./booking-form-dialog";
import { HoldDialog } from "./hold-dialog";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { SendDialog } from "./send-dialog";
import { StatusDialog } from "./status-dialog";

export function BookingActionsProvider({ booking, children }: { booking: BookingDetail; children: ReactNode }) {
  const [sending, setSending] = useState<ActionId | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editFocus, setEditFocus] = useState<EditFocus>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [arrivalsOpen, setArrivalsOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<BookingStatus | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  const openEdit = useCallback((focus: EditFocus = null) => {
    setEditFocus(focus);
    setEditOpen(true);
  }, []);
  const changeStatus = useCallback((target: BookingStatus) => {
    setStatusTarget(target);
    setStatusOpen(true);
  }, []);
  const focusNote = useCallback(() => {
    const el = noteRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus();
  }, []);

  const value = useMemo<BookingActionsValue>(
    () => ({
      run: (verb) => {
        switch (verb.kind) {
          case "send":
            setSending(verb.action);
            break;
          case "record-payment":
            setPaymentOpen(true);
            break;
          case "record-arrivals":
            setArrivalsOpen(true);
            break;
          case "edit":
            openEdit(verb.focus);
            break;
          case "status":
            changeStatus(verb.target);
            break;
          case "extend-hold":
            setHoldOpen(true);
            break;
        }
      },
      send: (action) => setSending(action),
      openEdit,
      openPayment: () => setPaymentOpen(true),
      openArrivals: () => setArrivalsOpen(true),
      openHold: () => setHoldOpen(true),
      changeStatus,
      focusNote,
      noteRef,
    }),
    [openEdit, changeStatus, focusNote],
  );

  return (
    <BookingActionsContext.Provider value={value}>
      {children}
      <SendDialog booking={booking} action={sending} onClose={() => setSending(null)} />
      <BookingFormDialog open={editOpen} onOpenChange={setEditOpen} booking={booking} focus={editFocus} />
      <RecordPaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} booking={booking} />
      <ArrivalsDialog open={arrivalsOpen} onOpenChange={setArrivalsOpen} booking={booking} />
      <HoldDialog booking={booking} open={holdOpen} onOpenChange={setHoldOpen} />
      <StatusDialog booking={booking} target={statusTarget} open={statusOpen} onOpenChange={setStatusOpen} />
    </BookingActionsContext.Provider>
  );
}
