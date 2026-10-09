/**
 * "Not a booking" (v3): marks every conversation from this sender not a
 * booking and done, and — with the checkbox on, the default — teaches the
 * ignored-sender list so their future mail never reaches a queue. The
 * server picks the pattern: the address, or the whole domain when it is
 * not a public mailbox provider. The toast quotes the rule it made and its
 * Undo deletes that rule again (and reopens the conversations).
 *
 *   <NotBookingDialog open={open} onOpenChange={setOpen} thread={thread} partyKey={partyKey} onDone={openNext} />
 */

import { useId, useState } from "react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { toastWithUndo } from "@/lib/toast";

import { useDeleteIgnoredSender, useNotBooking, usePartyReopen, useReopen } from "./api";
import { domainPattern, threadName } from "./lib";
import type { IgnoredSender, Thread } from "./types";

export interface NotBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The thread the action is taken from (the sender's newest when a party is open). */
  thread: Pick<Thread, "thrid" | "counterpart_name" | "counterpart_email" | "subject"> | null;
  /** When a party is open, Undo reopens the whole person rather than one thread. */
  partyKey?: string | null;
  /** Called after the mark succeeds (the page moves to the next row). */
  onDone?: () => void;
}

export function NotBookingDialog({ open, onOpenChange, thread, partyKey, onDone }: NotBookingDialogProps) {
  const notBooking = useNotBooking();
  const busy = notBooking.isPending;
  if (!thread) return null;
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      {/* The body mounts with the dialog, so every opening starts with the checkbox on. */}
      <AlertDialogContent>
        <NotBookingBody thread={thread} partyKey={partyKey} onOpenChange={onOpenChange} onDone={onDone} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function NotBookingBody({ thread, partyKey, onOpenChange, onDone }: Omit<NotBookingDialogProps, "open" | "thread"> & { thread: NonNullable<NotBookingDialogProps["thread"]> }) {
  const [learn, setLearn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = useId();
  const notBooking = useNotBooking();
  const reopenThread = useReopen();
  const reopenParty = usePartyReopen();
  const deleteRule = useDeleteIgnoredSender();
  const busy = notBooking.isPending;
  const name = threadName(thread);
  const email = thread.counterpart_email;
  const domain = domainPattern(email);

  async function confirm(event: React.MouseEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await notBooking.mutateAsync({ thrid: thread.thrid, body: { learn } });
      const rule: IgnoredSender | null = result.rule ?? null;
      onOpenChange(false);
      toastWithUndo("Marked as not a booking", {
        description: rule ? `Future mail from ${rule.pattern} is ignored` : `${name} leaves every queue`,
        onUndo: async () => {
          if (rule) await deleteRule.mutateAsync(rule.id);
          if (partyKey) await reopenParty.mutateAsync({ partyKey });
          else await reopenThread.mutateAsync({ thrid: thread.thrid });
        },
      });
      onDone?.();
    } catch (err) {
      setError(errorMessage(err, "Could not mark this"));
    }
  }

  return (
    <>
        <AlertDialogHeader>
          <AlertDialogTitle>Not a booking?</AlertDialogTitle>
          <AlertDialogDescription>
            Every conversation from <span className="font-medium text-foreground">{name}</span>
            {email && email !== name ? <> ({email})</> : null} is marked not a booking and leaves the queues. Nothing is sent.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-3 rounded-lg bg-nested px-3 py-2.5">
          <Checkbox id={checkboxId} checked={learn} onCheckedChange={(v) => setLearn(v === true)} className="mt-0.5" aria-describedby={`${checkboxId}-hint`} />
          <span className="min-w-0 text-sm">
            <span className="block text-body text-foreground">Also ignore future mail from this sender</span>
            <span id={`${checkboxId}-hint`} className="block text-muted-foreground">
              {email ? (
                <>
                  Their address{domain ? <>, or everyone at <span className="font-mono text-foreground">{domain}</span> when it is a company domain,</> : null} is added to the ignored
                  senders. Change it later under Settings › Mail rules.
                </>
              ) : (
                "The sender is added to the ignored senders. Change it later under Settings › Mail rules."
              )}
            </span>
          </span>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-text">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={(event) => void confirm(event)} disabled={busy}>
            {busy ? <Spinner /> : null}
            {learn ? "Mark and ignore sender" : "Mark not a booking"}
          </AlertDialogAction>
        </AlertDialogFooter>
    </>
  );
}
