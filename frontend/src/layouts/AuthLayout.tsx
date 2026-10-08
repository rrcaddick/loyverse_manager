import type { ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME, PARK_LEGAL_NAME } from "@/lib/brand";

/** Centred single card for sign-in and password flows. */
export function AuthLayout({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <Logo className="h-14 text-foreground" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
          </div>
          <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">{children}</div>
        </div>
      </main>
      <footer className="flex items-center justify-between px-6 py-4 text-xs text-muted-foreground">
        <span>
          {APP_NAME} · {PARK_LEGAL_NAME}
        </span>
        <ThemeToggle />
      </footer>
    </div>
  );
}
