/**
 * The no-modal match flow (spec §8): Match records the payment, the row
 * slides out, a toast says "R3 800 recorded on FY1698 · Undo" for ten
 * seconds, and when the deposit is now covered a follow-up toast offers
 * "Send payment confirmation", which opens the booking-action confirm
 * dialog. Remove match and Ignore get the same undo treatment.
 *
 *   const flow = useMatchFlow();
 *   <NeedsAttentionRow tx={tx} flow={flow} … />
 *   {flow.dialog}
 */

import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { errorMessage } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { toastWithAction, toastWithUndo } from "@/lib/toast";

import { fetchBooking, useIgnoreTransaction, useDeleteIgnoreRule, useMatchTransaction, useSendPaymentConfirmation, useUnmatchTransaction } from "./api";
import { IGNORE_REASON_LABELS, type BankTransaction, type IgnoreInput, type IgnoreReason } from "./types";

export interface MatchTarget {
  id: number;
  reference: string;
  group_name: string;
}

export interface MatchFlow {
  match: (tx: BankTransaction, booking: MatchTarget) => Promise<void>;
  unmatch: (tx: BankTransaction) => Promise<void>;
  ignore: (tx: BankTransaction, input: IgnoreInput) => Promise<void>;
  /** Ids of rows animating out. */
  leaving: ReadonlySet<number>;
  busy: boolean;
  /** The "Send payment confirmation?" dialog; render it once on the page. */
  dialog: ReactNode;
}

interface ConfirmTarget {
  bookingId: number;
  reference: string;
  group_name: string;
  contact_email: string | null;
  amount: number;
  balance_due: number;
  hasStatement: boolean;
}

const LEAVE_MS = 220;

export function useMatchFlow(): MatchFlow {
  const match = useMatchTransaction();
  const unmatch = useUnmatchTransaction();
  const ignore = useIgnoreTransaction();
  const deleteRule = useDeleteIgnoreRule();
  const sendConfirmation = useSendPaymentConfirmation();
  const [leaving, setLeaving] = useState<Set<number>>(() => new Set());
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function markLeaving(id: number, on: boolean) {
    setLeaving((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Let the slide-out play before the list refetch drops the row. */
  async function withSlide(id: number, work: () => Promise<void>) {
    markLeaving(id, true);
    const started = Date.now();
    try {
      await work();
      const remaining = LEAVE_MS - (Date.now() - started);
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
    } finally {
      markLeaving(id, false);
    }
  }

  async function doMatch(tx: BankTransaction, booking: MatchTarget) {
    await withSlide(tx.id, async () => {
      await match.mutateAsync({ id: tx.id, booking_id: booking.id });
    });
    toastWithUndo(`${formatMoney(tx.amount, { compact: true })} recorded on ${booking.reference}`, {
      description: booking.group_name,
      onUndo: () => unmatch.mutateAsync(tx.id),
    });
    try {
      const detail = await fetchBooking(booking.id);
      if (detail.finance.deposit_covered && detail.finance.paid_total > 0) {
        const target: ConfirmTarget = {
          bookingId: booking.id,
          reference: booking.reference,
          group_name: booking.group_name,
          contact_email: detail.contact_email,
          amount: tx.amount,
          balance_due: detail.finance.balance_due,
          hasStatement: detail.documents.some((d) => d.kind === "invoice"),
        };
        window.setTimeout(() => {
          toastWithAction("Deposit covered — send payment confirmation?", {
            label: "Send payment confirmation",
            onClick: () => {
              setConfirm(target);
              setConfirmOpen(true);
            },
          }, { description: `${booking.reference} · ${booking.group_name}${detail.contact_email ? ` · ${detail.contact_email}` : ""}`, duration: 12_000 });
        }, 600);
      }
    } catch {
      // The follow-up offer is a courtesy; the match already succeeded.
    }
  }

  async function doUnmatch(tx: BankTransaction) {
    const booking = tx.matched_booking;
    const bookingId = tx.matched_booking_id ?? booking?.id ?? null;
    let reverted: string | null = null;
    await withSlide(tx.id, async () => {
      const result = await unmatch.mutateAsync(tx.id);
      if (result.booking_reverted) reverted = `${result.booking_reverted.reference} is back to proforma sent`;
    });
    toastWithUndo("Match removed", {
      description: reverted ?? (booking ? `${booking.reference} · ${booking.group_name}` : undefined),
      onUndo: bookingId ? () => match.mutateAsync({ id: tx.id, booking_id: bookingId }) : () => undefined,
    });
  }

  async function doIgnore(tx: BankTransaction, input: IgnoreInput) {
    let ruleId: number | null = null;
    let ruleText: string | null = null;
    await withSlide(tx.id, async () => {
      const result = await ignore.mutateAsync({ id: tx.id, ...input });
      if (result.rule) {
        ruleId = result.rule.created ? result.rule.rule.id : null;
        ruleText = `Entries starting “${result.rule.rule.pattern}” are ignored from now on${result.rule.applied ? ` (${result.rule.applied} more just now)` : ""}`;
      }
    });
    const label = IGNORE_REASON_LABELS[input.reason as IgnoreReason] ?? input.reason;
    toastWithUndo(`Ignored · ${label.replace("…", "")}`, {
      description: ruleText ?? `${formatMoney(tx.amount, { compact: true })} · ${tx.description}`,
      onUndo: async () => {
        await unmatch.mutateAsync(tx.id);
        if (ruleId) await deleteRule.mutateAsync(ruleId);
      },
    });
  }

  const dialog = (
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={confirm ? `Send payment confirmation for ${confirm.reference}?` : "Send payment confirmation?"}
      description={
        confirm ? (
          <>
            Emails {confirm.contact_email ?? "the contact"} a thank-you for the {formatMoney(confirm.amount, { compact: true })} received on {confirm.group_name}, with the balance of{" "}
            {formatMoney(confirm.balance_due, { compact: true })}.{confirm.hasStatement ? " The statement is attached." : ""}
          </>
        ) : undefined
      }
      confirmLabel="Send"
      onConfirm={async () => {
        if (!confirm) return;
        try {
          await sendConfirmation.mutateAsync({ bookingId: confirm.bookingId, attachInvoice: confirm.hasStatement });
          toast.success(`Payment confirmation sent · ${confirm.reference}`);
        } catch (err) {
          toast.error(errorMessage(err));
          throw err;
        }
      }}
    />
  );

  return {
    match: doMatch,
    unmatch: doUnmatch,
    ignore: doIgnore,
    leaving,
    busy: match.isPending || unmatch.isPending || ignore.isPending,
    dialog,
  };
}
