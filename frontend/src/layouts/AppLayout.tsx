import { Suspense } from "react";
import { Outlet } from "react-router";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageSkeleton } from "@/components/page-skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

function readSidebarCookie(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.match(/(?:^|; )sidebar_state=(true|false)/);
  return match ? match[1] === "true" : true;
}

/** Authenticated shell: sidebar + header + page content. */
export function AppLayout() {
  return (
    <SidebarProvider defaultOpen={readSidebarCookie()}>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <AppHeader />
        <div id="main-content" className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
