/**
 * Navigation model shared by the sidebar, breadcrumbs and the command menu.
 * Managers only ever see the calendar group; the role filter lives here so
 * every surface agrees.
 */

import {
  Activity,
  Banknote,
  BookOpenText,
  CalendarDays,
  Inbox,
  ListChecks,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/types/api";

export interface NavItem {
  title: string;
  to: string;
  icon: LucideIcon;
  roles: Role[];
  /** Match nested paths too (e.g. /bookings/123). Default true. */
  nested?: boolean;
  /** Extra paths that highlight this item (e.g. /day/:date → Calendar). */
  also?: string[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Work",
    items: [
      { title: "Queue", to: "/", icon: ListChecks, roles: ["admin"], nested: false },
      { title: "Calendar", to: "/calendar", icon: CalendarDays, roles: ["admin", "manager"], also: ["/day"] },
      { title: "Bookings", to: "/bookings", icon: BookOpenText, roles: ["admin"] },
      { title: "Inbox", to: "/inbox", icon: Inbox, roles: ["admin"] },
      { title: "Payments", to: "/payments", icon: Banknote, roles: ["admin"] },
    ],
  },
  {
    title: "Admin",
    items: [
      { title: "Settings", to: "/settings", icon: Settings2, roles: ["admin"] },
      { title: "Users", to: "/users", icon: Users, roles: ["admin"] },
      { title: "Ops", to: "/ops", icon: Activity, roles: ["admin"] },
    ],
  },
];

export function navForRole(role: Role): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}

/** Where a role lands after signing in or when it hits a page it may not see. */
export function homeFor(role: Role): string {
  return role === "manager" ? "/calendar" : "/";
}

/** Paths a manager may open; everything else redirects to homeFor("manager"). */
export const MANAGER_PATHS = [/^\/calendar(\/|$)/, /^\/day\/[^/]+$/];

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
