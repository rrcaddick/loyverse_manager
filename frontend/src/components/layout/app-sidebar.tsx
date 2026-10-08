/**
 * The sidebar (docs/redesign-spec.md §1): one flat list in Linda's words,
 * live counts on Work, Mail and Bank (hidden at zero), Settings · Users ·
 * System at the bottom with the user menu. Collapses to an icon rail
 * (Ctrl/Cmd+B, the rail handle, or automatically on /calendar).
 */

import { NavLink, useLocation } from "react-router";

import { LogoMark } from "@/components/brand/Logo";
import { UserMenu } from "@/components/layout/user-menu";
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

export function AppSidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const counts = useNavCounts();
  if (!user) return null;
  const main = NAV_MAIN.filter((item) => item.roles.includes(user.role));
  const bottom = NAV_BOTTOM.filter((item) => item.roles.includes(user.role));

  function renderItem(item: NavItem) {
    const active = isNavActive(item, pathname);
    const count = item.count ? counts[item.count] : null;
    const showCount = typeof count === "number" && count > 0;
    const tooltip = showCount ? `${item.title} · ${formatNumber(count)}` : item.title;
    return (
      <SidebarMenuItem key={item.to}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={tooltip}
          className={cn(
            "relative h-10 gap-3 px-3 text-body [&_svg]:size-5",
            "data-active:before:absolute data-active:before:top-2 data-active:before:bottom-2 data-active:before:left-0 data-active:before:w-[3px] data-active:before:rounded-r-full data-active:before:bg-primary",
            "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
          )}
        >
          <NavLink
            to={item.to}
            end={item.nested === false}
            aria-current={active ? "page" : undefined}
            aria-label={showCount ? `${item.title}, ${formatNumber(count)} to do` : undefined}
            onClick={() => isMobile && setOpenMobile(false)}
          >
            <item.icon aria-hidden="true" className={cn("shrink-0", active ? "text-primary" : "text-sidebar-foreground/80")} />
            <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">{item.title}</span>
            {showCount ? (
              <span
                aria-hidden="true"
                className={cn(
                  "ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular",
                  "group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:h-2.5 group-data-[collapsible=icon]:min-w-0 group-data-[collapsible=icon]:w-2.5 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:text-[0px]",
                )}
              >
                {formatNumber(count)}
              </span>
            ) : null}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
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
                  <span className="truncate text-xs text-muted-foreground">{PARK_NAME}</span>
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
