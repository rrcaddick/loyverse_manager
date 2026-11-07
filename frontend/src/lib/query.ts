/**
 * TanStack Query client with the app's defaults.
 *
 * - Queries: 30 s stale time, one retry (never on 4xx), no refetch on focus
 *   for list pages that would otherwise jump while someone reads them.
 * - Mutations: failures surface as a toast unless the mutation sets
 *   `meta.silent` (forms that show inline errors) — see useMutation callers.
 */

import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage, isApiError } from "./api";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Suppress the automatic error toast (the caller renders the error). */
      silent?: boolean;
      /** Toast shown on success, e.g. "Settings saved". */
      successMessage?: string;
    };
    queryMeta: {
      /** Toast on query failure (off by default; pages render their own state). */
      toastOnError?: boolean;
    };
  }
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.toastOnError) toast.error(errorMessage(error));
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.silent) return;
        // Auth failures are handled by the guards; a toast would be noise.
        if (isApiError(error) && (error.status === 401 || error.code === "password_change_required")) return;
        toast.error(errorMessage(error));
      },
      onSuccess: (_data, _variables, _context, mutation) => {
        const message = mutation.meta?.successMessage;
        if (message) toast.success(message);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Query key conventions (document new ones in docs/handoff/frontend-shell.md):
 *   ["auth", "session"]
 *   ["settings"]
 *   ["users"]
 *   ["ops", "status"] / ["ops", "logs", lines]
 *   ["bookings", "list", params] / ["bookings", id] / ["bookings", id, "events"]
 *   ["calendar", from, to] / ["day", date]
 *   ["inbox", view, page] / ["inbox", "message", id]
 *   ["payments", "transactions", params] / ["payments", "summary"]
 *   ["queue"]
 */
export const queryKeys = {
  session: ["auth", "session"] as const,
  settings: ["settings"] as const,
  users: ["users"] as const,
  opsStatus: ["ops", "status"] as const,
  opsLogs: (lines: number) => ["ops", "logs", lines] as const,
};
