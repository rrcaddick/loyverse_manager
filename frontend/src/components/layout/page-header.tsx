import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  /** One sentence at most; many pages need none. */
  description?: ReactNode;
  /** Small label above the title, e.g. a booking reference. */
  eyebrow?: ReactNode;
  /** Right-aligned actions (buttons). Wraps below on narrow screens. */
  actions?: ReactNode;
  /** Content under the header row, e.g. tabs or a filter bar. */
  children?: ReactNode;
  className?: string;
}

/**
 * Page heading: 28 px title, optional one-line description, actions on the
 * right. One per page, at the top, so spacing is identical everywhere.
 *
 *   <PageHeader title="Bookings" actions={<Button>Add booking</Button>}>
 *     <SegmentedTabs … />
 *   </PageHeader>
 */
export function PageHeader({ title, description, eyebrow, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {eyebrow ? <div className="text-label text-muted-foreground uppercase">{eyebrow}</div> : null}
          <h1 className="text-title text-foreground">{title}</h1>
          {description ? <div className="max-w-prose text-body text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** Consistent vertical rhythm for a page: header, then sections. */
export function PageBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-card-gap", className)} {...props} />;
}
