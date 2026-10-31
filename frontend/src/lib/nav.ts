/**
 * Navigation model shared by the sidebar, the keyboard map and the guards
 * (owner's UI notes, 26 Oct 2026). One short list in Linda's words; Work is
 * an accordion whose children are its views with live counts.
 *
 *   Today      /today        admin + manager (the manager's home)
 *   Work       /work         admin   children: the Work views, counts from GET /work/counts
 *   Calendar   /calendar     admin + manager
 *   Bookings   /bookings     admin
 *   Enquiries  /enquiries    admin   count: open enquiries
 *   Settings   /settings     admin + manager (Users and System live inside; Mail, Bank and Gate are gone)
 */

import {
  AlertCircle,
  Bell,
  BookOpenText,
  CalendarDays,
  DoorOpen,
  Hourglass,
  Inbox,
  Landmark,
  ListChecks,
  Mail,
  MessageSquareText,
  Receipt,
  Settings2,
  Split,
  Sun,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/types/api";

export type NavCountKey = "work" | "enquiries";

export interface NavChild {
  title: string;
  /** Work view key; the link is /work?view=<key>. */
  view: string;
  icon: LucideIcon;
  /** Shown muted and last (stale). */
  muted?: boolean;
}

export interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
  roles: Role[];
  /** Match nested paths too (e.g. /bookings/123). Default true. */
  nested?: boolean;
  /** Extra paths that highlight this item (e.g. /day/:date → Today). */
  also?: string[];
  /** Which live count to show beside the label. */
  count?: NavCountKey;
  /** Second key of the `G <key>` shortcut. */
  key?: string;
  /** Accordion children (Work). */
  children?: NavChild[];
}

/** The Work views in the order Linda works them; counts come from /work/counts. */
export const WORK_CHILDREN: NavChild[] = [
  { title: "Requests", view: "new_requests", icon: Inbox },
  { title: "Enquiries", view: "enquiries", icon: MessageSquareText },
  { title: "Reply", view: "reply", icon: Mail },
  { title: "Verify payments", view: "pops", icon: Receipt },
  { title: "Assign mail", view: "allocate", icon: Split },
  { title: "Confirm money", view: "confirm_money", icon: Landmark },
  { title: "Send tickets", view: "send_tickets", icon: Ticket },
  { title: "Reminders", view: "reminders", icon: Bell },
  { title: "Holds lapsing", view: "holds", icon: Hourglass },
  { title: "Arrivals", view: "arrivals", icon: DoorOpen },
  { title: "Stale", view: "stale", icon: AlertCircle, muted: true },
];

export const NAV_MAIN: NavItem[] = [
  { title: "Today", to: "/today", icon: Sun, roles: ["admin", "manager"], also: ["/day"], key: "t" },
  { title: "Work", to: "/work", icon: ListChecks, roles: ["admin"], also: ["/queue"], count: "work", key: "w", children: WORK_CHILDREN },
  { title: "Calendar", to: "/calendar", icon: CalendarDays, roles: ["admin", "manager"], key: "c" },
  { title: "Bookings", to: "/bookings", icon: BookOpenText, roles: ["admin"], key: "b" },
  { title: "Enquiries", to: "/enquiries", icon: MessageSquareText, roles: ["admin"], count: "enquiries", key: "e" },
];

export const NAV_BOTTOM: NavItem[] = [
  { title: "Settings", to: "/settings", icon: Settings2, roles: ["admin", "manager"], also: ["/system", "/ops"] },
  { title: "Users", to: "/users", icon: Users, roles: ["admin"] },
];

/** Kept for the first build's callers: one group per list. */
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export function navForRole(role: Role): NavGroup[] {
  return [
    { title: "Main", items: NAV_MAIN.filter((item) => item.roles.includes(role)) },
    { title: "Admin", items: NAV_BOTTOM.filter((item) => item.roles.includes(role)) },
  ].filter((group) => group.items.length > 0);
}

/** Where a role lands after signing in or when it hits a page it may not see. */
export function homeFor(_role: Role): string {
  return "/today";
}

/**
 * Paths a manager may open; everything else redirects to homeFor("manager").
 * Managers get Today, Calendar, the legacy day redirect, and their personal
 * settings (Appearance, Password).
 */
export const MANAGER_PATHS = [
  /^\/$/,
  /^\/today(\/[^/]+)?$/,
  /^\/calendar(\/|$)/,
  /^\/day\/[^/]+$/,
  /^\/settings$/,
  /^\/settings\/(appearance|password)$/,
];

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.to) return true;
  if (item.nested !== false && item.to !== "/" && pathname.startsWith(`${item.to}/`)) return true;
  return (item.also ?? []).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Only allow same-origin relative paths as post-login redirect targets. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/login") || next.startsWith("/change-password")) {
    return null;
  }
  return next;
}
