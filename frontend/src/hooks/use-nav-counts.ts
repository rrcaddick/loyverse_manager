/**
 * Live counts for the sidebar badges: Work, Mail and Bank. A badge is a
 * promise that a person must act and that the number can reach zero, so each
 * count is one of:
 *
 *   work  GET /work/counts                      sum of the kind counts (minus "stale")
 *   mail  GET /inbox/conversations?view=needs_reply&page_size=1  → total
 *   bank  GET /payments/summary                 counts.suggested (credits to confirm)
 *
 * Any endpoint that is not deployed yet (404) or fails yields `null`, and a
 * null count renders no badge. Keys are namespaced ["work","counts"],
 * ["mail","counts"], ["bank","counts"] so a page agent invalidating its own
 * prefix (["work"], ["mail"], ["bank"]) refreshes the badge too. Pages may
 * also call `invalidateNavCounts(queryClient)` after any action.
 */

import { useQueries, type QueryClient } from "@tanstack/react-query";

import { api, isApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { NavCountKey } from "@/lib/nav";

export const navCountKeys = {
  work: ["work", "counts"] as const,
  mail: ["mail", "counts"] as const,
  bank: ["bank", "counts"] as const,
};

export type NavCounts = Record<NavCountKey, number | null>;

const REFRESH_MS = 60_000;

/** Treat a missing endpoint or any failure as "no count". */
async function tolerant(load: () => Promise<number | null>): Promise<number | null> {
  try {
    return await load();
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 403)) return null;
    return null;
  }
}

function sumCounts(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const counts = (body.counts && typeof body.counts === "object" ? body.counts : body) as Record<string, unknown>;
  if (typeof counts.total === "number") return counts.total;
  let sum = 0;
  let seen = false;
  for (const [key, value] of Object.entries(counts)) {
    if (typeof value !== "number" || key === "stale" || key === "up_next") continue;
    sum += value;
    seen = true;
  }
  return seen ? sum : null;
}

export async function fetchWorkCount(): Promise<number | null> {
  return tolerant(async () => sumCounts(await api.get<unknown>("/work/counts")));
}

export async function fetchMailCount(): Promise<number | null> {
  return tolerant(async () => {
    const res = await api.get<{ total?: number; counts?: Record<string, number> }>("/inbox/conversations", {
      params: { view: "needs_reply", page_size: 1 },
    });
    if (typeof res.counts?.needs_reply === "number") return res.counts.needs_reply;
    return typeof res.total === "number" ? res.total : null;
  });
}

export async function fetchBankCount(): Promise<number | null> {
  return tolerant(async () => {
    const res = await api.get<{ counts?: Record<string, number> }>("/payments/summary");
    return typeof res.counts?.suggested === "number" ? res.counts.suggested : null;
  });
}

export function invalidateNavCounts(queryClient: QueryClient): void {
  for (const key of Object.values(navCountKeys)) void queryClient.invalidateQueries({ queryKey: key });
}

/** Counts for the sidebar. Admin only; managers get nulls without a request. */
export function useNavCounts(): NavCounts {
  const { isAdmin } = useAuth();
  const [work, mail, bank] = useQueries({
    queries: [
      { queryKey: navCountKeys.work, queryFn: fetchWorkCount, enabled: isAdmin, refetchInterval: REFRESH_MS, staleTime: 30_000, retry: false },
      { queryKey: navCountKeys.mail, queryFn: fetchMailCount, enabled: isAdmin, refetchInterval: REFRESH_MS, staleTime: 30_000, retry: false },
      { queryKey: navCountKeys.bank, queryFn: fetchBankCount, enabled: isAdmin, refetchInterval: REFRESH_MS, staleTime: 30_000, retry: false },
    ],
  });
  return { work: work.data ?? null, mail: mail.data ?? null, bank: bank.data ?? null };
}
