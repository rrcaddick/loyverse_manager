/**
 * Date rules for the public form, mirroring src/services/public_form.py:
 * typed dd/mm/yyyy ↔ ISO, why a day cannot be booked (with the next open
 * day, as the server words it), and the read-back line under the field.
 */

import { addDays, format } from "date-fns";

import { WEEKDAYS, parseDate, todayIso } from "@/lib/format";

import type { FormConfig } from "./types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DMY = /^\s*(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})\s*[/.\-\s]\s*(\d{2}|\d{4})\s*$/;

/** How far ahead the next-open-day search looks (the server uses 60). */
const NEXT_OPEN_DAY_HORIZON = 60;

/** Python weekday (0 = Monday) of an ISO date. */
export function pyWeekday(iso: string): number {
  const d = parseDate(iso);
  return d ? (d.getDay() + 6) % 7 : -1;
}

/** "07/11/2026" (also "7-11-2026", "7.11.26", "2026-11-07") → "2026-11-07"; null when not a real date. */
export function parseDmy(text: string): string | null {
  const raw = text.trim();
  if (ISO.test(raw)) return parseDate(raw) ? raw : null;
  const m = DMY.exec(raw);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return format(date, "yyyy-MM-dd");
}

/** "2026-11-07" → "07/11/2026" (what the text box shows). */
export function formatDmy(iso: string): string {
  const d = parseDate(iso);
  return d ? format(d, "dd/MM/yyyy") : iso;
}

/** "7 November 2026" — the server's `_fmt`. */
export function longDate(iso: string): string {
  const d = parseDate(iso);
  return d ? format(d, "d MMMM yyyy") : iso;
}

/** "Wednesday 4 November" — the server's `_fmt_weekday` (year implied). */
export function weekdayDate(iso: string): string {
  const d = parseDate(iso);
  return d ? format(d, "EEEE d MMMM") : iso;
}

/** "Saturday 7 November 2026" */
export function fullDate(iso: string): string {
  const d = parseDate(iso);
  return d ? format(d, "EEEE d MMMM yyyy") : iso;
}

/** "Mondays and Tuesdays" */
export function closedWeekdayNames(config: Pick<FormConfig, "closed_weekdays">): string {
  const names = [...config.closed_weekdays]
    .sort((a, b) => a - b)
    .map((d) => `${WEEKDAYS[d]?.label ?? "?"}s`);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function isClosedDay(iso: string, config: FormConfig): boolean {
  return config.closed_weekdays.includes(pyWeekday(iso)) || config.closed_days.includes(iso);
}

function inSeason(iso: string, config: FormConfig): boolean {
  if (iso < config.min_date) return false;
  if (config.max_date && iso > config.max_date) return false;
  return true;
}

/** The first bookable day after `iso`, or null when the season ends first. */
export function nextOpenDayAfter(iso: string, config: FormConfig): string | null {
  const start = parseDate(iso);
  if (!start) return null;
  for (let i = 1; i <= NEXT_OPEN_DAY_HORIZON; i += 1) {
    const candidate = format(addDays(start, i), "yyyy-MM-dd");
    if (inSeason(candidate, config) && !isClosedDay(candidate, config)) return candidate;
  }
  return null;
}

function nextOpenSentence(iso: string, config: FormConfig): string {
  const next = nextOpenDayAfter(iso, config);
  return next ? ` The next open day is ${weekdayDate(next)}.` : "";
}

/**
 * Why a day cannot be booked, in the server's words; null when it can.
 * Order matches `public_form.date_problem`: after today, season, closed
 * weekday (with the next open day), closed season day (with the next open day).
 */
export function dateProblem(iso: string, config: FormConfig): string | null {
  if (iso <= todayIso()) return "Choose a date after today";
  if (iso < config.min_date) return `The season opens on ${longDate(config.min_date)}`;
  if (config.max_date && iso > config.max_date) return `The season ends on ${longDate(config.max_date)}`;
  if (config.closed_weekdays.includes(pyWeekday(iso))) {
    return `We are closed on ${closedWeekdayNames(config)}.${nextOpenSentence(iso, config)}`;
  }
  if (config.closed_days.includes(iso)) {
    return `The park is closed on ${longDate(iso)}.${nextOpenSentence(iso, config)}`;
  }
  return null;
}

/** "Saturday 7 November 2026 · peak rates apply" */
export function readBack(iso: string, config: FormConfig): string {
  const parts = [fullDate(iso)];
  if (config.peak_days.includes(iso)) parts.push("peak rates apply");
  return parts.join(" · ");
}

/**
 * Where the calendar opens: the first month with a fair choice of bookable
 * days. When the season starts in the last few days of a month (31 October),
 * opening on that month shows a wall of greyed dates before one that can be
 * chosen (docs/research/06), so the following month is used instead.
 */
export function firstBookableMonth(config: FormConfig, minOpenDays = 5): Date {
  const first = isClosedDay(config.min_date, config) ? (nextOpenDayAfter(config.min_date, config) ?? config.min_date) : config.min_date;
  const start = parseDate(first);
  if (!start) return new Date();
  let openDays = 0;
  for (let d = start; d.getMonth() === start.getMonth(); d = addDays(d, 1)) {
    const iso = format(d, "yyyy-MM-dd");
    if (!inSeason(iso, config)) break;
    if (!isClosedDay(iso, config)) openDays += 1;
    if (openDays >= minOpenDays) return start;
  }
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1, 12);
  return config.max_date && format(next, "yyyy-MM-dd") > config.max_date ? start : next;
}

/** "Wednesday to Sunday, 31 October 2026 to 30 April 2027" for the hint. */
export function openingSentence(config: FormConfig): string {
  const openDays = WEEKDAYS.filter((d) => !config.closed_weekdays.includes(d.value)).map((d) => d.value);
  let days = "";
  if (openDays.length === 7) days = "every day";
  else if (openDays.length > 0) {
    // A contiguous run reads "Wednesday to Sunday"; anything else lists the days.
    const first = openDays[0]!;
    const last = openDays[openDays.length - 1]!;
    const contiguous = openDays.every((d, i) => d === first + i);
    days = contiguous && openDays.length > 2 ? `${WEEKDAYS[first]!.label} to ${WEEKDAYS[last]!.label}` : openDays.map((d) => WEEKDAYS[d]!.label).join(", ");
  }
  const span = config.max_date ? `${longDate(config.min_date)} to ${longDate(config.max_date)}` : `from ${longDate(config.min_date)}`;
  return days ? `${days}, ${span}` : span;
}

/**
 * When we promise to have replied: the first open weekday after the
 * submission day ("one working day"; the office follows the park's closed
 * weekdays). Returns ISO.
 */
export function replyByDate(submittedIso: string | null, closedWeekdays: number[]): string {
  const start = parseDate(submittedIso ?? todayIso()) ?? new Date();
  let candidate = addDays(start, 1);
  for (let i = 0; i < 7; i += 1) {
    const py = (candidate.getDay() + 6) % 7;
    if (!closedWeekdays.includes(py)) break;
    candidate = addDays(candidate, 1);
  }
  return format(candidate, "yyyy-MM-dd");
}
