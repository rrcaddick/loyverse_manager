/**
 * Work queries and the mutations behind the row verbs.
 *
 *   useWorkList("reply", 1)   → ["work", "list", "reply", 1]   (carries `counts` too)
 *   useWorkCounts()           → ["work", "counts", "full"]
 *
 * The sidebar badge (`useNavCounts`) stores a *number* under
 * ["work", "counts"], so the full counts object lives one level deeper; both
 * share the ["work"] prefix, which every mutation here invalidates, so the
 * rail, the tile and the badge refresh together. `invalidateWorkWorld` also
 * touches the keys other pages read (today, bookings, bank, mail, calendar)
 * because a verb here changes their data too.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { BookingDetail } from "@/features/bookings/types";
import { api } from "@/lib/api";
import type { BookingStatus } from "@/types/api";

import type { DismissResponse, WorkCountsResponse, WorkListResponse, WorkView } from "./types";

export const WORK_PAGE_SIZE = 50;

export const workKeys = {
  all: ["work"] as const,
  counts: ["work", "counts", "full"] as const,
  list: (view: WorkView, page: number) => ["work", "list", view, page] as const,
};

const REFRESH_MS = 60_000;

export function useWorkCounts(enabled = true) {
  return useQuery({
    queryKey: workKeys.counts,
    queryFn: () => api.get<WorkCountsResponse>("/work/counts"),
    enabled,
    refetchInterval: REFRESH_MS,
  });
}

export function useWorkList(view: WorkView, page: number, enabled = true) {
  return useQuery({
    queryKey: workKeys.list(view, page),
    queryFn: () => api.get<WorkListResponse>("/work", { params: { view, page, page_size: WORK_PAGE_SIZE } }),
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval: REFRESH_MS,
  });
}

/** Everything a Work verb can change. */
export function invalidateWorkWorld(qc: QueryClient) {
  for (const key of [["work"], ["today"], ["bookings"], ["enquiries"], ["day"], ["calendar"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

/** A finished row leaves every list at once; the refetch confirms. */
export function removeWorkRow(qc: QueryClient, rowId: string) {
  qc.setQueriesData<WorkListResponse>({ queryKey: ["work", "list"] }, (old) => {
    if (!old) return old;
    const items = old.items.filter((item) => item.id !== rowId);
    if (items.length === old.items.length) return old;
    return { ...old, items, total: Math.max(0, old.total - 1) };
  });
  void qc.invalidateQueries({ queryKey: ["today"] });
}

// --------------------------------------------------------------- mutations

export function useDismissReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: (number | string)[] } | { all_stale: true }) => api.post<DismissResponse>("/work/reminders/dismiss", input),
    onSuccess: () => invalidateWorkWorld(qc),
  });
}

export function useExtendHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ booking_id, hold_expires_on }: { booking_id: number; hold_expires_on: string }) =>
      api.post<{ booking: BookingDetail; counts: unknown }>(`/work/holds/${booking_id}/extend`, { hold_expires_on }),
    onSuccess: (result) => {
      qc.setQueryData(["bookings", result.booking.id], result.booking);
      invalidateWorkWorld(qc);
    },
  });
}

export function useWorkBookingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ booking_id, name, body }: { booking_id: number; name: string; body?: Record<string, unknown> }) =>
      api.post<BookingDetail>(`/bookings/${booking_id}/actions/${name}`, body ?? {}),
    onSuccess: (detail) => {
      qc.setQueryData(["bookings", detail.id], detail);
      invalidateWorkWorld(qc);
    },
  });
}

export function useSetBookingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ booking_id, status, reason }: { booking_id: number; status: BookingStatus; reason?: string }) =>
      api.post<BookingDetail>(`/bookings/${booking_id}/status`, reason ? { status, reason } : { status }),
    onSuccess: (detail) => {
      qc.setQueryData(["bookings", detail.id], detail);
      invalidateWorkWorld(qc);
    },
  });
}
