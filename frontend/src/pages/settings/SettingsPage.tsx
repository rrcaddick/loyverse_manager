/**
 * /settings/:section — Settings with a left rail (spec §2, §10):
 *
 *   Park              Season · Pricing & deposits
 *   Documents & mail  Documents · Email · Reminders · Templates
 *   Public            Booking form
 *   Personal          Appearance · Password
 *   Admin             Users · System (links)
 *
 * Pages are two-column: heading and one sentence on the left, the card of
 * fields on the right (every <Section> inside adopts the split layout
 * through SectionLayoutContext). Saving is the sticky bar "Unsaved changes ·
 * Discard · Save". Managers see Personal only.
 */

import { AlertCircle, ArrowUpRight } from "lucide-react";
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, NavLink, useParams } from "react-router";

import { PageHeader } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { SectionLayoutContext } from "@/components/section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSettings } from "@/features/settings/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { Role, SettingsResponse } from "@/types/api";

export interface SettingsTabProps {
  data: SettingsResponse;
}

interface SettingsSection {
  value: string;
  label: string;
  roles: Role[];
  /** "settings": needs GET /settings; "page": self-contained; "link": elsewhere. */
  kind: "settings" | "page" | "link";
  component?: LazyExoticComponent<ComponentType<SettingsTabProps>> | LazyExoticComponent<ComponentType>;
  to?: string;
}

interface SettingsGroup {
  title: string;
  items: SettingsSection[];
}

const ADMIN: Role[] = ["admin"];
const EVERYONE: Role[] = ["admin", "manager"];

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: "Park",
    items: [
      { value: "season", label: "Season", roles: ADMIN, kind: "settings", component: lazy(() => import("./SeasonTab")) },
      { value: "pricing", label: "Pricing & deposits", roles: ADMIN, kind: "settings", component: lazy(() => import("./PricingTab")) },
    ],
  },
  {
    title: "Documents & mail",
    items: [
      { value: "documents", label: "Documents", roles: ADMIN, kind: "settings", component: lazy(() => import("./DocumentsTab")) },
      { value: "email", label: "Email", roles: ADMIN, kind: "settings", component: lazy(() => import("./EmailTab")) },
      { value: "reminders", label: "Reminders", roles: ADMIN, kind: "settings", component: lazy(() => import("./RemindersTab")) },
      { value: "templates", label: "Templates", roles: ADMIN, kind: "page", component: lazy(() => import("./TemplatesSection")) },
    ],
  },
  {
    title: "Public",
    items: [{ value: "form", label: "Booking form", roles: ADMIN, kind: "settings", component: lazy(() => import("./FormTab")) }],
  },
  {
    title: "Personal",
    items: [
      { value: "appearance", label: "Appearance", roles: EVERYONE, kind: "page", component: lazy(() => import("./AppearancePage")) },
      { value: "password", label: "Password", roles: EVERYONE, kind: "page", component: lazy(() => import("./PasswordSection")) },
    ],
  },
  {
    title: "Admin",
    items: [
      { value: "users", label: "Users", roles: ADMIN, kind: "link", to: "/users" },
      { value: "system", label: "System", roles: ADMIN, kind: "link", to: "/system" },
    ],
  },
];

export default function SettingsPage() {
  const { section } = useParams<{ section: string }>();
  const { user } = useAuth();
  const role: Role = user?.role ?? "manager";
  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length > 0);
  const current = groups.flatMap((g) => g.items).find((i) => i.value === section && i.kind !== "link");
  const needsSettings = current?.kind === "settings";
  const settings = useSettings({ enabled: needsSettings });
  useDocumentTitle(current ? `${current.label} · Settings` : "Settings");

  if (!current) {
    const first = groups.flatMap((g) => g.items).find((i) => i.kind !== "link");
    return <Navigate to={first ? `/settings/${first.value}` : "/today"} replace />;
  }
  const Component = current.component as LazyExoticComponent<ComponentType<Partial<SettingsTabProps>>> | undefined;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
          {groups.map((group) => (
            <div key={group.title} className="flex flex-col gap-1">
              <div className="text-label px-3 text-muted-foreground uppercase">{group.title}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.value}
                  to={item.kind === "link" ? (item.to ?? "/") : `/settings/${item.value}`}
                  className={({ isActive }) =>
                    cn(
                      "relative flex h-9 items-center gap-2 rounded-md px-3 text-body outline-none transition-colors hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring",
                      isActive && item.kind !== "link"
                        ? "bg-selection-row font-medium text-foreground before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary"
                        : "text-foreground",
                    )
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.kind === "link" ? <ArrowUpRight aria-hidden="true" className="size-4 text-faint-foreground" /> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {needsSettings && settings.isPending ? (
            <PageSkeleton />
          ) : needsSettings && settings.isError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Could not load settings</AlertTitle>
              <AlertDescription>{errorMessage(settings.error)}</AlertDescription>
            </Alert>
          ) : Component ? (
            <SectionLayoutContext.Provider value="split">
              <Suspense fallback={<PageSkeleton />}>
                <div className="flex flex-col gap-10">
                  <Component key={current.value} data={settings.data} />
                </div>
              </Suspense>
            </SectionLayoutContext.Provider>
          ) : null}
        </div>
      </div>
    </>
  );
}
