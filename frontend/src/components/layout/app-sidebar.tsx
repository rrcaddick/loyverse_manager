/**
 * The sidebar (owner's UI notes, 26 Oct 2026): one short list in Linda's
 * words. Work is an accordion whose children are its views with live counts,
 * so the queue has no second menu of its own. Counts hide at zero. Settings
 * and Users at the bottom with the user menu. Collapses to an icon rail
 * (Ctrl/Cmd+B, the rail handle, or automatically on /calendar).
 */

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router";

import { LogoMark } from "@/components/brand/Logo";
import { UserMenu } from "@/components/layout/user-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { useNavCounts } from "@/hooks/use-nav-counts";
import { useAuth } from "@/lib/auth";
import { APP_NAME, PARK_NAME } from "@/lib/brand";
import { formatNumber } from "@/lib/format";
import { NAV_BOTTOM, NAV_MAIN, homeFor, isNavActive, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

function CountBadge({ count, tone = "primary" }: { count: number; tone?: "primary" | "muted" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular",
        tone === "primary" ? "bg-sidebar-primary text-sidebar-primary-foreground" : "bg-sidebar-primary/70 text-sidebar-primary-foreground",
      )}
    >
      {formatNumber(count)}
    </span>
  );
}

export function AppSidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const counts = useNavCounts();
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
  const currentView = onWork ? (params.get("view") ?? "up_next") : null;

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
          "relative h-10 gap-3 px-3 text-body [&_svg]:size-5",
          // The active page is a filled item (ladder D): primary fill, white text.
          "data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:hover:bg-sidebar-primary data-active:hover:text-sidebar-primary-foreground",
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
          <item.icon aria-hidden="true" className={cn("shrink-0", active ? "text-sidebar-primary-foreground" : "text-sidebar-muted")} />
          <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">{item.title}</span>
          {showCount ? (
            <span
              aria-hidden="true"
              className={cn(
                "ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-xs font-semibold text-sidebar-primary-foreground tabular ring-2 ring-sidebar",
                "group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:h-2.5 group-data-[collapsible=icon]:min-w-0 group-data-[collapsible=icon]:w-2.5 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:text-[0px]",
              )}
            >
              {formatNumber(count)}
            </span>
          ) : null}
        </NavLink>
      </SidebarMenuButton>
    );

    if (!item.children || state === "collapsed") {
      return <SidebarMenuItem key={item.to}>{button}</SidebarMenuItem>;
    }

    return (
      <Collapsible key={item.to} open={workOpen} onOpenChange={setWorkOpen} asChild>
        <SidebarMenuItem>
          <div className="relative">
            {button}
            <CollapsibleTrigger asChild>
              <button
                type="button"
                aria-label={workOpen ? `Collapse ${item.title}` : `Expand ${item.title}`}
                className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", workOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <SidebarMenuSub className="mx-4 gap-0.5 py-1">
              {item.children.map((child) => {
                const n = counts.workViews[child.view] ?? 0;
                if (child.muted && n === 0) return null;
                const childActive = currentView === child.view;
                return (
                  <SidebarMenuSubItem key={child.view}>
                    <SidebarMenuSubButton asChild isActive={childActive} className={cn("h-8 text-sm text-sidebar-muted data-active:font-semibold data-active:text-sidebar-foreground", child.muted && "opacity-80")}>
                      <NavLink to={child.view === "up_next" ? "/work" : `/work?view=${child.view}`} aria-current={childActive ? "page" : undefined} onClick={() => isMobile && setOpenMobile(false)}>
                        <child.icon aria-hidden="true" />
                        <span className="flex-1 truncate">{child.title}</span>
                        {n > 0 ? <CountBadge count={n} tone={child.muted ? "muted" : "primary"} /> : null}
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
      <SidebarHeader className="h-header justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={APP_NAME} className="gap-2.5 group-data-[collapsible=icon]:justify-center">
              <NavLink to={homeFor(user.role)} aria-label={`${APP_NAME} home`}>
                <LogoMark className="size-7 shrink-0 text-sidebar-foreground" />
                <span className="grid leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-body font-semibold text-sidebar-foreground">{APP_NAME}</span>
                  <span className="truncate text-xs text-sidebar-muted">{PARK_NAME}</span>
                </span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
