/**
 * Pure date helpers for the calendar: a Monday-first window of N weeks
 * addressed by its first Monday (`?from=`), month arithmetic on "YYYY-MM"
 * keys, and small day arithmetic on "YYYY-MM-DD" strings. Everything works
 * on calendar days, never on browser-local instants, so the grid is the same
 * in every time zone.
 *
 * Exports kept for other pages: monthKey, shiftDay, daysBetween (DayPage and
 * features/bookings/lib use them).
 */

import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  getDay,
  getDaysInMonth,
  parseISO,
  startOfMonth,
} from "date-fns";

import { MONTHS, todayIso } from "@/lib/format";

export const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** "YYYY-MM" for the month a date falls in. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function isMonthKey(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isIsoDate(value: string | null | undefined): value is string {
  return !!value && ISO_DAY.test(value);
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

export function daysInMonth(month: string): number {
  return getDaysInMonth(parseISO(`${month}-01`));
}

/** The Monday on or before a date (ISO weeks). */
export function mondayOnOrBefore(iso: string): string {
  const d = parseISO(iso);
  const offset = (getDay(d) + 6) % 7; // getDay: 0 = Sunday … 6 = Saturday
  return format(addDays(d, -offset), "yyyy-MM-dd");
}

/** The window that starts a month: the Monday on or before the 1st. */
export function monthStartWindow(month: string): string {
  return mondayOnOrBefore(format(startOfMonth(parseISO(`${month}-01`)), "yyyy-MM-dd"));
}

/** The window that puts a date's week in row 2 (one week of context above). */
export function windowWithInRowTwo(iso: string): string {
  return shiftDay(mondayOnOrBefore(iso), -7);
}

/** `?from=` → a Monday; anything missing or malformed means "today in row 2". */
export function normaliseFrom(raw: string | null | undefined, today: string): string {
  if (isIsoDate(raw)) return mondayOnOrBefore(raw);
  return windowWithInRowTwo(today);
}

export interface CalendarWindow {
  /** First cell, always a Monday. */
  from: string;
  /** Last cell, always a Sunday. */
  to: string;
  rows: number;
  weeks: string[][];
  /** Every date in the window, in order. */
  dates: string[];
}

export function buildWindow(from: string, rows: number): CalendarWindow {
  const start = parseISO(from);
  const weeks: string[][] = [];
  for (let w = 0; w < rows; w += 1) {
    const row: string[] = [];
    for (let d = 0; d < 7; d += 1) row.push(format(addDays(start, w * 7 + d), "yyyy-MM-dd"));
    weeks.push(row);
  }
  const dates = weeks.flat();
  return { from, to: dates[dates.length - 1]!, rows, weeks, dates };
}

export function inWindow(window: CalendarWindow, iso: string): boolean {
  return iso >= window.from && iso <= window.to;
}

/**
 * The month a window "is": the month of its first row's Sunday, so a window
 * that starts on the Monday before the 1st belongs to the month that starts
 * in that first row.
 */
export function anchorMonth(from: string): string {
  return monthKey(shiftDay(from, 6));
}

/** ‹ › : the window that starts the month before / after the anchor. */
export function shiftWindowMonth(from: string, delta: number): string {
  return monthStartWindow(shiftMonth(anchorMonth(from), delta));
}

/** The calendar month a week row belongs to (the month of its Thursday, ISO 8601). */
export function weekMonthKey(week: string[]): string {
  return monthKey(week[3] ?? week[0]!);
}

function shortMonth(month: string): string {
  return (MONTHS[Number(month.slice(5, 7)) - 1] ?? "").slice(0, 3);
}

function longMonth(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? "";
}

/**
 * "November 2026" for a window that starts a month (where ‹ › land) or when
 * only one month has a full week in view; otherwise the months that do:
 * "Nov – Dec 2026" or "Dec 2026 – Jan 2027".
 */
export function windowTitle(window: CalendarWindow): string {
  const anchor = anchorMonth(window.from);
  const counts = new Map<string, number>();
  for (const d of window.dates) counts.set(monthKey(d), (counts.get(monthKey(d)) ?? 0) + 1);
  const months = window.from === monthStartWindow(anchor) ? [anchor] : [...counts.entries()].filter(([, n]) => n >= 7).map(([m]) => m).sort();
  if (months.length === 0) months.push(anchor);
  if (months.length === 1) return `${longMonth(months[0]!)} ${months[0]!.slice(0, 4)}`;
  const first = months[0]!;
  const last = months[months.length - 1]!;
  if (first.slice(0, 4) === last.slice(0, 4)) return `${shortMonth(first)} – ${shortMonth(last)} ${first.slice(0, 4)}`;
  return `${shortMonth(first)} ${first.slice(0, 4)} – ${shortMonth(last)} ${last.slice(0, 4)}`;
}

/** "7" normally, "1 Dec" on the first of a month. */
export function dayNumberLabel(iso: string): string {
  const day = Number(iso.slice(8, 10));
  return day === 1 ? `1 ${shortMonth(monthKey(iso))}` : String(day);
}

/** "Today", "Tomorrow", "Yesterday", "In 30 days", "12 days ago". */
export function relativeDayLabel(iso: string, today: string): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}

/** The same day-of-month in another month, clamped to that month's length. */
export function sameDayInMonth(iso: string, month: string): string {
  const day = Math.min(Number(iso.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}
