/**
 * Pure helpers for the month grid: a fixed six-week, Monday-first grid, the
 * heat bands, and small date arithmetic on "YYYY-MM-DD" strings. Everything
 * here works on calendar days, never on browser-local Date instants, so the
 * grid is identical in every time zone.
 */

import { addDays, addMonths, differenceInCalendarDays, format, getDay, parseISO, startOfMonth } from "date-fns";

import { todayIso } from "@/lib/format";
import type { BookingStatus } from "@/types/api";

export const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "YYYY-MM" for the month a date falls in. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function isMonthKey(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function shiftMonth(month: string, delta: number): string {
  return format(addMonths(parseISO(`${month}-01`), delta), "yyyy-MM");
}

export function shiftDay(iso: string, delta: number): string {
  return format(addDays(parseISO(iso), delta), "yyyy-MM-dd");
}

export function daysBetween(fromIso: string, toIso: string): number {
  return differenceInCalendarDays(parseISO(toIso), parseISO(fromIso));
}

export function todayMonth(): string {
  return monthKey(todayIso());
}

export interface MonthGrid {
  month: string; // "YYYY-MM"
  from: string; // first cell (a Monday)
  to: string; // last cell (a Sunday)
  weeks: string[][]; // 6 × 7 ISO dates
}

/**
 * Six full weeks starting on the Monday on or before the 1st. Six rows always,
 * so paging months never shifts the layout.
 */
export function buildMonthGrid(month: string): MonthGrid {
  const first = startOfMonth(parseISO(`${month}-01`));
  // getDay: 0 = Sunday … 6 = Saturday → days since Monday
  const offset = (getDay(first) + 6) % 7;
  const start = addDays(first, -offset);
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const row: string[] = [];
    for (let d = 0; d < 7; d += 1) row.push(format(addDays(start, w * 7 + d), "yyyy-MM-dd"));
    weeks.push(row);
  }
  return {
    month,
    from: weeks[0]![0]!,
    to: weeks[5]![6]!,
    weeks,
  };
}

/**
 * Sequential heat bands over total people booked. Fixed thresholds (not the
 * month's maximum) so a December Saturday and a March Tuesday are comparable
 * and the legend means the same thing every month.
 */
export const HEAT_BANDS: { level: 1 | 2 | 3 | 4 | 5; min: number; max: number | null; label: string }[] = [
  { level: 1, min: 1, max: 99, label: "1–99" },
  { level: 2, min: 100, max: 249, label: "100–249" },
  { level: 3, min: 250, max: 499, label: "250–499" },
  { level: 4, min: 500, max: 799, label: "500–799" },
  { level: 5, min: 800, max: null, label: "800+" },
];

export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5;

export function heatLevel(totalPeople: number): HeatLevel {
  if (totalPeople <= 0) return 0;
  for (const band of HEAT_BANDS) {
    if (totalPeople >= band.min && (band.max === null || totalPeople <= band.max)) return band.level;
  }
  return 5;
}

/** Shorten long group names for a chip: "New Apostolic Church Lentegeur" → "New Apostolic Church…". */
export function chipName(name: string, max = 22): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Status → dot colour class for booking chips (matches StatusBadge tones). */
export const STATUS_DOT: Record<BookingStatus, string> = {
  enquiry: "bg-status-neutral-fg",
  proforma_sent: "bg-status-amber-fg",
  confirmed: "bg-primary",
  completed: "bg-status-green-muted-fg",
  cancelled: "bg-status-red-fg",
  lapsed: "bg-status-red-muted-fg",
  no_show: "bg-status-red-muted-fg",
};
