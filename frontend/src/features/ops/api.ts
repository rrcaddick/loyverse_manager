/**
 * Ops endpoints (built by the ops agent; shapes in src/types/api.ts).
 * Job names are the snake_case keys of web/api/ops.py RUNNABLE; the status
 * payload lists the ones this build can run.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import type { OpsLogs, OpsRunResult, OpsStatus } from "@/types/api";

export interface OpsJob {
  /** Key for POST /ops/run; must match web/api/ops.py RUNNABLE. */
  name: string;
  title: string;
  description: string;
  /** Takes minutes (Selenium); warn before running. */
  slow?: boolean;
}

export const OPS_JOBS: OpsJob[] = [
  { name: "sync_mail", title: "Sync mail", description: "Pull new messages from the bookings mailbox and match them to bookings." },
  { name: "poll_bank", title: "Poll bank", description: "Fetch recent FNB transactions and match credits to deposits." },
  { name: "recompute_reminders", title: "Recompute reminders", description: "Rebuild the reminder queue from current bookings and settings." },
  { name: "add_inventory", title: "Morning inventory sync", description: "Create today's online tickets and confirmed group items in Loyverse.", slow: true },
  { name: "clear_inventory", title: "Clear inventory", description: "End-of-day teardown of today's online-ticket items in Loyverse." },
  { name: "hide_quicket_event", title: "Hide Quicket event", description: "Run the Quicket bot on its own to hide today's event.", slow: true },
];

export function useOpsStatus() {
  return useQuery({
    queryKey: queryKeys.opsStatus,
    queryFn: () => api.get<OpsStatus>("/ops/status"),
    refetchInterval: 60_000,
  });
}

export function useOpsLogs(lines = 200, enabled = true) {
  return useQuery({
    queryKey: queryKeys.opsLogs(lines),
    queryFn: () => api.get<OpsLogs>("/ops/logs", { params: { lines } }),
    enabled,
    staleTime: 0,
  });
}

export function useRunJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<OpsRunResult>("/ops/run", { name }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.opsStatus });
      void queryClient.invalidateQueries({ queryKey: ["ops", "logs"] });
    },
  });
}
