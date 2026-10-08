/**
 * Calendar and day queries (manager-allowed endpoints only).
 *   useCalendar(from, to)   → ["calendar", from, to]
 *   useDay(date)            → ["day", date]
 */

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { api } from "@/lib/api";

import type { CalendarResponse, DayView } from "@/features/bookings/types";

export const calendarKeys = {
  range: (from: string, to: string) => ["calendar", from, to] as const,
  day: (date: string) => ["day", date] as const,
};

function fetchCalendar(from: string, to: string) {
  return api.get<CalendarResponse>("/calendar", { params: { from, to } });
}

export function useCalendar(from: string, to: string) {
  return useQuery({
    queryKey: calendarKeys.range(from, to),
    queryFn: () => fetchCalendar(from, to),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Warms the cache for a neighbouring month so paging feels instant. */
export function usePrefetchCalendar() {
  const qc = useQueryClient();
  return useCallback(
    (from: string, to: string) =>
      qc.prefetchQuery({ queryKey: calendarKeys.range(from, to), queryFn: () => fetchCalendar(from, to), staleTime: 60_000 }),
    [qc],
  );
}

export function useDay(date: string, enabled = true) {
  return useQuery({
    queryKey: calendarKeys.day(date),
    queryFn: () => api.get<DayView>(`/days/${date}`),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(date),
    placeholderData: keepPreviousData,
  });
}
