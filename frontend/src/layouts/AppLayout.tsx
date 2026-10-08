/**
 * Authenticated shell: sidebar + header + page content.
 *
 * - The sidebar's open state is the person's own (cookie `sidebar_state`),
 *   except while a route or page forces the icon rail: /calendar does this
 *   through its route handle, any page can with `useSidebarCollapsed()`.
 *   A forced collapse never overwrites the cookie.
 * - Route handles may set `layout: "full"` to drop the page padding and give
 *   the page the full height under the header (the calendar's viewport fit).
 * - Global keys: G T/W/C/B/M navigate, ? opens the cheat sheet, / focuses
 *   search (in the header), Ctrl/Cmd+B toggles the sidebar (shadcn).
 */

import { Suspense, useCallback, useMemo, useState } from "react";
import { Outlet, useLocation, useMatches, useNavigate } from "react-router";

import { KeyboardCheatSheet } from "@/components/keyboard-cheat-sheet";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageSkeleton } from "@/components/page-skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useShortcut } from "@/hooks/use-keyboard";
import { SidebarForceContext, type SidebarForceContextValue } from "@/hooks/use-sidebar-collapsed";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

import { ShellContext, type ShellContextValue } from "./shell-context";

const SIDEBAR_COOKIE = "sidebar_state";

function readSidebarCookie(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.match(/(?:^|; )sidebar_state=(true|false)/);
  return match ? match[1] === "true" : true;
}

function writeSidebarCookie(open: boolean): void {
  document.cookie = `${SIDEBAR_COOKIE}=${open}; path=/; max-age=${60 * 60 * 24 * 365}`;
}

interface LayoutHandle {
  /** "full": no page padding, full height under the header. */
  layout?: "full" | "page";
  /** Collapse the sidebar to the icon rail on this route. */
  collapseSidebar?: boolean;
}

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const matches = useMatches();
  const { isAdmin } = useAuth();

  const handle = useMemo(() => {
    let merged: LayoutHandle = {};
    for (const match of matches) merged = { ...merged, ...((match.handle as LayoutHandle | undefined) ?? {}) };
    return merged;
  }, [matches]);

  // ---- sidebar: person's preference vs forced icon rail
  const [userOpen, setUserOpen] = useState(readSidebarCookie);
  const [forcedCount, setForcedCount] = useState(0);
  // A hand-made override while forced; it is keyed on the route so moving
  // between forced routes starts collapsed again.
  const [override, setOverride] = useState<{ key: string; open: boolean } | null>(null);
  const routeForced = handle.collapseSidebar === true || /^\/calendar(\/|$)/.test(location.pathname);
  const forced = routeForced || forcedCount > 0;
  const forceKey = `${location.pathname}:${forced}`;

  const open = forced ? (override?.key === forceKey ? override.open : false) : userOpen;
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (forced) {
        setOverride({ key: forceKey, open: next });
      } else {
        setUserOpen(next);
        writeSidebarCookie(next);
      }
    },
    [forced, forceKey],
  );

  const forceContext = useMemo<SidebarForceContextValue>(
    () => ({
      register: () => {
        setForcedCount((count) => count + 1);
        return () => setForcedCount((count) => Math.max(0, count - 1));
      },
    }),
    [],
  );

  // ---- keyboard
  const [helpOpen, setHelpOpen] = useState(false);
  const shell = useMemo<ShellContextValue>(() => ({ openHelp: () => setHelpOpen(true) }), []);
  useShortcut("?", () => setHelpOpen(true));
  useShortcut("g t", () => navigate("/today"));
  useShortcut("g c", () => navigate("/calendar"));
  useShortcut("g w", () => navigate("/work"), { enabled: isAdmin });
  useShortcut("g b", () => navigate("/bookings"), { enabled: isAdmin });
  useShortcut("g m", () => navigate("/mail"), { enabled: isAdmin });

  const full = handle.layout === "full";

  return (
    <ShellContext.Provider value={shell}>
      <SidebarForceContext.Provider value={forceContext}>
        <SidebarProvider open={open} onOpenChange={onOpenChange}>
          <AppSidebar />
          <SidebarInset className="min-w-0">
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:text-primary-foreground"
            >
              Skip to content
            </a>
            <AppHeader />
            <div
              id="main-content"
              className={cn(
                "flex min-w-0 flex-1 flex-col",
                full
                  ? "h-[calc(100dvh-var(--spacing-header))] min-h-0 overflow-hidden"
                  : "mx-auto w-full max-w-page gap-card-gap px-4 py-5 sm:px-6 lg:px-gutter",
              )}
            >
              <Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </Suspense>
            </div>
          </SidebarInset>
          <KeyboardCheatSheet open={helpOpen} onOpenChange={setHelpOpen} />
        </SidebarProvider>
      </SidebarForceContext.Provider>
    </ShellContext.Provider>
  );
}
