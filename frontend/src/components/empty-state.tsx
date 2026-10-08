import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Primary / secondary actions. */
  action?: ReactNode;
  /** Tighter padding for use inside tables and cards. */
  compact?: boolean;
  className?: string;
}

/** Centred empty state with an icon tile, used by tables, lists and pages. */
export function EmptyState({ icon: Icon, title, description, action, compact, className }: EmptyStateProps) {
  return (
    <Empty className={cn(compact ? "p-6" : "p-12", "border-0", className)}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle className="text-base font-medium">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
