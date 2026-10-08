/**
 * Non-visual helpers shared by the calendar, day, list and detail pages:
 * group-type labels (settings-gated), provenance wording, hold-expiry state.
 */

import { useQuery } from "@tanstack/react-query";

import { daysBetween } from "@/features/calendar/month";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatRelativeDay, humanise, todayIso } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import type { BookingStatus, SettingsResponse } from "@/types/api";

import { SOURCE_LABELS, TENTATIVE_STATUSES, type BookingRow, type BookingSource } from "./types";

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
}

/** Only tentative bookings have a meaningful hold. */
export function holdState(booking: Pick<BookingRow, "status" | "hold_expires_on">): HoldState | null {
  if (!booking.hold_expires_on || !TENTATIVE_STATUSES.includes(booking.status)) return null;
  const daysLeft = daysBetween(todayIso(), booking.hold_expires_on);
  const date = formatDate(booking.hold_expires_on);
  if (daysLeft < 0) return { daysLeft, tone: "red", text: `Hold expired ${-daysLeft === 1 ? "yesterday" : `${-daysLeft} days ago`} (${date})` };
  if (daysLeft === 0) return { daysLeft, tone: "red", text: `Hold expires today (${date})` };
  if (daysLeft <= 7) return { daysLeft, tone: "amber", text: `Hold expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"} (${date})` };
  return { daysLeft, tone: "neutral", text: `Hold until ${date}` };
}

export function isTentative(status: BookingStatus): boolean {
  return TENTATIVE_STATUSES.includes(status);
}

/** "Saturday, 7 Nov 2026" style used in headers. */
export function peopleSummary(b: Pick<BookingRow, "adults" | "children" | "people_booked">): string {
  if (b.adults || b.children) {
    const parts: string[] = [];
    if (b.adults) parts.push(`${b.adults} adult${b.adults === 1 ? "" : "s"}`);
    if (b.children) parts.push(`${b.children} child${b.children === 1 ? "" : "ren"}`);
    return parts.join(", ");
  }
  return "";
}

/** "In 3 days" / "Today" only; empty when the relative form is just the date again. */
export function relativeDayLabel(iso: string): string {
  const rel = formatRelativeDay(iso);
  return /\d{4}/.test(rel) ? "" : rel;
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
