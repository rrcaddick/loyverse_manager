/**
 * Words for the group matcher's signals and the history summary (2 Nov 2026).
 * The numbers come from the server (src/services/groups.py); this only reads them back.
 */

import { format } from "date-fns";

import { parseDate, pluralise } from "@/lib/format";

import type { BookingDetail, GroupSuggestion, HistorySummary } from "./types";

const WHY: Record<string, string> = {
  email: "same email address",
  mobile: "same mobile number",
  reference: "their message quotes the earlier reference",
  "previous name": "they say they visited before under this name",
  "previous name (part)": "they say they visited before under a similar name",
  name: "same name",
  "name (part)": "similar name",
  area: "same area",
  "email domain": "same email domain",
  "different name": "booked under a different name",
};

export function whyText(why: string[]): string {
  const parts = why.map((w) => WHY[w] ?? w);
  if (parts.length === 0) return "";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function monthYear(iso: string | null | undefined): string {
  const d = parseDate(iso ?? null);
  return d ? format(d, "MMMM yyyy") : "";
}

/** "FY1473 Mondale High, October 2026" */
export function suggestionLabel(s: GroupSuggestion): string {
  const ref = s.last?.reference ? `${s.last.reference} ` : "";
  const when = s.last?.visit_date ? `, ${monthYear(s.last.visit_date)}` : "";
  return `${ref}${s.name}${when}`;
}

const EXIT_WORDS: Record<string, [string, string]> = {
  cancelled: ["cancelled", "cancelled"],
  lapsed: ["expired", "expired"],
  no_show: ["no-show", "no-shows"],
  declined: ["declined", "declined"],
};

/** Short sentences for the Overview card and the History tab's group section. */
export function summaryLines(summary: HistorySummary | null): string[] {
  if (!summary) return [];
  const lines: string[] = [];
  const since = summary.first_year ? ` since ${summary.first_year}` : "";
  const exits = Object.entries(summary.exits)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([status, n]) => `${n} ${EXIT_WORDS[status]?.[n === 1 ? 0 : 1] ?? status}`);
  if (summary.visits > 0) {
    lines.push(`${pluralise(summary.visits, "visit")}${since}, ${exits.length ? exits.join(", ") : "never cancelled"}.`);
  } else if (exits.length) {
    lines.push(`Never visited: ${exits.join(", ")}${since}.`);
  }
  const last = summary.last;
  if (last) {
    const when = last.visit_date ? ` (${monthYear(last.visit_date)})` : "";
    const people = last.arrived !== null && last.booked ? `booked ${last.booked}, ${last.arrived} arrived` : last.booked ? `booked ${last.booked}` : "";
    if (people) lines.push(`Last time${when}: ${people}.`);
  }
  if (summary.deposit_days_avg !== null) {
    const onTime = summary.deposit_on_time;
    const timing = onTime ? (onTime.on_time === onTime.of ? "on time" : onTime.on_time === 0 ? "late" : `${onTime.on_time} of ${onTime.of} on time`) : "";
    lines.push(`Deposit ${summary.deposit_days_avg === 0 ? "the same day as" : `${pluralise(summary.deposit_days_avg, "day")} after`} the proforma${timing ? `, ${timing}` : ""}.`);
  }
  if (last?.settled === "before") lines.push("Balance paid before the day.");
  else if (last?.settled === "on the day") lines.push("Balance paid on the day.");
  else if (last?.settled === "after") lines.push("Balance paid after the visit.");
  else if (last?.settled === "short") lines.push("Last visit was never paid in full.");
  if (summary.reminders_total > 0) lines.push(`Needed ${pluralise(summary.reminders_total, "reminder")}.`);
  lines.push(summary.same_person ? "Same person booking." : "A different person booked before.");
  return lines;
}

/** A booking whose visit is behind it, in whichever way: Rebook starts the next one from it. */
export function isPastBooking(booking: BookingDetail, todayIso: string): boolean {
  if (["completed", "cancelled", "lapsed", "no_show", "declined"].includes(booking.status)) return true;
  return booking.visit_date < todayIso;
}
