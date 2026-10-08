/**
 * Bank rows (spec §8), Xero-style halves.
 *
 *   NeedsAttentionRow  left: date, amount 20 px tabular, description,
 *                      reference mono; right: the proposal card with the
 *                      arithmetic line, the confidence sentence and a green
 *                      Match — or "3 possible bookings — choose" expanding
 *                      in place — or Find booking… and Ignore ▾ when nothing
 *                      fits.
 *   MatchedRow         the booking it was recorded on and a one-click
 *                      Remove match (undo toast).
 *
 * The left half opens the drawer; buttons never bubble to it.
 */

import { ChevronDown, ChevronUp, Link2Off, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney, humanise, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { IgnoreMenu } from "./ignore-menu";
import { orderedSuggestions, preselectedId, rowDate, type Described } from "./lib";
import type { MatchFlow } from "./match-flow";
import type { BankSuggestion, BankTransaction } from "./types";

// ----------------------------------------------------------------- shared

function EntryHalf({ tx, onOpen }: { tx: BankTransaction; onOpen: (tx: BankTransaction) => void }) {
  const credit = tx.credit_debit === "CREDIT";
  return (
    <button
      type="button"
      onClick={() => onOpen(tx)}
      className="flex min-w-0 flex-col gap-0.5 rounded-lg px-1 py-0.5 text-left outline-none hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring"
      aria-label={`Open ${formatMoney(tx.amount)} ${tx.description}`}
    >
      <span className="text-sm text-muted-foreground tabular">{rowDate(tx.booking_date)}</span>
      <span className={cn("text-xl font-semibold tabular", credit ? "text-foreground" : "text-muted-foreground")}>
        {credit ? "" : "−"}
        {formatMoney(tx.amount, { compact: true })}
      </span>
      <span className="line-clamp-2 text-body text-foreground">{tx.description}</span>
      {tx.end_to_end_id && tx.end_to_end_id.trim() !== tx.description.trim() ? <span className="truncate font-mono text-xs text-muted-foreground">{tx.end_to_end_id}</span> : null}
    </button>
  );
}

function RowShell({ tx, leaving, children, className }: { tx: BankTransaction; leaving: boolean; children: ReactNode; className?: string }) {
  return (
    <li
      data-tx={tx.id}
      className={cn(
        "grid gap-3 rounded-xl bg-card p-3 ring-1 ring-border sm:p-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-6",
        leaving && "animate-out fade-out slide-out-to-right fill-mode-forwards duration-200",
        className,
      )}
    >
      {children}
    </li>
  );
}

const MATCH_BUTTON = "bg-green-solid text-on-solid hover:bg-green-solid/90 focus-visible:ring-green-solid/40";

function ProposalCard({ s, d, action, compact = false }: { s: BankSuggestion; d: Described; action: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-lg bg-nested ring-1 ring-border", compact ? "p-2.5" : "p-3")}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-body text-foreground">
          <Link to={`/bookings/${s.booking_id}`} onClick={(e) => e.stopPropagation()} className="font-semibold tabular underline-offset-4 hover:underline">
            {s.reference}
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="truncate font-medium">{s.group_name}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground tabular">{rowDate(s.visit_date)}</span>
          <StatusPill status={s.status} size="sm" />
        </div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground tabular">{d.arithmetic}</div>
        <div className={cn("mt-0.5 text-sm font-medium", d.tone === "green" ? "text-green-text" : "text-muted-foreground")}>{d.sentence}</div>
      </div>
      <div className="shrink-0 self-center">{action}</div>
    </div>
  );
}

// -------------------------------------------------------- needs attention

interface NeedsAttentionRowProps {
  tx: BankTransaction;
  flow: MatchFlow;
  onOpen: (tx: BankTransaction) => void;
  onFind: (tx: BankTransaction) => void;
}

export function NeedsAttentionRow({ tx, flow, onOpen, onFind }: NeedsAttentionRowProps) {
  const [choosing, setChoosing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const candidates = orderedSuggestions(tx);
  const preselected = preselectedId(tx);
  const chosen = preselected ? candidates.find((c) => c.suggestion.booking_id === preselected) ?? null : null;
  const others = chosen ? candidates.filter((c) => c.suggestion.booking_id !== chosen.suggestion.booking_id) : candidates;
  const leaving = flow.leaving.has(tx.id);

  async function match(s: BankSuggestion) {
    setBusyId(s.booking_id);
    try {
      await flow.match(tx, { id: s.booking_id, reference: s.reference, group_name: s.group_name });
    } finally {
      setBusyId(null);
    }
  }

  const matchButton = (s: BankSuggestion) => (
    <Button size="sm" className={MATCH_BUTTON} disabled={flow.busy || leaving} aria-busy={busyId === s.booking_id} onClick={() => void match(s)}>
      Match
    </Button>
  );

  const secondary = (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => onFind(tx)} disabled={flow.busy || leaving}>
        <Search data-icon="inline-start" />
        Find booking…
      </Button>
      <IgnoreMenu tx={tx} flow={flow} />
    </div>
  );

  return (
    <RowShell tx={tx} leaving={leaving}>
      <EntryHalf tx={tx} onOpen={onOpen} />
      <div className="flex min-w-0 flex-col gap-2">
        {candidates.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">No booking fits this credit — no reference, amount or name matched.</p>
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => onFind(tx)} disabled={flow.busy || leaving}>
                <Search data-icon="inline-start" />
                Find booking…
              </Button>
              <IgnoreMenu tx={tx} flow={flow} />
            </div>
          </>
        ) : chosen ? (
          <>
            <ProposalCard s={chosen.suggestion} d={chosen.described} action={matchButton(chosen.suggestion)} />
            {others.length > 0 ? (
              <div>
                <Button variant="ghost" size="xs" className="text-muted-foreground" aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}>
                  {choosing ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
                  {choosing ? "Hide" : "Or choose another"} · {pluralise(others.length, "other booking")}
                </Button>
                {choosing ? (
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {others.map((c) => (
                      <li key={c.suggestion.booking_id}>
                        <ProposalCard s={c.suggestion} d={c.described} action={matchButton(c.suggestion)} compact />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {secondary}
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" className="w-fit" aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}>
              {choosing ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
              {pluralise(candidates.length, "possible booking")} — choose
            </Button>
            {choosing ? (
              <ul className="flex flex-col gap-1.5">
                {candidates.map((c) => (
                  <li key={c.suggestion.booking_id}>
                    <ProposalCard s={c.suggestion} d={c.described} action={matchButton(c.suggestion)} compact />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {candidates
                  .slice(0, 3)
                  .map((c) => c.suggestion.reference)
                  .join(" · ")}
                {candidates.length > 3 ? " · …" : ""} — {candidates[0]?.described.sentence.toLowerCase()} on each
              </p>
            )}
            {secondary}
          </>
        )}
      </div>
    </RowShell>
  );
}

// ---------------------------------------------------------------- matched

interface MatchedRowProps {
  tx: BankTransaction;
  flow: MatchFlow;
  onOpen: (tx: BankTransaction) => void;
}

export function MatchedRow({ tx, flow, onOpen }: MatchedRowProps) {
  const leaving = flow.leaving.has(tx.id);
  const b = tx.matched_booking;
  return (
    <RowShell tx={tx} leaving={leaving}>
      <EntryHalf tx={tx} onOpen={onOpen} />
      <div className="flex min-w-0 flex-col gap-1">
        {b ? (
          <Link to={`/bookings/${b.id}`} className="truncate text-body font-medium text-foreground underline-offset-4 hover:underline">
            <span className="tabular">{b.reference}</span> · {b.group_name}
          </Link>
        ) : (
          <span className="text-body text-muted-foreground">Matched booking unknown</span>
        )}
        <span className="text-sm text-muted-foreground tabular">
          {tx.match_method ? `${humanise(tx.match_method)} match` : "Matched"}
          {tx.matched_at ? ` · ${formatDateTime(tx.matched_at)}` : ""}
        </span>
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" disabled={flow.busy || leaving} onClick={() => void flow.unmatch(tx)}>
            <Link2Off data-icon="inline-start" />
            Remove match
          </Button>
        </div>
      </div>
    </RowShell>
  );
}
