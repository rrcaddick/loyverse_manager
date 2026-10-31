import { useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra body content below the description (e.g. a summary list). */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible actions. */
  destructive?: boolean;
  /** Called on confirm; the dialog stays open and shows a spinner until it resolves. */
  onConfirm: () => void | Promise<unknown>;
}

/**
 * Confirmation step for anything that sends, deletes or changes state.
 * Keyboard: Escape cancels, Enter on the focused button confirms.
 *
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog open={open} onOpenChange={setOpen} title="Run mail sync?"
 *     confirmLabel="Run now" onConfirm={() => run.mutateAsync({ name: "sync-mail" })} />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm(event: React.MouseEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The mutation layer toasts; keep the dialog open so the user can retry.
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={busy}
            className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Imperative helper: returns [dialogElement, confirm()] for one-off prompts. */
export function useConfirm(props: Omit<ConfirmDialogProps, "open" | "onOpenChange">) {
  const [open, setOpen] = useState(false);
  const dialog = <ConfirmDialog open={open} onOpenChange={setOpen} {...props} />;
  return { dialog, confirm: () => setOpen(true), open, setOpen };
}
