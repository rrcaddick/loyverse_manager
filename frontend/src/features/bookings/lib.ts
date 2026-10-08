/**
 * Non-visual helpers shared by the calendar, day, list and detail pages:
 * group-type labels (settings-gated), provenance wording, hold-expiry state,
 * relative-day phrasing for facts lines.
 */

import { useQuery } from "@tanstack/react-query";

import { daysBetween } from "@/features/calendar/month";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDayMonth, formatRelativeDay, humanise, todayIso } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import type { BookingStatus, SettingsResponse } from "@/types/api";

import { SOURCE_LABELS, TENTATIVE_STATUSES, type BookingDetail, type BookingRow, type BookingSource } from "./types";

/** GET /settings is admin-only; managers get humanised codes instead. */
export function useGroupTypes() {
  const { isAdmin } = useAuth();
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<SettingsResponse>("/settings"),
    staleTime: 60_000,
    enabled: isAdmin,
    select: (data) => data.settings.form.group_types,
  });
}

/** Group type code → label, from settings when the user may read them. */
export function useGroupTypeLabel(): (code: string | null | undefined) => string {
  const types = useGroupTypes().data;
  return (code) => {
    if (!code) return "—";
    return types?.find((t) => t.code === code)?.label ?? humanise(code);
  };
}

export function sourceLabel(source: BookingSource): string {
  return SOURCE_LABELS[source] ?? humanise(source);
}

export interface HoldState {
  /** Days until the hold lapses; negative when already past. */
  daysLeft: number;
  tone: "neutral" | "amber" | "red";
  text: string;
  /** "in 2 days" / "today" / "3 days ago" */
  relative: string;
}

/** Only tentative bookings have a meaningful hold. */
export function holdState(booking: Pick<BookingRow, "status" | "hold_expires_on">): HoldState | null {
  if (!booking.hold_expires_on || !TENTATIVE_STATUSES.includes(booking.status)) return null;
  const daysLeft = daysBetween(todayIso(), booking.hold_expires_on);
  const date = formatDate(booking.hold_expires_on);
  const relative = relativeDays(daysLeft);
  if (daysLeft < 0) return { daysLeft, tone: "red", text: `Hold expired ${relative} (${date})`, relative };
  if (daysLeft === 0) return { daysLeft, tone: "red", text: `Hold expires today (${date})`, relative };
  if (daysLeft <= 3) return { daysLeft, tone: "amber", text: `Hold expires ${relative} (${date})`, relative };
  return { daysLeft, tone: "neutral", text: `Hold until ${date}`, relative };
}

export function isTentative(status: BookingStatus): boolean {
  return TENTATIVE_STATUSES.includes(status);
}

/** "in 58 days", "tomorrow", "today", "yesterday", "3 days ago" — lowercase, for facts lines. */
export function relativeDays(diff: number): string {
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1) return `in ${diff} days`;
  return `${-diff} days ago`;
}

/** Days from today to an ISO date (negative when past). */
export function daysFromToday(iso: string): number {
  return daysBetween(todayIso(), iso);
}

/** "in 58 days" for a date, lowercase. */
export function relativeTo(iso: string): string {
  return relativeDays(daysFromToday(iso));
}

/** "In 3 days" / "Today" only; empty when the relative form is just the date again. */
export function relativeDayLabel(iso: string): string {
  const rel = formatRelativeDay(iso);
  return /\d{4}/.test(rel) ? "" : rel;
}

/** "due 28 Nov" style short date. */
export function shortDate(iso: string | null | undefined): string {
  return iso ? formatDayMonth(iso) : "—";
}

/** Reason recorded with the most recent status change, when any. */
export function lastStatusReason(b: BookingDetail): string | null {
  for (let i = b.events.length - 1; i >= 0; i -= 1) {
    const e = b.events[i]!;
    if (e.kind === "status_changed") {
      const reason = e.data?.reason;
      return typeof reason === "string" && reason.trim() ? reason.trim() : null;
    }
  }
  return null;
}

/** Plain paragraphs → safe HTML (escaped, <p> per blank-line block, <br> per newline). */
export function paragraphsToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p>${escape(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
