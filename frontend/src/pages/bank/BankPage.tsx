/**
 * /bank — the FNB feed (spec §8).
 *
 * One summary line under the title; SegmentedTabs Needs attention (default)
 * · Matched · All entries; Xero-style rows with the proposal card and a
 * green Match; no modals for Match (undo toast, then an offer to send the
 * payment confirmation); Find booking… and Ignore ▾ on unmatched rows; a
 * drawer per row (`?tx=`); the ignore-rules list from the summary line.
 *
 * URL: /bank?tab=needs_attention|matched|all&q=&page=&tx=&rules=1
 * The tab is remembered in localStorage["fy.bank.tab"].
 */

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AllEntriesTable } from "@/features/bank/all-entries-table";
import { useBankSummary, useBankTransactions } from "@/features/bank/api";
import { FindBookingDialog } from "@/features/bank/find-booking-dialog";
import { IgnoreRulesDialog } from "@/features/bank/ignore-rules-dialog";
import { useMatchFlow } from "@/features/bank/match-flow";
import { SummaryLine } from "@/features/bank/summary-line";
import { TransactionDrawer } from "@/features/bank/transaction-drawer";
import { MatchedRow, NeedsAttentionRow } from "@/features/bank/transaction-row";
import { BANK_VIEWS, type BankTransaction, type BankView } from "@/features/bank/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/lib/api";
import { formatMoney, pluralise } from "@/lib/format";

const TAB_LABELS: Record<BankView, string> = { needs_attention: "Needs attention", matched: "Matched", all: "All entries" };
const TAB_KEY = "fy.bank.tab";
const PAGE_SIZE = 25;

function rememberedTab(): BankView {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    return BANK_VIEWS.includes(raw as BankView) ? (raw as BankView) : "needs_attention";
  } catch {
    return "needs_attention";
  }
}

export default function BankPage() {
  useDocumentTitle("Bank");
  const [params, setParams] = useSearchParams();
  const [initialTab] = useState(rememberedTab);
  const rawTab = params.get("tab");
  const tab: BankView = BANK_VIEWS.includes(rawTab as BankView) ? (rawTab as BankView) : initialTab;
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.max(10, Number(params.get("page_size")) || PAGE_SIZE);
  const openId = params.get("tx") ? Number(params.get("tx")) || null : null;
  const rulesOpen = params.get("rules") === "1";

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // ignore
    }
  }, [tab]);

  function update(changes: Partial<Record<"tab" | "q" | "page" | "page_size" | "tx" | "rules", string | number | null>>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || (key === "page" && value === 1) || (key === "page_size" && value === PAGE_SIZE)) next.delete(key);
      else next.set(key, String(value));
    }
    if (!("page" in changes) && !("tx" in changes) && !("rules" in changes)) next.delete("page");
    setParams(next, { replace: true });
  }

  const summary = useBankSummary();
  const list = useBankTransactions({ view: tab, q, page, page_size: tab === "all" ? pageSize : PAGE_SIZE });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const flow = useMatchFlow();
  const [finding, setFinding] = useState<BankTransaction | null>(null);
  const [search, setSearch] = useState(q);

  useEffect(() => {
    if (search === q) return;
    const timer = window.setTimeout(() => update({ q: search }), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const counts = summary.data?.counts;
  const tabs = [
    { value: "needs_attention" as const, label: TAB_LABELS.needs_attention, count: tab === "needs_attention" && list.data ? total : summary.data?.needs_attention ?? ((counts?.suggested ?? 0) + (summary.data?.unmatched_credits_30d.count ?? 0)) },
    { value: "matched" as const, label: TAB_LABELS.matched, count: counts?.matched ?? null },
    { value: "all" as const, label: TAB_LABELS.all },
  ];

  const unmatchedOnScreen = tab === "needs_attention" ? rows.filter((r) => r.match_status === "unmatched").reduce((sum, r) => sum + r.amount, 0) : 0;

  return (
    <div className="flex flex-col gap-card-gap">
      <PageHeader title="Bank" className="gap-3">
        <SummaryLine summary={summary.data} isLoading={summary.isPending} onShowNeedsAttention={() => update({ tab: "needs_attention", q: null })} onShowRules={() => update({ rules: "1" })} />
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs aria-label="Bank views" value={tab} onChange={(v) => update({ tab: v, q: null })} items={tabs} />
          <div className="relative w-full sm:ml-auto sm:w-72">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search description or reference" aria-label="Search bank entries" className="h-9 pl-8 text-sm" />
          </div>
        </div>
      </PageHeader>

      {list.isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-card p-card ring-1 ring-border">
          <p role="alert" className="text-body text-red-text">
            {errorMessage(list.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </div>
      ) : tab === "all" ? (
        <AllEntriesTable rows={rows} total={total} page={page} pageSize={pageSize} onPageChange={(p, size) => update({ page: p, page_size: size })} onOpen={(tx) => update({ tx: tx.id })} isLoading={list.isPending} openId={openId} />
      ) : list.isPending ? (
        <ul className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-28 rounded-xl" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        tab === "needs_attention" ? (
          <EmptyState title={q ? `Nothing matches “${q}”` : "Nothing to confirm"} hint={q ? undefined : "Every credit is matched or ignored. The feed is polled every five minutes."} link={{ to: "/bank?tab=matched", label: "See matched" }} />
        ) : (
          <EmptyState title={q ? `Nothing matches “${q}”` : "No matched credits yet"} hint={q ? undefined : "Credits you match, or that carry a booking reference, land here."} />
        )
      ) : (
        <>
          <ul className="flex flex-col gap-3" aria-label={TAB_LABELS[tab]}>
            {rows.map((tx) =>
              tab === "matched" ? (
                <MatchedRow key={tx.id} tx={tx} flow={flow} onOpen={(t) => update({ tx: t.id })} />
              ) : (
                <NeedsAttentionRow key={tx.id} tx={tx} flow={flow} onOpen={(t) => update({ tx: t.id })} onFind={setFinding} />
              ),
            )}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground tabular">
            <span>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {pluralise(total, "entry", "entries")}
              {tab === "needs_attention" && unmatchedOnScreen > 0 ? ` · unmatched on this page ${formatMoney(unmatchedOnScreen, { compact: true })}` : ""}
            </span>
            {total > PAGE_SIZE ? (
              <span className="flex gap-1">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
                  Previous
                </Button>
                <Button variant="ghost" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => update({ page: page + 1 })}>
                  Next
                </Button>
              </span>
            ) : null}
          </div>
        </>
      )}

      <TransactionDrawer id={openId} onClose={() => update({ tx: null, page })} flow={flow} onFind={setFinding} />
      <FindBookingDialog tx={finding} open={finding !== null} onOpenChange={(open) => !open && setFinding(null)} flow={flow} />
      <IgnoreRulesDialog open={rulesOpen} onOpenChange={(open) => update({ rules: open ? "1" : null, page })} />
      {flow.dialog}
    </div>
  );
}
