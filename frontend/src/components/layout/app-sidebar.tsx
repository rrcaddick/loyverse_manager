/**
 * The sidebar (owner's UI notes, 26 Oct 2026): one short list in Linda's
 * words. Work is an accordion (the whole row toggles it) whose children are
 * its views with live counts on one right edge; Work itself carries no
 * total. Counts hide at zero. Settings
 * and Users at the bottom with the user menu. Collapses to an icon rail
 * (Ctrl/Cmd+B, the rail handle, or automatically on /calendar).
 */

import { ChevronDown } from "lucide-react";
import { useState, useEffect } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router";

import { Logo, LogoFY } from "@/components/brand/Logo";
import { CountBadge } from "@/components/count-badge";
import { UserMenu } from "@/components/layout/user-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useNavCounts } from "@/hooks/use-nav-counts";
import { useAuth } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { formatNumber } from "@/lib/format";
import { NAV_BOTTOM, NAV_MAIN, homeFor, isNavActive, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  // The lock-up shrinks to three quarters first, then the FY mark takes over (owner, 6 Nov 2026).
  const [logoPhase, setLogoPhase] = useState<"full" | "shrunk" | "mark">(collapsed ? "mark" : "full");
  useEffect(() => {
    // Two beats: shrink, then swap (both after the paint, never inside the effect itself).
    const first = window.setTimeout(() => setLogoPhase("shrunk"), 0);
    const second = window.setTimeout(() => setLogoPhase(collapsed ? "mark" : "full"), collapsed ? 170 : 40);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [collapsed]);
  const counts = useNavCounts();
  const location = useLocation();
  const onWork = pathname === "/work" || pathname.startsWith("/work/");
  // Open on Work, otherwise remember the last toggle (the render-time sync
  // pattern from the React docs, no effect needed).
  const [workToggle, setWorkToggle] = useState<boolean | null>(null);
  const [wasOnWork, setWasOnWork] = useState(onWork);
  if (onWork !== wasOnWork) {
    setWasOnWork(onWork);
    if (onWork) setWorkToggle(true);
  }
  const workOpen = workToggle ?? onWork;
  const setWorkOpen = setWorkToggle;
  if (!user) return null;
  const main = NAV_MAIN.filter((item) => item.roles.includes(user.role));
  const bottom = NAV_BOTTOM.filter((item) => item.roles.includes(user.role));
  const currentView = onWork ? params.get("view") : null;

  function renderItem(item: NavItem) {
    const active = isNavActive(item, pathname);
    const count = item.count ? counts[item.count] : null;
    const showCount = typeof count === "number" && count > 0;
    const tooltip = showCount ? `${item.title} · ${formatNumber(count)}` : item.title;
    const button = (
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={tooltip}
        className={cn(
          "relative h-10 gap-3 px-3 text-body [&_svg]:size-5 [@media(max-height:900px)]:h-9",
          "data-active:before:absolute data-active:before:top-2 data-active:before:bottom-2 data-active:before:left-0 data-active:before:w-[3px] data-active:before:rounded-r-full data-active:before:bg-primary",
          "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
        )}
      >
        <NavLink
          to={item.to}
          end={item.nested === false}
          aria-current={active ? "page" : undefined}
          aria-label={showCount ? `${item.title}, ${formatNumber(count)} to do` : undefined}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
            if (item.children) setWorkOpen(true);
          }}
        >
          <item.icon aria-hidden="true" className={cn("shrink-0", active ? "text-primary" : "text-sidebar-foreground/80")} />
          <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">{item.title}</span>
          {showCount ? (
            <CountBadge
              count={count}
              size="md"
              aria-hidden="true"
              className="ml-auto group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:h-2.5 group-data-[collapsible=icon]:w-2.5 group-data-[collapsible=icon]:min-w-0 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:text-[0px]"
            />
          ) : null}
        </NavLink>
      </SidebarMenuButton>
    );

    if (!item.children || state === "collapsed") {
      return <SidebarMenuItem key={item.to}>{button}</SidebarMenuItem>;
    }

    // Work: the whole row toggles the accordion (owner, 31 Oct 2026); the
    // views underneath are the links, each count on one right edge.
    return (
      <Collapsible key={item.to} open={workOpen} onOpenChange={setWorkOpen} asChild>
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              isActive={active}
              tooltip={item.title}
              aria-expanded={workOpen}
              className={cn(
                "relative h-10 gap-3 px-3 text-body [&_svg]:size-5 [@media(max-height:900px)]:h-9",
                "data-active:before:absolute data-active:before:top-2 data-active:before:bottom-2 data-active:before:left-0 data-active:before:w-[3px] data-active:before:rounded-r-full data-active:before:bg-primary",
              )}
            >
              <item.icon aria-hidden="true" className={cn("shrink-0", active ? "text-primary" : "text-sidebar-foreground/80")} />
              <span className="flex-1 truncate">{item.title}</span>
              <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-sidebar-foreground/70 transition-transform", workOpen && "rotate-180")} />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub className="mr-1 ml-4 gap-0 py-0.5 pr-0">
              {item.children.every((child) => (counts.workViews[child.view] ?? 0) === 0) && !currentView ? (
                <li className="px-2 py-1 text-sm text-muted-foreground">All clear</li>
              ) : null}
              {item.children.map((child) => {
                const n = counts.workViews[child.view] ?? 0;
                const to = child.to ?? `/work?view=${child.view}`;
                const childActive = child.to ? location.pathname + location.search === child.to || (child.to === "/enquiries" && location.pathname.startsWith("/enquiries")) : currentView === child.view;
                // A to-do list: a view with nothing in it steps aside (Work itself never does).
                if (n === 0 && !childActive) return null;
                return (
                  <SidebarMenuSubItem key={child.view}>
                    <SidebarMenuSubButton asChild isActive={childActive} className={cn("h-7 pr-1 text-sm", child.muted && "text-muted-foreground")}>
                      <NavLink to={to} aria-current={childActive ? "page" : undefined} onClick={() => isMobile && setOpenMobile(false)}>
                        <child.icon aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{child.title}</span>
                        {n > 0 ? <CountBadge count={n} tone={child.muted ? "muted" : "highlight"} aria-hidden="true" className="ml-auto shrink-0" /> : null}
                      </NavLink>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              })}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  }

  return (
    <Sidebar collapsible="icon" aria-label="Main">
      {/* Open: the full lock-up at the drawer's width with the app name under
          it and a corner button to collapse. Collapsed: the emblem (tree and
          gate cut from the logo) fills the rail and is itself the button that
          opens the drawer (owner's notes, 29 Oct 2026). */}
      <SidebarHeader className="relative border-b border-sidebar-border px-3 py-3 group-data-[collapsible=icon]:px-0.5 group-data-[collapsible=icon]:py-2">
        {logoPhase === "mark" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Open navigation"
                onClick={toggleSidebar}
                className="flex w-full justify-center rounded-md py-1 text-sidebar-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <LogoFY />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Open navigation</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="lg" className="h-auto flex-col items-stretch gap-2 px-2 py-2">
                  <NavLink to={homeFor(user.role)} aria-label={`${APP_NAME} home`}>
                    <Logo className={cn("w-full origin-center text-sidebar-foreground transition-transform duration-150", logoPhase === "shrunk" && "scale-75")} />
                    <span className="text-center text-sm font-semibold tracking-wide text-sidebar-foreground uppercase">{APP_NAME}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarTrigger aria-label="Collapse navigation" className="absolute top-1.5 right-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
          </>
        )}
      </SidebarHeader>

      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">{main.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-1 border-t border-sidebar-border pt-2">
        <SidebarMenu className="gap-0.5">{bottom.map(renderItem)}</SidebarMenu>
        <SidebarSeparator className="mx-0 my-1" />
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
