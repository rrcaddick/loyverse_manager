/**
 * GET /today?date= (docs/handoff/work-today.md). Manager calls lose the
 * money tile and the dashboard blocks, so those are optional.
 */

import type { ArrivalSource } from "@/features/bookings/types";
import type { WorkCounts } from "@/features/work/types";
import type { BookingStatus, DayKind } from "@/types/api";

export interface TodayTiles {
  groups: { total: number; arrived: number };
  people: { total: number; confirmed: number };
  /** Admin only. */
  owed_at_gate?: { total: number; paid: number };
  /** Admin only: automated mail set aside in the last `days` days. */
  skipped_mail?: { count: number; days: number };
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
  confirmed_people?: number;
  pending_people?: number;
  kind?: DayKind | null;
}

/** Admin only: the season's numbers. */
export interface SeasonBlock {
  from: string;
  to: string;
  bookings: number;
  confirmed_people: number;
  pending_people: number;
  completed: number;
  visit_days_ahead: number;
}

export interface MonthBlock {
  label: string;
  from: string;
  to: string;
  groups: number;
  confirmed_people: number;
  pending_people: number;
}

/** Admin only: money still to come in on the visits ahead. */
export interface MoneyBlock {
  deposits: number;
  deposits_count: number;
  balances: number;
  balances_count: number;
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
  /** The day's kind (Settings › Day kinds) and every kind it matches. */
  kind: DayKind | null;
  kinds: string[];
  tiles: TodayTiles;
  groups: TodayGroup[];
  /** Only when the day is closed or has no groups. */
  next_visit_day: NextVisitDay | null;
  seven_day_strip: StripDay[];
  /** Admin only. */
  season?: SeasonBlock;
  month?: MonthBlock;
  money?: MoneyBlock;
  next_visit_days?: NextVisitDay[];
  work_counts?: WorkCounts;
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
  arrived_count: number | null;
  arrived_source: ArrivalSource | null;
  ticket_sent: boolean;
  paid_total: number;
  balance_due: number;
  contact_name: string | null;
  contact_mobile: string | null;
}
