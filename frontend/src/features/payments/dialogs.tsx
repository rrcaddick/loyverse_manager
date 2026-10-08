/**
 * Dialogs shared by the payments page and the queue: match a credit to a
 * booking found by search, confirm a suggested match, ignore with a reason,
 * and unmatch.
 */

import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { BookingFinanceMeta, BookingPicker } from "@/features/queue/booking-picker";
import { visitDateLabel, type BookingListItem } from "@/features/queue/bookings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/lib/format";

import { useIgnoreTransaction, useMatchTransaction, useUnmatchTransaction } from "./api";
import type { BankSuggestion } from "./types";

/** The minimum a dialog needs to describe a credit. */
export interface CreditRef {
  id: number;
  amount: number;
  description: string;
  booking_date: string;
}

function creditLabel(tx: CreditRef): string {
  return `${formatMoney(tx.amount)} · “${tx.description}” · ${formatDate(tx.booking_date)}`;
}

// ------------------------------------------------------------ match by search

interface MatchBookingDialogProps {
  tx: CreditRef | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMatched?: () => void;
}

export function MatchBookingDialog({ tx, open, onOpenChange, onMatched }: MatchBookingDialogProps) {
  const [booking, setBooking] = useState<BookingListItem | null>(null);
  const match = useMatchTransaction();

  function handleOpenChange(next: boolean) {
    if (!next) setBooking(null);
    onOpenChange(next);
  }

  async function confirm() {
    if (!tx || !booking) return;
    await match.mutateAsync({ id: tx.id, booking_id: booking.id });
    handleOpenChange(false);
    onMatched?.();
  }

  const coversDeposit = booking ? !booking.deposit_covered && tx && tx.amount + 1 >= booking.deposit_due - booking.paid_total : false;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Match this credit to a booking</DialogTitle>
          <DialogDescription>{tx ? creditLabel(tx) : null}</DialogDescription>
        </DialogHeader>
        <BookingPicker value={booking} onChange={setBooking} status="active" renderMeta={(b) => <BookingFinanceMeta booking={b} />} />
        {booking && tx ? (
          <p className="text-sm text-muted-foreground">
            Records an EFT payment of <span className="font-medium text-foreground tabular">{formatMoney(tx.amount)}</span> on {booking.reference} dated{" "}
            {formatDate(tx.booking_date)}.{coversDeposit && booking.status !== "confirmed" ? " This covers the deposit, so the booking is confirmed." : ""}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!booking || match.isPending} onClick={() => void confirm()}>
            {match.isPending ? <Spinner data-icon="inline-start" /> : null}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------- confirm a suggestion

interface ConfirmSuggestionDialogProps {
  tx: CreditRef | null;
  suggestion: BankSuggestion | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMatched?: () => void;
}

export function ConfirmSuggestionDialog({ tx, suggestion, open, onOpenChange, onMatched }: ConfirmSuggestionDialogProps) {
  const match = useMatchTransaction();
  const confirms = suggestion && tx ? suggestion.status !== "confirmed" && suggestion.paid_total + tx.amount + 1 >= suggestion.deposit_due : false;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tx && suggestion ? `Record ${formatMoney(tx.amount)} on ${suggestion.reference}?` : "Confirm match"}
      description={
        tx && suggestion ? (
          <>
            The credit “{tx.description}” dated {formatDate(tx.booking_date)} becomes an EFT payment on {suggestion.reference} {suggestion.group_name} (visit{" "}
            {visitDateLabel(suggestion.visit_date)}).{confirms ? " It covers the deposit, so the booking is confirmed." : ""}
          </>
        ) : null
      }
      confirmLabel="Confirm match"
      onConfirm={async () => {
        if (!tx || !suggestion) return;
        await match.mutateAsync({ id: tx.id, booking_id: suggestion.booking_id });
        onMatched?.();
      }}
    />
  );
}

// ---------------------------------------------------------------------- ignore

interface IgnoreDialogProps {
  tx: CreditRef | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIgnored?: () => void;
}

const IGNORE_PRESETS = ["Own transfer between accounts", "Card settlement", "Interest", "Not a booking payment"];

export function IgnoreDialog({ tx, open, onOpenChange, onIgnored }: IgnoreDialogProps) {
  const [reason, setReason] = useState("");
  const ignore = useIgnoreTransaction();

  function handleOpenChange(next: boolean) {
    if (!next) setReason("");
    onOpenChange(next);
  }

  async function confirm() {
    if (!tx) return;
    await ignore.mutateAsync({ id: tx.id, reason: reason.trim() });
    handleOpenChange(false);
    onIgnored?.();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ignore this transaction?</DialogTitle>
          <DialogDescription>{tx ? creditLabel(tx) : null} It leaves the queue and is never suggested again. You can restore it from the payments page.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ignore-reason">Reason</Label>
          <Textarea id="ignore-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={255} placeholder="Why this is not a booking payment" className="min-h-0 resize-none" />
          <div className="flex flex-wrap gap-1.5">
            {IGNORE_PRESETS.map((preset) => (
              <Button key={preset} type="button" variant="outline" size="xs" onClick={() => setReason(preset)} aria-pressed={reason === preset}>
                {preset}
              </Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={!reason.trim() || ignore.isPending} onClick={() => void confirm()}>
            {ignore.isPending ? <Spinner data-icon="inline-start" /> : null}
            Ignore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------- unmatch

interface UnmatchDialogProps {
  tx: (CreditRef & { matched_booking?: { reference: string; group_name: string } | null }) | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnmatched?: () => void;
}

export function UnmatchDialog({ tx, open, onOpenChange, onUnmatched }: UnmatchDialogProps) {
  const unmatch = useUnmatchTransaction();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove this match?"
      description={
        tx ? (
          <>
            The payment of {formatMoney(tx.amount)} is deleted from {tx.matched_booking ? `${tx.matched_booking.reference} ${tx.matched_booking.group_name}` : "the booking"} and the
            credit goes back to unmatched. The booking’s status is not changed: if the deposit had confirmed it, review the status on the booking.
          </>
        ) : null
      }
      confirmLabel="Remove match"
      destructive
      onConfirm={async () => {
        if (!tx) return;
        await unmatch.mutateAsync(tx.id);
        onUnmatched?.();
      }}
    />
  );
}
