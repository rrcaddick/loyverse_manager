import { ChevronsUpDown, KeyRound, LogOut, Palette } from "lucide-react";
import { useNavigate } from "react-router";

import { ThemeMenuItems } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { roleLabel, useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";

export function UserMenu() {
  const { user, logout, isLoggingOut } = useAuth();
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  if (!user) return null;

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              aria-label={`Account menu for ${user.full_name}`}
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                  {initials(user.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{user.full_name}</span>
                <span className="truncate text-xs text-muted-foreground">{roleLabel(user.role)}</span>
              </div>
              <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={6}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="grid leading-tight">
                <span className="truncate text-sm font-medium text-foreground">{user.full_name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Palette aria-hidden="true" />
                  Theme
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <ThemeMenuItems />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => navigate("/change-password")}>
                <KeyRound aria-hidden="true" />
                Change password
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout} disabled={isLoggingOut}>
              <LogOut aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
