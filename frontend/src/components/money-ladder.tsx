/**
 * MoneyLadder — Total / Deposit / Paid / Balance with one state word
 * (spec §6). Money is tabular with its sign; colour only when the state
 * deviates (paid green, overdue red).
 *
 *   <MoneyLadder
 *     state={{ label: "Deposit paid", tone: "green" }}
 *     rows={[
 *       { key: "total", label: "Total", amount: 6365, note: "67 × R95" },
 *       { key: "deposit", label: "Deposit", amount: 3800, note: "due Fri 31 Oct", tone: "amber" },
 *       { key: "paid", label: "Paid", amount: 3800, note: "2 payments", tone: "green", onClick: openPayments },
 *       { key: "balance", label: "Balance", amount: 2565, emphasis: true, note: "on the day" },
 *     ]}
 *   />
 */

import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { StatusPill, type StatusTone } from "@/components/status-pill";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type MoneyTone = "neutral" | "green" | "amber" | "red";

export interface MoneyRow {
  key: string;
  label: ReactNode;
  /** A number is formatted as R 3 800.00; pass a node for anything else. */
  amount: number | ReactNode;
  /** Short context: "due 31 Oct", "2 payments", "overdue 3 d". */
  note?: ReactNode;
  tone?: MoneyTone;
  icon?: LucideIcon;
  /** The row that matters (Balance): larger figure. */
  emphasis?: boolean;
  /** Opens the detail (payments list) — renders a chevron. */
  onClick?: () => void;
}

interface MoneyLadderProps {
  rows: MoneyRow[];
  /** The one state word, top right. */
  state?: { label: string; tone: StatusTone; icon?: LucideIcon };
  title?: ReactNode;
  className?: string;
}

const TONE: Record<MoneyTone, string> = {
  neutral: "text-foreground",
  green: "text-green-text",
  amber: "text-amber-text",
  red: "text-red-text",
};

export function MoneyLadder({ rows, state, title = "Money", className }: MoneyLadderProps) {
  return (
    <section className={cn("rounded-xl bg-card ring-1 ring-border", className)} aria-label={typeof title === "string" ? title : "Money"}>
      <div className="flex items-center justify-between gap-3 px-card pt-4 pb-2">
        <h2 className="text-section">{title}</h2>
        {state ? <StatusPill tone={state.tone} label={state.label} icon={state.icon} /> : null}
      </div>
      <dl className="divide-y divide-border px-card pb-2">
        {rows.map((row) => {
          const amount = typeof row.amount === "number" ? formatMoney(row.amount) : row.amount;
          const Icon = row.icon;
          const content = (
            <>
              <dt className={cn("flex min-w-0 items-center gap-2", row.emphasis ? "text-body font-medium text-foreground" : "text-body text-muted-foreground")}>
                {Icon ? <Icon aria-hidden="true" className={cn("size-4 shrink-0", TONE[row.tone ?? "neutral"])} /> : null}
                <span className="truncate">{row.label}</span>
                {row.note ? <span className="truncate text-sm font-normal text-muted-foreground">· {row.note}</span> : null}
              </dt>
              <dd className={cn("flex shrink-0 items-center gap-1 tabular", row.emphasis ? "text-xl font-semibold" : "text-body font-medium", TONE[row.tone ?? "neutral"])}>
                {amount}
                {row.onClick ? <ChevronRight aria-hidden="true" className="size-4 text-faint-foreground" /> : null}
              </dd>
            </>
          );
          const rowClass = cn("flex min-h-row items-center justify-between gap-4 py-2", row.emphasis && "min-h-row-lg");
          if (row.onClick) {
            return (
              <div key={row.key} className="py-0">
                <button type="button" onClick={row.onClick} className={cn(rowClass, "w-full rounded-md text-left outline-none hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring")}>
                  {content}
                </button>
              </div>
            );
          }
          return (
            <div key={row.key} className={rowClass}>
              {content}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
