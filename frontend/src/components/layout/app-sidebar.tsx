import { NavLink, useLocation } from "react-router";

import { LogoMark } from "@/components/brand/Logo";
import { UserMenu } from "@/components/layout/user-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { APP_NAME, PARK_NAME } from "@/lib/brand";
import { homeFor, isNavActive, navForRole } from "@/lib/nav";

export function AppSidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  if (!user) return null;
  const groups = navForRole(user.role);

  return (
    <Sidebar collapsible="icon" aria-label="Main">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={APP_NAME} className="gap-2.5 group-data-[collapsible=icon]:justify-center">
              <NavLink to={homeFor(user.role)} aria-label={`${APP_NAME} home`}>
                <LogoMark className="size-7 shrink-0 text-sidebar-foreground" />
                <span className="grid leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-semibold text-sidebar-foreground">{APP_NAME}</span>
                  <span className="truncate text-xs text-muted-foreground">{PARK_NAME}</span>
                </span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isNavActive(item, pathname);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <NavLink
                          to={item.to}
                          end={item.nested === false}
                          aria-current={active ? "page" : undefined}
                          onClick={() => isMobile && setOpenMobile(false)}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
