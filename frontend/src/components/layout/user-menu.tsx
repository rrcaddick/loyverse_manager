import { ChevronsUpDown, Keyboard, KeyRound, LogOut, Palette } from "lucide-react";
import { useNavigate } from "react-router";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useAppearance } from "@/lib/appearance";
import { roleLabel, useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";
import { useShell } from "@/layouts/shell-context";

export function UserMenu() {
  const { user, logout, isLoggingOut } = useAuth();
  const { isMobile } = useSidebar();
  const { openHelp } = useShell();
  const { appearance, themes } = useAppearance();
  const navigate = useNavigate();
  if (!user) return null;

  const themeName = themes.find((t) => t.id === appearance.theme)?.name ?? "Graphite";

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
                <AvatarFallback className="rounded-lg bg-primary-soft text-xs font-semibold text-primary">{initials(user.full_name)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-body font-medium">{user.full_name}</span>
                <span className="truncate text-xs text-muted-foreground">{roleLabel(user.role)}</span>
              </div>
              <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-60" side={isMobile ? "bottom" : "right"} align="end" sideOffset={6}>
            <DropdownMenuLabel className="font-normal">
              <div className="grid leading-tight">
                <span className="truncate text-body font-medium text-foreground">{user.full_name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => navigate("/settings/appearance")}>
                <Palette aria-hidden="true" />
                Appearance
                <DropdownMenuShortcut className="normal-case tracking-normal">{themeName}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/settings/password")}>
                <KeyRound aria-hidden="true" />
                Change password
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openHelp}>
                <Keyboard aria-hidden="true" />
                Keyboard shortcuts
                <DropdownMenuShortcut>?</DropdownMenuShortcut>
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
