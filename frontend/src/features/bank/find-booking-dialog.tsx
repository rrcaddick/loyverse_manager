/**
 * "Find booking…" — the one search dialog on the Bank page: pick a booking
 * for a credit the matcher could not place, then Match (same flow, same
 * undo toast).
 */

import { Link2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { BookingFinanceMeta, BookingPicker } from "@/features/queue/booking-picker";
import type { BookingListItem } from "@/features/queue/bookings";
import { formatDate, formatMoney } from "@/lib/format";

import type { MatchFlow } from "./match-flow";
import type { BankTransaction } from "./types";

interface FindBookingDialogProps {
  tx: BankTransaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flow: MatchFlow;
}

export function FindBookingDialog({ tx, open, onOpenChange, flow }: FindBookingDialogProps) {
  const [booking, setBooking] = useState<BookingListItem | null>(null);
  const [busy, setBusy] = useState(false);

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) setBooking(null);
    onOpenChange(next);
  }

  async function confirm() {
    if (!tx || !booking) return;
    setBusy(true);
    try {
      await flow.match(tx, { id: booking.id, reference: booking.reference, group_name: booking.group_name });
      setBooking(null);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const coversDeposit = booking && tx ? !booking.deposit_covered && tx.amount + 1 >= booking.deposit_due - booking.paid_total : false;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Find the booking for this credit</DialogTitle>
          <DialogDescription>
            {tx ? (
              <>
                <span className="font-medium text-foreground tabular">{formatMoney(tx.amount, { compact: true })}</span> · “{tx.description}” · {formatDate(tx.booking_date)}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <BookingPicker value={booking} onChange={setBooking} status="active" renderMeta={(b) => <BookingFinanceMeta booking={b} />} />
        {booking && tx ? (
          <p className="text-sm text-muted-foreground">
            Records an EFT payment of <span className="font-medium text-foreground tabular">{formatMoney(tx.amount, { compact: true })}</span> on {booking.reference} dated {formatDate(tx.booking_date)}.
            {coversDeposit && booking.status !== "confirmed" ? " This covers the deposit, so the booking is confirmed." : ""}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" disabled={!booking || busy} onClick={() => void confirm()} className="bg-green-solid text-on-solid hover:bg-green-solid/90">
            {busy ? <Spinner data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}
            Match{booking ? ` to ${booking.reference}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
