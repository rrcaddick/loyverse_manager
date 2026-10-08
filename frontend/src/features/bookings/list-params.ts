/**
 * The bookings list keeps its filter, sort and page state in the URL so a
 * filtered view can be bookmarked and the back button restores it.
 *
 *   /bookings?status=confirmed,proforma_sent&range=month&q=church&sort=-visit_date&page=2
 */

import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";

import { todayIso } from "@/lib/format";
import { BOOKING_STATUSES, type BookingStatus } from "@/types/api";

import type { BookingListParams } from "./types";

export type RangePreset = "upcoming" | "month" | "next_month" | "past" | "all" | "custom";

export const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "month", label: "This month" },
  { value: "next_month", label: "Next month" },
  { value: "past", label: "Past visits" },
  { value: "all", label: "All dates" },
  { value: "custom", label: "Custom range" },
];

export const PAGE_SIZES = [25, 50, 100];

/** Column ids the API can sort on (src/models/booking.py SORTABLE). */
export const SORTABLE_COLUMNS = new Set(["reference", "group_name", "visit_date", "status", "people_booked", "updated_at", "created_at", "enquiry_date", "hold_expires_on"]);

export interface ListState {
  statuses: BookingStatus[];
  range: RangePreset;
  from: string;
  to: string;
  q: string;
  sort: string; // "-visit_date"
  page: number;
  pageSize: number;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseListState(params: URLSearchParams): ListState {
  const statuses = (params.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is BookingStatus => (BOOKING_STATUSES as string[]).includes(s));
  const rawRange = params.get("range");
  const q = params.get("q") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  let range: RangePreset = RANGE_OPTIONS.some((o) => o.value === rawRange) ? (rawRange as RangePreset) : "upcoming";
  // A search from the header should look at everything, not just upcoming visits.
  if (!rawRange && q) range = "all";
  if (!rawRange && (ISO_DAY.test(from) || ISO_DAY.test(to))) range = "custom";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sizeRaw = Number(params.get("size"));
  const pageSize = PAGE_SIZES.includes(sizeRaw) ? sizeRaw : 25;
  const sort = params.get("sort") ?? (range === "upcoming" ? "visit_date" : "-visit_date");
  return { statuses, range, from: ISO_DAY.test(from) ? from : "", to: ISO_DAY.test(to) ? to : "", q, sort, page, pageSize };
}

/** The date window a preset stands for. */
export function rangeDates(state: Pick<ListState, "range" | "from" | "to">): { from?: string; to?: string } {
  const today = todayIso();
  switch (state.range) {
    case "upcoming":
      return { from: today };
    case "month": {
      const d = parseISO(today);
      return { from: format(startOfMonth(d), "yyyy-MM-dd"), to: format(endOfMonth(d), "yyyy-MM-dd") };
    }
    case "next_month": {
      const d = parseISO(today);
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return { from: format(startOfMonth(next), "yyyy-MM-dd"), to: format(endOfMonth(next), "yyyy-MM-dd") };
    }
    case "past":
      return { to: format(new Date(parseISO(today).getTime() - 86_400_000), "yyyy-MM-dd") };
    case "custom":
      return { from: state.from || undefined, to: state.to || undefined };
    default:
      return {};
  }
}

export function toApiParams(state: ListState): BookingListParams {
  const { from, to } = rangeDates(state);
  return {
    status: state.statuses.length ? state.statuses.join(",") : undefined,
    from,
    to,
    q: state.q || undefined,
    sort: state.sort,
    page: state.page,
    page_size: state.pageSize,
  };
}

/** Writes only the non-default keys so the URL stays short. */
export function writeListState(state: ListState, current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  const set = (key: string, value: string | null) => {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  };
  set("status", state.statuses.length ? state.statuses.join(",") : null);
  set("range", state.range === "upcoming" ? null : state.range);
  set("from", state.range === "custom" ? state.from : null);
  set("to", state.range === "custom" ? state.to : null);
  set("q", state.q);
  set("sort", state.sort === (state.range === "upcoming" ? "visit_date" : "-visit_date") ? null : state.sort);
  set("page", state.page > 1 ? String(state.page) : null);
  set("size", state.pageSize !== 25 ? String(state.pageSize) : null);
  return next;
}

export function hasActiveFilters(state: ListState): boolean {
  return state.statuses.length > 0 || state.range !== "upcoming" || !!state.q;
}
