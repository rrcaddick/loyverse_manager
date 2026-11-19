/**
 * The bookings list on a phone: one card per booking — ref + pill, group,
 * contact, date · visitors, and one money line that matches the tab.
 */

import { Link } from "react-router";

import { StatusPill } from "@/components/status-pill";
import { formatDate, formatDateShort, formatMoney, formatNumber, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { holdState, relativeTo } from "../lib";
import type { BookingBucket, BookingListItem } from "../types";

const money = (n: number) => formatMoney(n, { compact: true });

function moneyLine(b: BookingListItem, tab: BookingBucket): { text: string; tone?: "amber" | "red" | "green" } {
  const ticket = b.ticket_sent_at || b.ticket_emailed_at;
  switch (tab) {
    case "pending": {
      const hold = holdState(b);
      const dep = b.deposit_waived ? "deposit waived" : `deposit ${money(b.deposit_due)}`;
      if (hold && hold.tone !== "neutral") return { text: `${dep} · hold ${hold.daysLeft < 0 ? "expired" : "expires"} ${hold.relative}`, tone: hold.tone };
      return { text: `${dep}${b.hold_expires_on ? ` · hold until ${formatDateShort(b.hold_expires_on)}` : ""}` };
    }
    case "confirmed":
      return { text: `${money(b.paid_total)} / ${money(b.total_amount)} · balance ${money(b.balance_due)} · ${ticket ? "ticket sent" : "no ticket yet"}`, tone: ticket ? undefined : "amber" };
    case "lapsed": {
      const stamp = b.status === "cancelled" ? b.cancelled_at : b.lapsed_at;
      return { text: `${b.status_label} ${stamp ? formatDate(stamp) : ""}${b.paid_total > 0 ? ` · ${money(b.paid_total)} paid` : ""}` };
    }
    case "past":
      return { text: `${b.arrived_count === null ? "arrivals not recorded" : `${formatNumber(b.arrived_count)} arrived`} · paid ${money(b.paid_total)}${b.balance_due > 0.005 ? ` · owed ${money(b.balance_due)}` : ""}`, tone: b.balance_due > 0.005 ? "red" : undefined };
    default:
      return { text: `${money(b.paid_total)} / ${money(b.total_amount)} · balance ${money(b.balance_due)}` };
  }
}

export function BookingCards({ items, tab }: { items: BookingListItem[]; tab: BookingBucket }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((b) => {
        const line = moneyLine(b, tab);
        return (
          <li key={b.id}>
            <Link to={`/bookings/${b.id}`} className="block rounded-xl bg-card p-3 ring-1 ring-border outline-none hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm tabular text-muted-foreground">{b.reference}</span>
                <StatusPill status={b.status} size="sm" />
              </div>
              <div className="mt-1 truncate text-body font-semibold text-foreground">{b.group_name}</div>
              <div className="truncate text-sm text-muted-foreground">{b.contact_name}{b.area ? ` · ${b.area}` : ""}</div>
              <div className="mt-1 text-sm tabular text-foreground">
                {formatDateShort(b.visit_date)} · {relativeTo(b.visit_date)} · {pluralise(b.people_booked, "visitor")}
              </div>
              <div className={cn("text-sm tabular", line.tone === "amber" ? "text-amber-text" : line.tone === "red" ? "text-red-text" : line.tone === "green" ? "text-green-text" : "text-muted-foreground")}>{line.text}</div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
