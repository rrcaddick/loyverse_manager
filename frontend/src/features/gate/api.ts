/**
 * Gate data: useGate(date) → ["gate", date], refreshed every 30 s because
 * open tickets at the tills change while the page is open.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { DayGroupRow } from "@/features/today/types";
import { api } from "@/lib/api";

import type { GateBooking, GateResponse } from "./types";

export const gateKeys = {
  all: ["gate"] as const,
  day: (date: string) => ["gate", date] as const,
};

export function useGate(date: string) {
  return useQuery({
    queryKey: gateKeys.day(date),
    queryFn: () => api.get<GateResponse>("/gate", { params: { date } }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function rowsFromGate(bookings: GateBooking[]): DayGroupRow[] {
  return bookings.map((b) => ({
    id: b.id,
    reference: b.reference,
    group_name: b.group_name,
    group_type: b.group_type,
    status: b.status,
    people_booked: b.people_booked,
    arrival_time: b.arrival_time,
    vehicles: b.vehicles,
    gazebos: b.gazebos,
    arrived_count: b.arrived_count,
    arrived_source: b.arrived_source,
    arrived_at: b.arrived_at,
    ticket_sent: !!(b.ticket_sent_at || b.ticket_emailed_at),
    paid_total: b.finance.paid_total,
    balance_due: b.finance.balance_due,
    contact_name: b.contact_name,
    contact_mobile: b.contact_mobile,
  }));
}
