import { Construction } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface NotBuiltYetProps {
  title: string;
  description?: string;
}

/**
 * Placeholder for pages another agent will replace. Keeps the route, title
 * and breadcrumb working so navigation can be exercised end to end.
 */
export function NotBuiltYet({ title, description }: NotBuiltYetProps) {
  useDocumentTitle(title);
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={Construction}
        title="This page is still being built"
        description="The route, navigation and access rules are in place. The page itself lands in a later change."
      />
    </>
  );
}
