/**
 * Detail drawer for one bank transaction: the raw facts, the matcher's
 * suggestions with one-click confirm, a manual match, and unmatch / ignore.
 */

import { ChevronDown, EyeOff, Link2, Link2Off, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { KeyValue } from "@/components/key-value";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, humanise, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useTransaction } from "./api";
import { ConfirmSuggestionDialog, IgnoreDialog, MatchBookingDialog, UnmatchDialog } from "./dialogs";
import { MatchStatusBadge } from "./match-status-badge";
import { SuggestionPicker } from "./suggestion-picker";
import type { BankSuggestion, BankTransaction } from "./types";

interface TransactionDrawerProps {
  id: number | null;
  onClose: () => void;
}

export function TransactionDrawer({ id, onClose }: TransactionDrawerProps) {
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {id !== null ? <DrawerBody key={id} id={id} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ id }: { id: number }) {
  const tx = useTransaction(id);
  const [picked, setPicked] = useState<number | null>(null);
  const confirming = useSubjectDialog<{ tx: BankTransaction; suggestion: BankSuggestion }>();
  const matching = useSubjectDialog<BankTransaction>();
  const ignoring = useSubjectDialog<BankTransaction>();
  const unmatching = useSubjectDialog<BankTransaction>();

  if (tx.isPending) {
    return (
      <div className="space-y-4 p-5" aria-busy="true">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (tx.isError || !tx.data) {
    return (
      <div className="p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Transaction</SheetTitle>
          <SheetDescription role="alert">{tx.error ? errorMessage(tx.error) : "Not found"}</SheetDescription>
        </SheetHeader>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void tx.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const t = tx.data;
  const credit = t.credit_debit === "CREDIT";
  const selectedSuggestion = t.suggestions.find((s) => s.booking_id === (picked ?? t.suggestions[0]?.booking_id)) ?? null;
  const canMatch = credit && (t.match_status === "unmatched" || t.match_status === "suggested");

  return (
    <>
      <SheetHeader className="border-b border-border px-5 py-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <MatchStatusBadge status={t.match_status} />
          <span className="text-xs text-muted-foreground">{credit ? "Credit" : "Debit"}</span>
        </div>
        <SheetTitle className={cn("text-2xl font-semibold tabular", credit ? "text-primary" : "text-foreground")}>
          {credit ? "" : "−"}
          {formatMoney(t.amount)}
        </SheetTitle>
        <SheetDescription className="break-words text-foreground">{t.description}</SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-5 py-5">
        <KeyValue
          layout="table"
          items={[
            { label: "Booking date", value: formatDate(t.booking_date) },
            { label: "Value date", value: formatDate(t.value_date) },
            { label: "Reference", value: t.end_to_end_id ? <span className="font-mono text-xs">{t.end_to_end_id}</span> : "—" },
            { label: "Balance after", value: formatMoney(t.balance_after), numeric: true },
            { label: "First seen", value: formatDateTime(t.first_seen_at) },
            { label: "Entry", value: t.entry_id ? <span className="font-mono text-xs">{t.entry_id}</span> : "—" },
          ]}
        />

        {t.match_status === "matched" && t.matched_booking ? (
          <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-labelledby="tx-match">
            <h3 id="tx-match" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Matched booking
            </h3>
            <div>
              <Link to={`/bookings/${t.matched_booking.id}`} className="font-medium underline-offset-4 hover:underline">
                <span className="tabular">{t.matched_booking.reference}</span> {t.matched_booking.group_name}
              </Link>
              <p className="text-xs text-muted-foreground tabular">
                {t.match_method ? `${humanise(t.match_method)} match` : "Matched"}
                {t.matched_at ? ` · ${formatDateTime(t.matched_at)}` : ""}
              </p>
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => unmatching.show(t)}>
                <Link2Off data-icon="inline-start" />
                Remove match
              </Button>
            </div>
          </section>
        ) : null}

        {t.match_status === "ignored" ? (
          <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-labelledby="tx-ignored">
            <h3 id="tx-ignored" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Ignored
            </h3>
            <p className="text-sm">{t.ignore_reason || "No reason given."}</p>
            <div>
              <Button variant="outline" size="sm" onClick={() => unmatching.show(t)}>
                <RotateCcw data-icon="inline-start" />
                Restore to unmatched
              </Button>
            </div>
          </section>
        ) : null}

        {canMatch ? (
          <section className="flex flex-col gap-3" aria-labelledby="tx-suggestions">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id="tx-suggestions" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t.suggestions.length > 0 ? pluralise(t.suggestions.length, "suggestion") : "No suggestions"}
              </h3>
            </div>
            {t.suggestions.length > 0 ? (
              <>
                <SuggestionPicker suggestions={t.suggestions} selectedId={selectedSuggestion?.booking_id ?? null} onSelect={setPicked} amount={t.amount} />
                <div>
                  <Button size="sm" disabled={!selectedSuggestion} onClick={() => selectedSuggestion && confirming.show({ tx: t, suggestion: selectedSuggestion })}>
                    Confirm {selectedSuggestion?.reference ?? "match"}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">The matcher found no reference, fitting amount or name in this credit.</p>
            )}
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button variant="outline" size="sm" onClick={() => matching.show(t)}>
                <Link2 data-icon="inline-start" />
                Match a booking…
              </Button>
              <Button variant="ghost" size="sm" onClick={() => ignoring.show(t)}>
                <EyeOff data-icon="inline-start" />
                Ignore
              </Button>
            </div>
          </section>
        ) : !credit ? (
          <p className="text-sm text-muted-foreground">Debits are kept for the balance chain only; they are never matched to bookings.</p>
        ) : null}

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-2">
              <ChevronDown data-icon="inline-start" className="transition-transform group-aria-expanded:rotate-180" />
              Raw bank entry
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-relaxed scrollbar-thin">{JSON.stringify(t.raw ?? {}, null, 2)}</pre>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <ConfirmSuggestionDialog tx={confirming.subject?.tx ?? null} suggestion={confirming.subject?.suggestion ?? null} open={confirming.open} onOpenChange={confirming.onOpenChange} />
      <MatchBookingDialog tx={matching.subject} open={matching.open} onOpenChange={matching.onOpenChange} />
      <IgnoreDialog tx={ignoring.subject} open={ignoring.open} onOpenChange={ignoring.onOpenChange} />
      <UnmatchDialog tx={unmatching.subject} open={unmatching.open} onOpenChange={unmatching.onOpenChange} />
    </>
  );
}
