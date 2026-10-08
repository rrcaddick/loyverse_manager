/**
 * GET /today?date= (docs/handoff/work-today.md). Manager calls lose the
 * money tile, Needs you, Up next and the work counts, so those are optional.
 */

import type { ArrivalSource } from "@/features/bookings/types";
import type { WorkCounts, WorkRow } from "@/features/work/types";
import type { BookingStatus } from "@/types/api";

export interface TodayTiles {
  groups: { total: number; arrived: number };
  people: { total: number; confirmed: number };
  /** Admin only. */
  owed_at_gate?: { total: number; paid: number };
  /** Admin only: the Work total and the oldest row's age. */
  needs_you?: { count: number; oldest_days: number | null };
}

export interface TodayGroup {
  id: number;
  reference: string;
  group_name: string;
  status: BookingStatus;
  people_booked: number;
  arrived_count: number | null;
  ticket_sent: boolean;
  paid_total: number;
  balance_due: number;
  contact_name: string | null;
  contact_mobile: string | null;
  vehicles: number;
  gazebos: number;
  arrival_time: string | null;
}

export interface StripDay {
  date: string;
  groups: number;
  people: number;
  confirmed_people: number;
  is_closed: boolean;
}

export interface NextVisitDay {
  date: string;
  groups: number;
  people: number;
}

export type SyncOutcome = "success" | "no_event" | "failed" | "running";

export interface SystemStatus {
  mail: { last_synced_at: string | null; ok: boolean };
  bank: { last_poll_at: string | null; ok: boolean };
  loyverse_sync: {
    scheduled: boolean;
    last_run: { at: string; outcome: SyncOutcome; message: string | null } | null;
    status: "off" | "unknown" | "ok" | "failed" | "running";
  };
}

export interface TodayResponse {
  date: string;
  /** "Saturday 7 November" */
  label: string;
  /** Python weekday: 0 = Monday. */
  weekday: number;
  day_type: "weekday" | "weekend";
  is_closed: boolean;
  is_peak: boolean;
  /** Season-day label or the public holiday name. */
  day_label: string | null;
  tiles: TodayTiles;
  groups: TodayGroup[];
  /** Only when the day is closed or has no groups. */
  next_visit_day: NextVisitDay | null;
  seven_day_strip: StripDay[];
  /** Admin only: the first five of Work's up_next. */
  up_next?: WorkRow[];
  /** Admin only. */
  work_counts?: WorkCounts;
  system: SystemStatus;
}

/**
 * One row of the day table, whichever endpoint it came from (/today groups,
 * /days/:date bookings or /gate arrivals). `group_type` and the arrival
 * source are absent on /today and filled in from /days/:date when it loads.
 */
export interface DayGroupRow {
  id: number;
  reference: string;
  group_name: string;
  group_type: string | null;
  status: BookingStatus;
  people_booked: number;
  arrival_time: string | null;
  vehicles: number;
  gazebos: number;
  arrived_count: number | null;
  arrived_source: ArrivalSource | null;
  arrived_at: string | null;
  ticket_sent: boolean;
  paid_total: number;
  balance_due: number;
  contact_name: string | null;
  contact_mobile: string | null;
}
