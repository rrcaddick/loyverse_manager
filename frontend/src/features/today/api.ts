/**
 * Today / day view data.
 *
 *   useToday(date)              → ["today", date]      GET /today?date= (manager allowed)
 *   useRecordArrivalsFor(id)    POST /bookings/:id/arrivals, then every day-shaped cache refreshes
 *   useFetchArrivalsFor(id)     GET  /bookings/:id/arrivals (reports only; records nothing)
 *
 * `/today` groups carry no group type or arrival source; `mergeDayRows`
 * folds those in from GET /days/:date (features/calendar `useDay`) when it
 * has loaded, so the table can show "FY1678 · Church group" and
 * "Loyverse · 10:12" without a third request shape.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { ArrivalSource, ArrivalsCheck, BookingDetail, DayView } from "@/features/bookings/types";
import { api } from "@/lib/api";

import type { DayGroupRow, TodayGroup, TodayResponse } from "./types";

export const todayKeys = {
  all: ["today"] as const,
  day: (date: string) => ["today", date] as const,
};

export function useToday(date: string, enabled = true) {
  return useQuery({
    queryKey: todayKeys.day(date),
    queryFn: () => api.get<TodayResponse>("/today", { params: { date } }),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(date),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

/** Everything a change on the day (arrivals, a gate payment, a new booking) can affect. */
export function invalidateDayWorld(qc: QueryClient, detail?: BookingDetail) {
  if (detail) qc.setQueryData(["bookings", detail.id], detail);
  for (const key of [["today"], ["day"], ["gate"], ["calendar"], ["bookings"], ["work"], ["queue"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

export function useRecordArrivalsFor(bookingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { count: number; source: ArrivalSource }) => api.post<BookingDetail>(`/bookings/${bookingId}/arrivals`, input),
    meta: { silent: true },
    onSuccess: (detail) => invalidateDayWorld(qc, detail),
  });
}

export function useFetchArrivalsFor(bookingId: number) {
  return useMutation({
    mutationFn: () => api.get<ArrivalsCheck>(`/bookings/${bookingId}/arrivals`),
    meta: { silent: true },
  });
}

// ----------------------------------------------------------------- shaping

export function rowsFromToday(groups: TodayGroup[]): DayGroupRow[] {
  return groups.map((g) => ({
    id: g.id,
    reference: g.reference,
    group_name: g.group_name,
    group_type: null,
    status: g.status,
    people_booked: g.people_booked,
    arrival_time: g.arrival_time,
    vehicles: g.vehicles,
    gazebos: g.gazebos,
    arrived_count: g.arrived_count,
    arrived_source: null,
    arrived_at: null,
    ticket_sent: g.ticket_sent,
    paid_total: g.paid_total,
    balance_due: g.balance_due,
    contact_name: g.contact_name,
    contact_mobile: g.contact_mobile,
  }));
}

/** Fill the fields /today leaves out from the richer /days/:date rows. */
export function mergeDayRows(rows: DayGroupRow[], day: DayView | undefined): DayGroupRow[] {
  if (!day) return rows;
  const byId = new Map(day.bookings.map((b) => [b.id, b]));
  return rows.map((row) => {
    const rich = byId.get(row.id);
    if (!rich) return row;
    return {
      ...row,
      group_type: rich.group_type,
      arrived_source: rich.arrived_source,
      arrived_at: rich.arrived_at,
      arrival_time: row.arrival_time ?? rich.arrival_time,
    };
  });
}

/** Arrival time first (unset last), then the larger group. */
export function sortDayRows(rows: DayGroupRow[]): DayGroupRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.arrival_time ?? "99:99";
    const tb = b.arrival_time ?? "99:99";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return b.people_booked - a.people_booked;
  });
}
