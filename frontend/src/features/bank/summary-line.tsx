/**
 * The one summary line under the Bank title (spec §8):
 * "4 to confirm · 12 unmatched credits this month · last poll 20:10, OK ·
 * Poll now · Ignore rules". The counts are links to Needs attention; the
 * poll word goes red with the error when the last poll failed; Poll now
 * runs POST /payments/sync with no dialog.
 */

import { AlertCircle, RefreshCw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatTime, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { usePollBank } from "./api";
import type { BankSummary } from "./types";

interface SummaryLineProps {
  summary: BankSummary | undefined;
  isLoading: boolean;
  onShowNeedsAttention: () => void;
  onShowRules: () => void;
}

export function SummaryLine({ summary, isLoading, onShowNeedsAttention, onShowRules }: SummaryLineProps) {
  const poll = usePollBank();

  async function pollNow() {
    try {
      const result = await poll.mutateAsync();
      const parts = [pluralise(result.new_entries, "new entry", "new entries")];
      if (result.matching.matched) parts.push(`${result.matching.matched} matched`);
      if (result.matching.suggested) parts.push(`${result.matching.suggested} suggested`);
      toast.success(`Bank polled · ${parts.join(" · ")}`);
    } catch {
      // The mutation cache toasts the error.
    }
  }

  if (isLoading || !summary) {
    return <Skeleton className="h-5 w-96" />;
  }

  const toConfirm = summary.to_confirm ?? summary.counts.suggested;
  const unmatched = summary.unmatched_credits_30d;
  const last = summary.last_poll;
  const failed = last?.status === "failed";
  const running = last?.status === "running";
  const at = last?.finished_at ?? last?.started_at ?? null;

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body text-muted-foreground">
      <button type="button" onClick={onShowNeedsAttention} className={cn("underline-offset-4 hover:underline", toConfirm > 0 ? "font-medium text-foreground" : "")}>
        <span className="tabular">{toConfirm}</span> to confirm
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={onShowNeedsAttention} className={cn("underline-offset-4 hover:underline", unmatched.count > 0 ? "font-medium text-foreground" : "")}>
        <span className="tabular">{unmatched.count}</span> unmatched {unmatched.count === 1 ? "credit" : "credits"} this month
      </button>
      {unmatched.count > 0 ? <span className="tabular">({formatMoney(unmatched.amount, { compact: true })})</span> : null}
      <span aria-hidden="true">·</span>
      <span className={cn("inline-flex items-center gap-1", failed && "font-medium text-red-text")} role={failed ? "alert" : undefined}>
        {failed ? <AlertCircle aria-hidden="true" className="size-4" /> : null}
        last poll {at ? formatTime(at) : "never"}, {failed ? `failed${last?.error ? `: ${last.error}` : ""}` : running ? "running" : last ? "OK" : "—"}
      </span>
      <span aria-hidden="true">·</span>
      <Button type="button" variant="link" size="sm" className="h-auto px-0 text-body" onClick={() => void pollNow()} disabled={poll.isPending}>
        <RefreshCw data-icon="inline-start" className={cn(poll.isPending && "animate-spin")} />
        {poll.isPending ? "Polling…" : "Poll now"}
      </Button>
      <span aria-hidden="true">·</span>
      <Button type="button" variant="link" size="sm" className="h-auto px-0 text-body" onClick={onShowRules}>
        <SlidersHorizontal data-icon="inline-start" />
        Ignore rules
      </Button>
    </p>
  );
}
