/**
 * The one state word on the money card (spec §6): Deposit outstanding
 * (amber), Deposit paid / Paid in full (green), Overpaid R… (blue, never a
 * green minus), Deposit waived / Nothing due (grey).
 */

import type { StatusTone } from "@/components/status-pill";
import { formatMoney } from "@/lib/format";

import type { BookingDetail } from "./types";

const money = (n: number) => formatMoney(n, { compact: true });

export function moneyState(b: BookingDetail): { label: string; tone: StatusTone } {
  const f = b.finance;
  if (f.balance_due < -0.005) return { label: `Overpaid ${money(-f.balance_due)}`, tone: "blue" };
  if (f.total_amount > 0 && f.balance_due <= 0.005 && f.paid_total > 0) return { label: "Paid in full", tone: "green" };
  if (b.status === "cancelled" || b.status === "lapsed" || b.status === "no_show") return { label: "Nothing due", tone: "neutral" };
  if (f.deposit_waived && f.paid_total <= 0) return { label: "Deposit waived", tone: "neutral" };
  if (f.deposit_covered && f.paid_total > 0) return { label: "Deposit paid", tone: "green" };
  return { label: "Deposit outstanding", tone: "amber" };
}
