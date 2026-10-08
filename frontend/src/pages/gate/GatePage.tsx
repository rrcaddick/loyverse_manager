/**
 * /gate — PLACEHOLDER for the Today + Work + Gate agent.
 *
 * Spec: docs/redesign-spec.md §1: the POS tooling area shared by admin and
 * manager — arrivals today, open tickets, the morning sync. Reuses the
 * existing open-ticket and sync data (§12). Replace this file; keep the
 * default export and the route.
 */

import { DoorOpen } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function GatePage() {
  useDocumentTitle("Gate");
  return (
    <>
      <PageHeader title="Gate" description="Arrivals today, open tickets at the tills and the morning Loyverse sync." />
      <EmptyState
        icon={DoorOpen}
        title="The gate screen is on its way"
        description="Arrivals, open tickets and the morning sync will appear here. Until then use Today for arrivals and System for the sync."
      />
    </>
  );
}
