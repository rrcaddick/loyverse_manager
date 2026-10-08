/**
 * Formatting helpers. All dates render in Africa/Johannesburg regardless of
 * the browser's zone, matching src.utils.date on the server.
 *
 *   formatMoney(3800)            → "R 3 800.00"
 *   formatDate("2026-12-25")     → "25 Dec 2026"
 *   formatDateTime(iso)          → "25 Dec 2026, 14:05"
 *   formatPhone("27814614246")   → "081 461 4246"
 *   pluralise(3, "person", "people") → "3 people"
 */

import { differenceInCalendarDays, isValid, parseISO } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

export const TIME_ZONE = "Africa/Johannesburg";

/** U+2009 thin space, the thousands separator used throughout. */
export const THIN_SPACE = " ";
/** U+2212 minus sign; reads better than a hyphen next to tabular digits. */
const MINUS = "−";

type DateInput = string | number | Date | null | undefined;

// ---------------------------------------------------------------- numbers

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

export interface MoneyOptions {
  /** Hide the ".00" when the amount is whole. Default false. */
  compact?: boolean;
  /** Omit the "R " prefix. Default false. */
  bare?: boolean;
  /** Text for null/undefined. Default "—". */
  empty?: string;
}

/** "R 1 234.00" with a thin-space thousands separator. */
export function formatMoney(value: number | string | null | undefined, options: MoneyOptions = {}): string {
  const n = toNumber(value);
  if (n === null) return options.empty ?? "—";
  const abs = Math.abs(n);
  const whole = options.compact && Number.isInteger(abs);
  const fixed = abs.toFixed(whole ? 0 : 2);
  const [integer = "0", decimals] = fixed.split(".");
  const digits = decimals ? `${groupThousands(integer)}.${decimals}` : groupThousands(integer);
  const sign = n < 0 ? MINUS : "";
  return options.bare ? `${sign}${digits}` : `${sign}R${THIN_SPACE}${digits}`;
}

/** "1 234" — integers and counts. */
export function formatNumber(value: number | string | null | undefined, decimals = 0): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const fixed = Math.abs(n).toFixed(decimals);
  const [integer = "0", frac] = fixed.split(".");
  const body = frac ? `${groupThousands(integer)}.${frac}` : groupThousands(integer);
  return `${n < 0 ? MINUS : ""}${body}`;
}

/** "15%" or "12.5%". */
export function formatPercent(value: number | string | null | undefined, decimals = 0): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${formatNumber(n, decimals)}%`;
}

// ------------------------------------------------------------------ dates

/**
 * Parse an ISO string. Date-only strings ("2026-12-25") are treated as a
 * calendar day in Africa/Johannesburg, not as UTC midnight.
 */
export function parseDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value === "number") return new Date(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseISO(`${value}T12:00:00`) : parseISO(value);
  return isValid(date) ? date : null;
}

function fmt(value: DateInput, pattern: string, empty = "—"): string {
  const date = parseDate(value);
  return date ? formatInTimeZone(date, TIME_ZONE, pattern) : empty;
}

/** "25 Dec 2026" */
export const formatDate = (value: DateInput) => fmt(value, "d MMM yyyy");
/** "Friday, 25 December 2026" */
export const formatDateLong = (value: DateInput) => fmt(value, "EEEE, d MMMM yyyy");
/** "Fri 25 Dec" */
export const formatDateShort = (value: DateInput) => fmt(value, "EEE d MMM");
/** "25 Dec" */
export const formatDayMonth = (value: DateInput) => fmt(value, "d MMM");
/** "25 Dec 2026, 14:05" */
export const formatDateTime = (value: DateInput) => fmt(value, "d MMM yyyy, HH:mm");
/** "14:05" */
export const formatTime = (value: DateInput) => fmt(value, "HH:mm");
/** "Friday" */
export const formatWeekday = (value: DateInput) => fmt(value, "EEEE");
/** "December 2026" */
export const formatMonthYear = (value: DateInput) => fmt(value, "MMMM yyyy");
/** "2026-12-25" — the API's date shape, in the park's zone. */
export const toIsoDate = (value: DateInput) => fmt(value, "yyyy-MM-dd", "");

/** Today's calendar date in Africa/Johannesburg as "YYYY-MM-DD". */
export function todayIso(): string {
  return formatInTimeZone(new Date(), TIME_ZONE, "yyyy-MM-dd");
}

/** "Today", "Tomorrow", "Yesterday", "In 3 days", "4 days ago", else the date. */
export function formatRelativeDay(value: DateInput): string {
  const date = parseDate(value);
  if (!date) return "—";
  const today = toZonedTime(new Date(), TIME_ZONE);
  const target = toZonedTime(date, TIME_ZONE);
  const diff = differenceInCalendarDays(target, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff <= 14) return `In ${diff} days`;
  if (diff < -1 && diff >= -14) return `${-diff} days ago`;
  return formatDate(date);
}

/** "25 Dec 2026, 14:05 (2 days ago)"-style pairing for audit trails. */
export function formatDateTimeRelative(value: DateInput): string {
  const date = parseDate(value);
  if (!date) return "—";
  return `${formatDateTime(date)} (${formatRelativeDay(date)})`;
}

/** Weekday names indexed by Python weekday number (0 = Monday). */
export const WEEKDAYS: { value: number; label: string; short: string }[] = [
  { value: 0, label: "Monday", short: "Mon" },
  { value: 1, label: "Tuesday", short: "Tue" },
  { value: 2, label: "Wednesday", short: "Wed" },
  { value: 3, label: "Thursday", short: "Thu" },
  { value: 4, label: "Friday", short: "Fri" },
  { value: 5, label: "Saturday", short: "Sat" },
  { value: 6, label: "Sunday", short: "Sun" },
];

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "12-13" → "13 December" */
export function formatMonthDay(value: string | null | undefined): string {
  if (!value) return "—";
  const [mm, dd] = value.split("-").map(Number);
  if (!mm || !dd || mm < 1 || mm > 12) return value;
  return `${dd} ${MONTHS[mm - 1]}`;
}

// ------------------------------------------------------------------ phone

/**
 * South African national format. Accepts E.164 digits ("27814614246"),
 * "+27 81 461 4246", "0814614246" or already-spaced numbers.
 * Returns the input unchanged when it does not look like a ZA number.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "—";
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("27") && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return value;
}

/** Digits-only E.164 without "+", as the API stores it ("27814614246"). */
export function toE164Digits(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  return digits;
}

// ------------------------------------------------------------------- text

/** pluralise(1, "person", "people") → "1 person"; counts are thin-spaced. */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** "Jane Doe" → "JD"; "jane@x.com" → "J". */
export function initials(name: string | null | undefined, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || fallback;
}

export function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "proforma_sent" → "Proforma sent" */
export function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Duration in ms → "1.2 s" / "340 ms" / "2 min 5 s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
