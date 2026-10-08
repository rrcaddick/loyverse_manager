import { FileQuestion } from "lucide-react";
import { Link } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth";
import { homeFor } from "@/lib/nav";

export default function NotFoundPage() {
  useDocumentTitle("Page not found");
  const { user } = useAuth();
  return (
    <EmptyState
      icon={FileQuestion}
      title="Page not found"
      description="The address may be out of date, or the record it pointed to has been removed."
      action={
        <Button asChild>
          <Link to={user ? homeFor(user.role) : "/"}>Back to start</Link>
        </Button>
      }
    />
  );
}
