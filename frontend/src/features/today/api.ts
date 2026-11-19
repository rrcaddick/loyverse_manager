/**
 * Today / day view data.
 *
 *   useToday(date)              → ["today", date]      GET /today?date= (manager allowed)
 *
 * `/today` groups carry no group type or arrival source; `mergeDayRows`
 * folds those in from GET /days/:date (features/calendar `useDay`) when it
 * has loaded, so the table can show "FY1678 · Church group" and
 * "Loyverse · 10:12" without a third request shape.
 */

import { keepPreviousData, useQuery, type QueryClient } from "@tanstack/react-query";

import type { BookingDetail, DayView } from "@/features/bookings/types";
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

// ----------------------------------------------------------------- shaping

export function rowsFromToday(groups: TodayGroup[]): DayGroupRow[] {
  return groups.map((g) => ({
    id: g.id,
    reference: g.reference,
    group_name: g.group_name,
    group_type: null,
    status: g.status,
    people_booked: g.people_booked,
    arrived_count: g.arrived_count,
    arrived_source: null,
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
    };
  });
}

/** The larger group first, then by name. */
export function sortDayRows(rows: DayGroupRow[]): DayGroupRow[] {
  return [...rows].sort((a, b) => b.people_booked - a.people_booked || a.group_name.localeCompare(b.group_name));
}


export interface VehicleReportRow {
  at: string | null;
  plate: string | null;
  person: string | null;
  heads: number;
  source: string | null;
  manual: boolean;
  device: string | null;
}

export interface VehicleReport {
  booking: { id: number; reference: string; group_name: string; barcode: string | null };
  date: string;
  items: VehicleReportRow[];
  total: number;
  heads: number;
}

/** The cars that came in under a group's ticket on the day (6 Nov 2026). */
export function useVehicleReport(bookingId: number | null, date: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["today", "vehicles", bookingId ?? -1, date ?? ""],
    queryFn: () => api.get<VehicleReport>(`/today/groups/${bookingId}/vehicles`, { params: { date } }),
    enabled: enabled && bookingId !== null,
    refetchInterval: 30_000,
  });
}
