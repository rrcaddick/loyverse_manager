import { Suspense } from "react";
import { Outlet } from "react-router";

import { Logo } from "@/components/brand/Logo";
import { PageSkeleton } from "@/components/page-skeleton";
import { PARK_CONTACT, PARK_LEGAL_NAME, PARK_NAME } from "@/lib/brand";

/** Public pages (/request): no sidebar, centred column, park footer. */
export function PublicLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <a href={PARK_CONTACT.websiteHref} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`${PARK_NAME} website`}>
            <Logo className="h-9 text-foreground" />
          </a>
          <a href={PARK_CONTACT.phoneHref} className="text-sm text-muted-foreground tabular hover:text-foreground">
            {PARK_CONTACT.phone}
          </a>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            {PARK_LEGAL_NAME} · {PARK_CONTACT.addressLine1}, {PARK_CONTACT.addressLine2}
          </div>
          <div className="flex gap-4">
            <a href={PARK_CONTACT.phoneHref} className="tabular hover:text-foreground">
              {PARK_CONTACT.phone}
            </a>
            <a href={PARK_CONTACT.websiteHref} className="hover:text-foreground">
              {PARK_CONTACT.website}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
