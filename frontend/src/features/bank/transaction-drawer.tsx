/**
 * Drawer for one bank entry (`?tx=`): amount and description first, the
 * match block (proposals with Match, the matched booking with Remove match,
 * or the ignore reason with Restore), bank metadata collapsed at the end.
 */

import { ChevronDown, Link2Off, RotateCcw, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { KeyValue } from "@/components/key-value";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useBankTransaction } from "./api";
import { IgnoreMenu } from "./ignore-menu";
import { orderedSuggestions, preselectedId, rowDate } from "./lib";
import type { MatchFlow } from "./match-flow";
import type { BankSuggestion, BankTransaction, MatchStatus } from "./types";

const STATUS_META: Record<MatchStatus, { label: string; tone: "neutral" | "amber" | "green" | "red-muted" }> = {
  unmatched: { label: "Unmatched", tone: "neutral" },
  suggested: { label: "Suggested", tone: "amber" },
  matched: { label: "Matched", tone: "green" },
  ignored: { label: "Ignored", tone: "neutral" },
};

interface TransactionDrawerProps {
  id: number | null;
  onClose: () => void;
  flow: MatchFlow;
  onFind: (tx: BankTransaction) => void;
}

export function TransactionDrawer({ id, onClose, flow, onFind }: TransactionDrawerProps) {
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 scrollbar-thin data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {id !== null ? <DrawerBody key={id} id={id} flow={flow} onFind={onFind} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ id, flow, onFind, onClose }: { id: number; flow: MatchFlow; onFind: (tx: BankTransaction) => void; onClose: () => void }) {
  const query = useBankTransaction(id);
  const [busyId, setBusyId] = useState<number | null>(null);

  if (query.isPending) {
    return (
      <div className="space-y-4 p-5" aria-busy="true">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Bank entry</SheetTitle>
          <SheetDescription role="alert">{query.error ? errorMessage(query.error) : "Not found"}</SheetDescription>
        </SheetHeader>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const tx = query.data;
  const credit = tx.credit_debit === "CREDIT";
  const meta = STATUS_META[tx.match_status];
  const candidates = orderedSuggestions(tx);
  const preselected = preselectedId(tx);
  const canMatch = credit && (tx.match_status === "unmatched" || tx.match_status === "suggested");

  async function match(s: BankSuggestion) {
    setBusyId(s.booking_id);
    try {
      await flow.match(tx, { id: s.booking_id, reference: s.reference, group_name: s.group_name });
      onClose();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <SheetHeader className="border-b border-border px-5 py-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={meta.tone} label={meta.label} />
          <span className="text-sm text-muted-foreground">{credit ? "Credit" : "Debit"}</span>
          <span className="text-sm text-muted-foreground tabular">· {rowDate(tx.booking_date)}</span>
        </div>
        <SheetTitle className="sr-only">
          {credit ? "Credit" : "Debit"} of {formatMoney(tx.amount)} — {tx.description}
        </SheetTitle>
        <p className={cn("text-display tabular", credit ? "text-foreground" : "text-muted-foreground")} aria-hidden="true">
          {credit ? "" : "−"}
          {formatMoney(tx.amount, { compact: true })}
        </p>
        <SheetDescription className="text-body break-words text-foreground">{tx.description}</SheetDescription>
        {tx.end_to_end_id && tx.end_to_end_id.trim() !== tx.description.trim() ? <p className="font-mono text-xs text-muted-foreground">{tx.end_to_end_id}</p> : null}
      </SheetHeader>

      <div className="flex flex-col gap-6 px-5 py-5">
        {tx.match_status === "matched" && tx.matched_booking ? (
          <section className="flex flex-col gap-2 rounded-lg bg-nested p-4 ring-1 ring-border" aria-labelledby="tx-match">
            <h3 id="tx-match" className="text-label text-muted-foreground uppercase">
              Recorded on
            </h3>
            <Link to={`/bookings/${tx.matched_booking.id}`} className="text-body font-medium underline-offset-4 hover:underline">
              <span className="tabular">{tx.matched_booking.reference}</span> · {tx.matched_booking.group_name}
            </Link>
            <p className="text-sm text-muted-foreground tabular">
              {tx.match_method ? `${humanise(tx.match_method)} match` : "Matched"}
              {tx.matched_at ? ` · ${formatDateTime(tx.matched_at)}` : ""}
            </p>
            <div>
              <Button variant="outline" size="sm" disabled={flow.busy} onClick={() => void flow.unmatch(tx).then(onClose)}>
                <Link2Off data-icon="inline-start" />
                Remove match
              </Button>
            </div>
          </section>
        ) : null}

        {tx.match_status === "ignored" ? (
          <section className="flex flex-col gap-2 rounded-lg bg-nested p-4 ring-1 ring-border" aria-labelledby="tx-ignored">
            <h3 id="tx-ignored" className="text-label text-muted-foreground uppercase">
              Ignored
            </h3>
            <p className="text-body">
              {tx.ignore?.label ?? "Ignored"}
              {tx.ignore?.note ? <span className="text-muted-foreground"> · {tx.ignore.note}</span> : null}
              {!tx.ignore && tx.ignore_reason ? <span className="text-muted-foreground"> · {tx.ignore_reason}</span> : null}
            </p>
            <div>
              <Button variant="outline" size="sm" disabled={flow.busy} onClick={() => void flow.unmatch(tx).then(onClose)}>
                <RotateCcw data-icon="inline-start" />
                Restore to unmatched
              </Button>
            </div>
          </section>
        ) : null}

        {canMatch ? (
          <section className="flex flex-col gap-3" aria-labelledby="tx-suggestions">
            <h3 id="tx-suggestions" className="text-label text-muted-foreground uppercase">
              {candidates.length ? (candidates.length === 1 ? "Suggested booking" : `${candidates.length} possible bookings`) : "No booking fits"}
            </h3>
            {candidates.length ? (
              <ul className="flex flex-col gap-1.5">
                {candidates.map(({ suggestion: s, described: d }) => (
                  <li key={s.booking_id} className={cn("flex items-start gap-3 rounded-lg bg-nested p-3 ring-1", s.booking_id === preselected ? "ring-green-solid/50" : "ring-border")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-body">
                        <Link to={`/bookings/${s.booking_id}`} className="font-semibold tabular underline-offset-4 hover:underline">
                          {s.reference}
                        </Link>
                        <span className="truncate font-medium">{s.group_name}</span>
                        <span className="text-muted-foreground tabular">· {rowDate(s.visit_date)}</span>
                        <StatusPill status={s.status} size="sm" />
                      </div>
                      <div className="mt-0.5 text-sm text-muted-foreground tabular">{d.arithmetic}</div>
                      <div className={cn("mt-0.5 text-sm font-medium", d.tone === "green" ? "text-green-text" : "text-muted-foreground")}>{d.sentence}</div>
                      {s.reasons.length ? <div className="mt-0.5 text-xs text-muted-foreground">{s.reasons.join(" · ")}</div> : null}
                    </div>
                    <Button size="sm" className="shrink-0 self-center bg-green-solid text-on-solid hover:bg-green-solid/90" disabled={flow.busy} aria-busy={busyId === s.booking_id} onClick={() => void match(s)}>
                      Match
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No reference, fitting amount or name in this credit.</p>
            )}
            <div className="flex flex-wrap gap-1 border-t border-border pt-3">
              <Button variant="outline" size="sm" onClick={() => onFind(tx)} disabled={flow.busy}>
                <Search data-icon="inline-start" />
                Find booking…
              </Button>
              <IgnoreMenu tx={tx} flow={flow} align="start" />
            </div>
          </section>
        ) : !credit ? (
          <p className="text-sm text-muted-foreground">Debits are kept for the balance chain only; they are never matched to bookings.</p>
        ) : null}

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-2 text-muted-foreground">
              <ChevronDown data-icon="inline-start" className="transition-transform group-aria-expanded:rotate-180" />
              Bank details
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 flex flex-col gap-4">
            <KeyValue
              layout="table"
              items={[
                { label: "Booking date", value: formatDate(tx.booking_date) },
                { label: "Value date", value: formatDate(tx.value_date) },
                { label: "Reference", value: tx.end_to_end_id ? <span className="font-mono text-xs">{tx.end_to_end_id}</span> : "—" },
                { label: "Balance after", value: formatMoney(tx.balance_after), numeric: true },
                { label: "Account", value: <span className="font-mono text-xs">{tx.account_number}</span> },
                { label: "Entry", value: tx.entry_id ? <span className="font-mono text-xs">{tx.entry_id}</span> : "—" },
                { label: "First seen", value: formatDateTime(tx.first_seen_at) },
              ]}
            />
            <pre className="max-h-72 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed scrollbar-thin">{JSON.stringify(tx.raw ?? {}, null, 2)}</pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </>
  );
}
