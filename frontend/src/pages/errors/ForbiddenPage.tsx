import { ShieldOff } from "lucide-react";
import { Link } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth";
import { homeFor } from "@/lib/nav";

export default function ForbiddenPage() {
  useDocumentTitle("No access");
  const { user } = useAuth();
  return (
    <EmptyState
      variant="page"
      icon={ShieldOff}
      title="You do not have access to this"
      description="Your account is a manager account, which covers Today, the calendar and the gate. Ask an administrator if you need more."
      action={
        <Button asChild>
          <Link to={user ? homeFor(user.role) : "/"}>Back to start</Link>
        </Button>
      }
    />
  );
}
