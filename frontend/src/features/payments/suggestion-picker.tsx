/**
 * The matcher's candidate bookings for a credit, as a radio group. Score and
 * reasons are shown in text (never colour alone) so the operator can judge.
 */

import { Link } from "react-router";

import { StatusBadge } from "@/components/status-badge";
import { visitDateLabel } from "@/features/queue/bookings";
import { formatMoney, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { BankSuggestion } from "./types";

interface SuggestionPickerProps {
  suggestions: BankSuggestion[];
  selectedId: number | null;
  onSelect: (bookingId: number) => void;
  /** The credit amount, to say what it would settle. */
  amount: number;
  label?: string;
  className?: string;
}

function whatItSettles(amount: number, s: BankSuggestion): { text: string; exact: boolean } {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  if (s.paid_total <= 0 && near(amount, s.deposit_due)) return { text: "equals the deposit", exact: true };
  if (near(amount, s.balance_due)) return { text: "settles the balance", exact: true };
  if (amount > s.balance_due + 1) return { text: `exceeds the balance of ${formatMoney(s.balance_due)}`, exact: false };
  return { text: `part of the ${formatMoney(s.balance_due)} balance`, exact: false };
}

export function SuggestionPicker({ suggestions, selectedId, onSelect, amount, label = "Suggested bookings", className }: SuggestionPickerProps) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-col gap-1.5", className)}>
      {suggestions.map((s) => {
        const selected = s.booking_id === selectedId;
        const settles = whatItSettles(amount, s);
        return (
          <div
            key={s.booking_id}
            role="radio"
            aria-checked={selected}
            tabIndex={0}
            onClick={() => onSelect(s.booking_id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(s.booking_id);
              }
            }}
            className={cn(
              "group/suggestion flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              selected ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/60",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-primary" : "border-input",
              )}
            >
              {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <Link
                  to={`/bookings/${s.booking_id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="font-medium tabular underline-offset-4 hover:underline"
                >
                  {s.reference}
                </Link>
                <span className="min-w-0 truncate font-medium">{s.group_name}</span>
                <StatusBadge status={s.status} />
                <span className="ml-auto shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground tabular" title="Match score out of 100">
                  Score {Math.round(s.score)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular">
                <span>{visitDateLabel(s.visit_date)}</span>
                {s.contact_name ? <span className="truncate">{s.contact_name}</span> : null}
                <span>Deposit {formatMoney(s.deposit_due)}</span>
                <span>Paid {formatMoney(s.paid_total)}</span>
                <span>Balance {formatMoney(s.balance_due)}</span>
              </div>
              <div className="mt-1 text-xs">
                <span className={cn(settles.exact ? "font-medium text-success" : "text-muted-foreground")}>
                  {formatMoney(amount)} {settles.text}
                </span>
                {s.reasons.length > 0 ? <span className="text-muted-foreground"> · {s.reasons.join(" · ")}</span> : null}
              </div>
            </div>
          </div>
        );
      })}
      {suggestions.length === 0 ? <p className="text-sm text-muted-foreground">{pluralise(0, "suggestion")}.</p> : null}
    </div>
  );
}
