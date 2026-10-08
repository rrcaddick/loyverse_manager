/**
 * Context for the booking record's verbs (see components/booking-actions.tsx
 * for the provider that owns the dialogs).
 *
 *   const { run, openEdit, focusNote } = useBookingActions();
 */

import { createContext, useContext } from "react";

import type { BookingStatus } from "@/types/api";

import type { ActionId } from "./actions";
import type { EditFocus } from "./components/booking-form-dialog";
import type { StepVerb } from "./next-step";

export interface BookingActionsValue {
  run: (verb: StepVerb) => void;
  send: (action: ActionId) => void;
  openEdit: (focus?: EditFocus) => void;
  openPayment: () => void;
  openArrivals: () => void;
  openHold: () => void;
  changeStatus: (target: BookingStatus) => void;
  /** Focus the "Add a note…" composer (the N key). */
  focusNote: () => void;
  noteRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}

export const BookingActionsContext = createContext<BookingActionsValue | null>(null);

export function useBookingActions(): BookingActionsValue {
  const value = useContext(BookingActionsContext);
  if (!value) throw new Error("useBookingActions must be used inside BookingActionsProvider");
  return value;
}
