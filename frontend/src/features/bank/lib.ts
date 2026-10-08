/**
 * Bank presentation helpers: the confidence sentence (server's when present,
 * derived otherwise), the arithmetic line, which candidate is pre-selected,
 * and a client-side preview of the description rule the server would derive.
 */

import { formatDateShort, formatMoney } from "@/lib/format";

import { RULE_REASONS, type BankSuggestion, type BankTransaction, type ConfidenceKey, type ConfidenceTone, type IgnoreReason } from "./types";

export interface Described {
  sentence: string;
  key: ConfidenceKey;
  tone: ConfidenceTone;
  rank: number;
  arithmetic: string;
}

const RANK: Record<ConfidenceKey, number> = { equals_deposit: 1, equals_balance: 2, part_of_balance: 3, exceeds_balance: 4, name_matches: 5 };
const SENTENCE: Record<ConfidenceKey, string> = {
  equals_deposit: "Equals the deposit",
  equals_balance: "Equals the balance",
  part_of_balance: "Part of the balance",
  exceeds_balance: "Exceeds the balance",
  name_matches: "Name matches",
};

const near = (a: number, b: number) => Math.abs(a - b) <= 1;

/** "R3 800 = deposit · R0 paid · R11 400 total" (the server's wording, rebuilt when absent). */
function arithmeticFor(amount: number, s: BankSuggestion, key: ConfidenceKey): string {
  const money = (v: number) => formatMoney(v, { compact: true });
  const what =
    key === "equals_deposit" ? "= deposit" : key === "equals_balance" ? "= balance" : key === "part_of_balance" ? `of ${money(s.balance_due)} balance` : key === "exceeds_balance" ? `> ${money(s.balance_due)} balance` : "";
  return `${money(amount)} ${what}`.trim() + ` · ${money(s.paid_total)} paid · ${money(s.total_amount)} total`;
}

/** Use the server's sentence when the row was matched by the v2 code; derive the same thing otherwise. */
export function describeSuggestion(amount: number, s: BankSuggestion): Described {
  if (s.confidence && s.confidence_key && s.tone) {
    return { sentence: s.confidence, key: s.confidence_key, tone: s.tone, rank: s.rank ?? RANK[s.confidence_key], arithmetic: s.arithmetic ?? arithmeticFor(amount, s, s.confidence_key) };
  }
  let key: ConfidenceKey;
  const depositOpen = s.deposit_due > 0 && s.paid_total < s.deposit_due;
  if (depositOpen && near(amount, s.deposit_due)) key = "equals_deposit";
  else if (near(amount, s.balance_due)) key = "equals_balance";
  else if (amount < s.balance_due - 1) key = "part_of_balance";
  else if (amount > s.balance_due + 1 && s.reasons.some((r) => /name/i.test(r)) && !s.reasons.some((r) => /amount/i.test(r))) key = "name_matches";
  else key = "exceeds_balance";
  const tone: ConfidenceTone = key === "equals_deposit" || key === "equals_balance" ? "green" : "grey";
  return { sentence: SENTENCE[key], key, tone, rank: RANK[key], arithmetic: arithmeticFor(amount, s, key) };
}

/** Candidates ordered by sentence rank, then nearest visit date. */
export function orderedSuggestions(tx: BankTransaction): { suggestion: BankSuggestion; described: Described }[] {
  const today = new Date().toISOString().slice(0, 10);
  return tx.suggestions
    .map((suggestion) => ({ suggestion, described: describeSuggestion(tx.amount, suggestion) }))
    .sort((a, b) => a.described.rank - b.described.rank || Math.abs(a.suggestion.visit_date.localeCompare(today)) - Math.abs(b.suggestion.visit_date.localeCompare(today)) || a.suggestion.booking_id - b.suggestion.booking_id);
}

/**
 * The booking to offer "Match" for straight away: the server's
 * `preselected_booking_id`, else the only candidate. Ties (several with the
 * same rank and no server pick) pre-select nothing — the row says "choose".
 */
export function preselectedId(tx: BankTransaction): number | null {
  if (tx.preselected_booking_id) return tx.preselected_booking_id;
  const flagged = tx.suggestions.find((s) => s.preselected);
  if (flagged) return flagged.booking_id;
  if (tx.suggestions.length === 1) return tx.suggestions[0]?.booking_id ?? null;
  return null;
}

/** "Thu 23 Jul" with a weekday, for the row's date. */
export function rowDate(iso: string): string {
  return formatDateShort(iso);
}

const STOP_AFTER = new Set(["FROM", "TO", "REF", "FOR"]);

/**
 * Preview of `bank.derive_rule_pattern`: words up to and including
 * FROM/TO/REF/FOR, a token cut at its first digit, at most five words.
 * The server derives the real one; this only tells the operator what
 * "similar" will mean before they choose it.
 */
export function deriveRulePattern(description: string): string {
  const words = description.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const raw of words) {
    const cut = raw.replace(/\d.*$/, "");
    if (!cut) break;
    out.push(cut);
    if (cut !== raw) break;
    if (STOP_AFTER.has(cut.toUpperCase()) || out.length >= 5) break;
  }
  return out.join(" ");
}

export function canMakeRule(reason: IgnoreReason): boolean {
  return RULE_REASONS.includes(reason);
}
