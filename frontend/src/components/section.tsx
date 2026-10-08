import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SectionProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned header actions. */
  actions?: ReactNode;
  /** Remove the inner padding (for tables that should run edge to edge). */
  flush?: boolean;
  /** Footer row (e.g. inline save button or a summary line). */
  footer?: ReactNode;
}

/**
 * A card-like grouping with a title row. The default surface for settings
 * groups, detail panels and tables.
 */
export function Section({ title, description, actions, flush, footer, className, children, ...props }: SectionProps) {
  const hasHeader = title || description || actions;
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    >
      {hasHeader ? (
        <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            {title ? <h2 className="text-base font-semibold text-foreground">{title}</h2> : null}
            {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(flush ? "" : "px-5 py-5")}>{children}</div>
      {footer ? <div className="border-t border-border bg-muted/40 px-5 py-3">{footer}</div> : null}
    </section>
  );
}
