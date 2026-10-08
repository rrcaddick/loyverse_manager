import { AlertCircle } from "lucide-react";
import { lazy, Suspense } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { PageHeader } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/features/settings/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/lib/api";
import type { SettingsResponse } from "@/types/api";

const TABS = [
  { value: "season", label: "Season", component: lazy(() => import("./SeasonTab")) },
  { value: "pricing", label: "Pricing & deposits", component: lazy(() => import("./PricingTab")) },
  { value: "documents", label: "Documents", component: lazy(() => import("./DocumentsTab")) },
  { value: "reminders", label: "Reminders", component: lazy(() => import("./RemindersTab")) },
  { value: "email", label: "Email", component: lazy(() => import("./EmailTab")) },
  { value: "form", label: "Booking form", component: lazy(() => import("./FormTab")) },
] as const;

export type SettingsTabValue = (typeof TABS)[number]["value"];

export interface SettingsTabProps {
  data: SettingsResponse;
}

export default function SettingsPage() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const settings = useSettings();
  const current = TABS.find((t) => t.value === tab);
  useDocumentTitle(current ? `${current.label} · Settings` : "Settings");

  if (!current) return <Navigate to="/settings/season" replace />;
  const TabComponent = current.component;

  return (
    <>
      <PageHeader title="Settings" description="Season, prices, documents and the wording the park sends. Changes apply to new bookings and documents from the moment you save.">
        <Tabs value={current.value} onValueChange={(value) => navigate(`/settings/${value}`)}>
          <TabsList variant="line" className="-mb-px h-auto w-full justify-start overflow-x-auto border-b border-border pb-px no-scrollbar scroll-fade-x">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="h-9 flex-none px-3">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      {settings.isPending ? (
        <PageSkeleton />
      ) : settings.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load settings</AlertTitle>
          <AlertDescription>{errorMessage(settings.error)}</AlertDescription>
        </Alert>
      ) : (
        <Suspense fallback={<PageSkeleton />}>
          <div className="mx-auto w-full max-w-5xl">
            <TabComponent key={current.value} data={settings.data} />
          </div>
        </Suspense>
      )}
    </>
  );
}
