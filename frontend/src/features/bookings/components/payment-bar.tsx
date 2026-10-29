/**
 * PaymentBar — the one payment cell on the bookings list (owner's note,
 * 29 Oct 2026): paid of total on the first line, a bar that fills with the
 * payments made, and what is still due beside it. The tick on the bar is the
 * deposit: once the fill passes it the booking is held.
 *
 *   <PaymentBar booking={row} />
 *
 * Overpaid shows the credit in blue (never a green minus, spec §6).
 */

import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { BookingListItem } from "../types";

const money = (n: number) => formatMoney(n, { compact: true });

type Money = Pick<BookingListItem, "paid_total" | "total_amount" | "balance_due" | "deposit_due" | "deposit_waived">;

export function PaymentBar({ booking: b, className }: { booking: Money; className?: string }) {
  const total = b.total_amount;
  if (total <= 0) return <span className="text-muted-foreground">—</span>;
  const paid = Math.max(0, b.paid_total);
  const fillPct = Math.min(100, (paid / total) * 100);
  const depositPct = !b.deposit_waived && b.deposit_due > 0 && b.deposit_due < total ? (b.deposit_due / total) * 100 : null;
  const over = b.balance_due < -0.005;
  const paidUp = !over && b.balance_due <= 0.005 && paid > 0;
  const due = over
    ? { text: `credit ${money(-b.balance_due)}`, tone: "text-blue-text" }
    : paidUp
      ? { text: "Paid in full", tone: "text-green-text" }
      : { text: `${money(b.balance_due)} due`, tone: "text-foreground" };
  const title = `Paid ${money(paid)} of ${money(total)}${depositPct !== null ? ` · deposit ${money(b.deposit_due)}` : ""}`;

  return (
    <div className={cn("grid min-w-44 gap-1", className)} title={title}>
      <div className="flex items-baseline justify-between gap-3 whitespace-nowrap">
        <span className={cn("text-body leading-5 tabular", paid > 0 ? "text-green-text" : "text-muted-foreground")}>
          {money(paid)}
          <span className="text-sm text-muted-foreground"> of {money(total)}</span>
        </span>
        <span className={cn("text-sm leading-5 tabular", due.tone)}>{due.text}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Paid"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(Math.min(paid, total))}
        className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10"
      >
        <div className={cn("h-full rounded-full transition-[width]", over ? "bg-blue-solid" : "bg-green-solid")} style={{ width: `${fillPct}%` }} />
        {depositPct !== null ? <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-foreground/45" style={{ left: `calc(${depositPct}% - 1px)` }} /> : null}
      </div>
    </div>
  );
}
