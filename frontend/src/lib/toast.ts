/**
 * Toast helpers over sonner.
 *
 *   toastWithUndo("R3 800 recorded on FY1698", { onUndo: () => unmatch.mutate(id) });
 *   toastWithUndo("Reminder dismissed", { description: "FY1737 · Sunshine Primary", onUndo });
 *
 * The undo toast stays ten seconds (spec §8) and closes itself when Undo is
 * pressed. `onUndo` may return a promise; failures are toasted by the
 * mutation cache as usual.
 */

import { toast } from "sonner";

export const UNDO_DURATION_MS = 10_000;

export interface UndoToastOptions {
  description?: string;
  onUndo: () => void | Promise<unknown>;
  /** Label for the action button. */
  undoLabel?: string;
  duration?: number;
}

export function toastWithUndo(message: string, { description, onUndo, undoLabel = "Undo", duration = UNDO_DURATION_MS }: UndoToastOptions) {
  return toast.success(message, {
    description,
    duration,
    action: {
      label: undoLabel,
      onClick: () => {
        void onUndo();
      },
    },
  });
}

/** A toast that offers a follow-up step ("Send payment confirmation"). */
export function toastWithAction(message: string, action: { label: string; onClick: () => void }, options: { description?: string; duration?: number } = {}) {
  return toast(message, { description: options.description, duration: options.duration ?? 8000, action });
}

export { toast };
