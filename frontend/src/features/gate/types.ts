/**
 * GET /gate?date= (docs/handoff/backend-v2-misc.md §8). Admin and manager.
 * Open-ticket fields come from the bridge's receipt JSON and are all
 * nullable; money is included and hidden for managers in the UI.
 */

import type { ArrivalSource } from "@/features/bookings/types";
import type { BookingStatus } from "@/types/api";

export interface GateBooking {
  id: number;
  reference: string;
  group_name: string;
  group_type: string | null;
  status: BookingStatus;
  status_label: string;
  people_booked: number;
  arrival_time: string | null;
  vehicles: number;
  gazebos: number;
  arrived_count: number | null;
  arrived_source: ArrivalSource | null;
  arrived_at: string | null;
  arrived: boolean;
  barcode: string | null;
  contact_name: string | null;
  contact_mobile: string | null;
  ticket_sent_at: string | null;
  ticket_emailed_at: string | null;
  finance: { total_amount: number; paid_total: number; balance_due: number; deposit_covered: boolean };
}

export interface GateArrivals {
  is_closed: boolean;
  day_type: "weekday" | "weekend";
  label: string | null;
  totals: {
    groups: number;
    expected_people: number;
    confirmed_people: number;
    arrived_people: number;
    arrived_groups: number;
    balance_due_total: number;
  };
  bookings: GateBooking[];
}

export interface OpenTicket {
  id: number;
  ticket_id: string | null;
  name: string | null;
  device: string | null;
  employee_id: string | null;
  reason: string | null;
  total: number | null;
  item_count: number | null;
  quantity: number | null;
  plate: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_colour: string | null;
  vehicle_source: string | null;
  opened_at: string | null;
  updated_at: string | null;
  last_seen_at: string | null;
}

export type SyncStatus = "success" | "no_event" | "failed" | "running" | null;

export interface SyncRun {
  last_run_at: string | null;
  finished_at: string | null;
  status: SyncStatus;
  summary: string | null;
}

export interface GateSync extends SyncRun {
  scheduled: boolean;
  cron: string;
  clear_cron: string;
  clear_inventory: SyncRun;
  log_rows_scanned: number;
}

export interface GateResponse {
  date: string;
  arrivals: GateArrivals;
  open_tickets: OpenTicket[];
  sync: GateSync;
}
