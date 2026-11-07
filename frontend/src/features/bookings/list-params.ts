/**
 * The bookings list keeps its state in the URL so a view can be bookmarked
 * and the back button restores it:
 *
 *   /bookings                              Pending, upcoming, by visit date
 *   /bookings?tab=confirmed&range=month    Confirmed visits this month
 *   /bookings?q=church&tab=all             a search across everything
 *
 * One tab (bucket) at a time, one search box, one date range, one sort, one
 * page size. Each tab has its own default sort and range; only non-default
 * keys are written so the URL stays short.
 */

import { addMonths, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from "date-fns";

import { todayIso } from "@/lib/format";

import { BOOKING_BUCKETS, type BookingBucket, type BookingListParams } from "./types";

export type RangePreset = "upcoming" | "week" | "month" | "next_month" | "past" | "all";

export const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "next_month", label: "Next month" },
  { value: "past", label: "Past" },
  { value: "all", label: "All dates" },
];

export const PAGE_SIZES = [25, 50, 100, 500] as const;
export const DEFAULT_PAGE_SIZE = 50;
/** Kept for callers of the first build. */
export const PAGE_SIZE = DEFAULT_PAGE_SIZE;

/** Column ids the API can sort on (src/models/booking.py SORTABLE). */
export const SORTABLE_COLUMNS = new Set(["reference", "group_name", "visit_date", "status", "people_booked", "updated_at", "created_at", "enquiry_date", "hold_expires_on"]);

/** Per-tab defaults: upcoming tabs by visit date, the past newest first. */
export const TAB_DEFAULTS: Record<BookingBucket, { sort: string; range: RangePreset }> = {
  requests: { sort: "-created_at", range: "all" },
  pending: { sort: "visit_date", range: "upcoming" },
  confirmed: { sort: "visit_date", range: "upcoming" },
  lapsed: { sort: "-updated_at", range: "all" },
  past: { sort: "-visit_date", range: "all" },
  all: { sort: "-visit_date", range: "all" },
};

export interface ListState {
  tab: BookingBucket;
  range: RangePreset;
  q: string;
  sort: string; // "-visit_date"
  page: number;
  size: number;
}

export function parseListState(params: URLSearchParams): ListState {
  const rawTab = params.get("tab");
  const tab: BookingBucket = (BOOKING_BUCKETS as string[]).includes(rawTab ?? "") ? (rawTab as BookingBucket) : "pending";
  const defaults = TAB_DEFAULTS[tab];
  const q = (params.get("q") ?? "").trim();
  const rawRange = params.get("range");
  let range: RangePreset = RANGE_OPTIONS.some((o) => o.value === rawRange) ? (rawRange as RangePreset) : defaults.range;
  // A search (from the header or the box) looks at everything unless a range was chosen.
  if (!rawRange && q) range = "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  // The page size is the person's Appearance preference (BookingsPage fills it in).
  const size = DEFAULT_PAGE_SIZE;
  const rawSort = params.get("sort") ?? "";
  const sortKey = rawSort.startsWith("-") ? rawSort.slice(1) : rawSort;
  const sort = SORTABLE_COLUMNS.has(sortKey) ? rawSort : defaults.sort;
  return { tab, range, q, sort, page, size };
}

/** The date window a preset stands for. Weeks run Monday to Sunday. */
export function rangeDates(range: RangePreset): { from?: string; to?: string } {
  const today = todayIso();
  const d = parseISO(today);
  const iso = (x: Date) => format(x, "yyyy-MM-dd");
  switch (range) {
    case "upcoming":
      return { from: today };
    case "week":
      return { from: iso(startOfWeek(d, { weekStartsOn: 1 })), to: iso(endOfWeek(d, { weekStartsOn: 1 })) };
    case "month":
      return { from: iso(startOfMonth(d)), to: iso(endOfMonth(d)) };
    case "next_month": {
      const n = addMonths(d, 1);
      return { from: iso(startOfMonth(n)), to: iso(endOfMonth(n)) };
    }
    case "past":
      return { to: iso(new Date(d.getTime() - 86_400_000)) };
    default:
      return {};
  }
}

export function toApiParams(state: ListState): BookingListParams {
  const { from, to } = rangeDates(state.range);
  return {
    bucket: state.tab,
    from,
    to,
    q: state.q || undefined,
    sort: state.sort,
    page: state.page,
    page_size: state.size,
  };
}

/** Writes only the non-default keys so the URL stays short. */
export function writeListState(state: ListState, current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  const defaults = TAB_DEFAULTS[state.tab];
  const set = (key: string, value: string | null) => {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  };
  set("tab", state.tab === "pending" ? null : state.tab);
  set("q", state.q);
  // With a search the implied range is "all"; otherwise the tab's default.
  const impliedRange = state.q ? "all" : defaults.range;
  set("range", state.range === impliedRange ? null : state.range);
  set("sort", state.sort === defaults.sort ? null : state.sort);
  set("page", state.page > 1 ? String(state.page) : null);
  set("size", null); // the page size is a preference, never a URL key
  return next;
}

export function hasActiveFilters(state: ListState): boolean {
  return state.range !== TAB_DEFAULTS[state.tab].range || !!state.q;
}

/** Switching tab resets sort, range and page to that tab's defaults; the search and page size stay. */
export function stateForTab(state: ListState, tab: BookingBucket): ListState {
  const defaults = TAB_DEFAULTS[tab];
  return { tab, q: state.q, range: state.q ? "all" : defaults.range, sort: defaults.sort, page: 1, size: state.size };
}
