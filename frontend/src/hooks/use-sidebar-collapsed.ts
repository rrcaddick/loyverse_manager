/**
 * Collapse the sidebar to its icon rail while a page is mounted.
 *
 *   useSidebarCollapsed();          // always, e.g. the calendar
 *   useSidebarCollapsed(isWide);    // conditionally
 *
 * The forced state does not touch the person's own preference: when the page
 * unmounts (or `force` turns false) the sidebar returns to how they left it.
 * They can still expand it by hand while forced. AppLayout applies this
 * automatically on /calendar, so the calendar page need not call it.
 */

import { createContext, useContext, useEffect } from "react";

export interface SidebarForceContextValue {
  /** Registers a force-collapse; returns the release function. */
  register: () => () => void;
}

export const SidebarForceContext = createContext<SidebarForceContextValue | null>(null);

export function useSidebarCollapsed(force = true): void {
  const ctx = useContext(SidebarForceContext);
  useEffect(() => {
    if (!force || !ctx) return;
    return ctx.register();
  }, [force, ctx]);
}
