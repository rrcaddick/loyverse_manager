/**
 * Navigation model shared by the sidebar, the keyboard map and the guards
 * (docs/redesign-spec.md §1). One flat list in Linda's words; counts only on
 * Work, Mail and Bank; Settings, Users and System at the bottom.
 *
 *   Today   /today     admin + manager (the manager's home)
 *   Work    /work      admin          count: GET /work/counts
 *   Calendar /calendar admin + manager
 *   Bookings /bookings admin
 *   Mail    /mail      admin          count: conversations needing a reply
 *   Bank    /bank      admin          count: credits to confirm
 *   Gate    /gate      admin + manager
 */

import {
  Activity,
  BookOpenText,
  CalendarDays,
  DoorOpen,
  Landmark,
  ListChecks,
  Mail,
  Settings2,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/types/api";

export type NavCountKey = "work" | "mail" | "bank";

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
}

export const NAV_MAIN: NavItem[] = [
  { title: "Today", to: "/today", icon: Sun, roles: ["admin", "manager"], also: ["/day"], key: "t" },
  { title: "Work", to: "/work", icon: ListChecks, roles: ["admin"], also: ["/queue"], count: "work", key: "w" },
  { title: "Calendar", to: "/calendar", icon: CalendarDays, roles: ["admin", "manager"], key: "c" },
  { title: "Bookings", to: "/bookings", icon: BookOpenText, roles: ["admin"], key: "b" },
  { title: "Mail", to: "/mail", icon: Mail, roles: ["admin"], also: ["/inbox"], count: "mail", key: "m" },
  { title: "Bank", to: "/bank", icon: Landmark, roles: ["admin"], also: ["/payments"], count: "bank" },
  { title: "Gate", to: "/gate", icon: DoorOpen, roles: ["admin", "manager"] },
];

export const NAV_BOTTOM: NavItem[] = [
  { title: "Settings", to: "/settings", icon: Settings2, roles: ["admin", "manager"] },
  { title: "Users", to: "/users", icon: Users, roles: ["admin"] },
  { title: "System", to: "/system", icon: Activity, roles: ["admin"], also: ["/ops"] },
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
 * Managers get Today, Calendar, Gate, the legacy day redirect, and their
 * personal settings (Appearance, Password).
 */
export const MANAGER_PATHS = [
  /^\/$/,
  /^\/today(\/[^/]+)?$/,
  /^\/calendar(\/|$)/,
  /^\/gate(\/|$)/,
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
