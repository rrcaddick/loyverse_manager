/**
 * Live counts for the sidebar: the Work total and each Work view (for the
 * accordion), and open enquiries. A badge is a promise that a person must
 * act and that the number can reach zero.
 *
 *   work       GET /work/counts        counts.total and the per-view counts
 *   enquiries  GET /enquiries/counts   waiting (open + replied)
 *
 * A missing endpoint (404) or any failure yields `null`, and a null count
 * renders no badge. Keys are namespaced ["work","counts"] and
 * ["enquiries","counts"] so a page invalidating its own prefix refreshes the
 * badge too; pages may also call `invalidateNavCounts(queryClient)`.
 */

import { useQueries, type QueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { NavCountKey } from "@/lib/nav";

export const navCountKeys = {
  work: ["work", "counts"] as const,
  enquiries: ["enquiries", "counts"] as const,
};

export interface WorkViewCounts {
  total: number | null;
  views: Record<string, number>;
}

export type NavCounts = Record<NavCountKey, number | null> & { workViews: Record<string, number> };

const REFRESH_MS = 60_000;

async function tolerant<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

export async function fetchWorkCounts(): Promise<WorkViewCounts | null> {
  return tolerant(async () => {
    const payload = await api.get<{ counts?: Record<string, unknown> } & Record<string, unknown>>("/work/counts");
    const counts = (payload.counts && typeof payload.counts === "object" ? payload.counts : payload) as Record<string, unknown>;
    const views: Record<string, number> = {};
    let sum = 0;
    let seen = false;
    for (const [key, value] of Object.entries(counts)) {
      if (typeof value !== "number") continue;
      views[key] = value;
      if (key === "stale" || key === "up_next" || key === "total") continue;
      sum += value;
      seen = true;
    }
    const total = typeof counts.total === "number" ? counts.total : seen ? sum : null;
    return { total, views };
  });
}

/** Kept for callers of the first build. */
export async function fetchWorkCount(): Promise<number | null> {
  return (await fetchWorkCounts())?.total ?? null;
}

export async function fetchEnquiryCount(): Promise<number | null> {
  return tolerant(async () => {
    const res = await api.get<{ waiting?: number }>("/enquiries/counts");
    return typeof res.waiting === "number" ? res.waiting : null;
  });
}

export function invalidateNavCounts(queryClient: QueryClient): void {
  for (const key of Object.values(navCountKeys)) void queryClient.invalidateQueries({ queryKey: key });
}

/** Counts for the sidebar. Admin only; managers get nulls without a request. */
export function useNavCounts(): NavCounts {
  const { isAdmin } = useAuth();
  const [work, enquiries] = useQueries({
    queries: [
      { queryKey: navCountKeys.work, queryFn: fetchWorkCounts, enabled: isAdmin, refetchInterval: REFRESH_MS, staleTime: 30_000, retry: false },
      { queryKey: navCountKeys.enquiries, queryFn: fetchEnquiryCount, enabled: isAdmin, refetchInterval: REFRESH_MS, staleTime: 30_000, retry: false },
    ],
  });
  return { work: work.data?.total ?? null, enquiries: enquiries.data ?? null, workViews: work.data?.views ?? {} };
}
