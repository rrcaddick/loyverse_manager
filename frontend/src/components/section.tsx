import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * "card": title row inside the card (default). "split": the Settings layout —
 * heading and one sentence on the left, the card of fields on the right.
 * Settings provides "split" through context so every tab's Sections follow.
 */
export type SectionLayout = "card" | "split";
export const SectionLayoutContext = createContext<SectionLayout>("card");

interface SectionProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned header actions. */
  actions?: ReactNode;
  /** Remove the inner padding (for tables that should run edge to edge). */
  flush?: boolean;
  /** Footer row (e.g. inline save button or a summary line). */
  footer?: ReactNode;
  /** Override the layout from context. */
  layout?: SectionLayout;
}

/**
 * A card-like grouping with a title row. The default surface for settings
 * groups, detail panels and tables.
 */
export function Section({ title, description, actions, flush, footer, layout, className, children, ...props }: SectionProps) {
  const contextLayout = useContext(SectionLayoutContext);
  const resolved = layout ?? contextLayout;
  const hasHeader = title || description || actions;

  if (resolved === "split") {
    return (
      <section className={cn("grid gap-4 lg:grid-cols-[minmax(0,17rem)_1fr] lg:gap-8", className)} {...props}>
        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          {title ? <h2 className="text-section text-foreground">{title}</h2> : null}
          {description ? <p className="mt-1 max-w-[40ch] text-body text-muted-foreground">{description}</p> : null}
          {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-border">
          <div className={cn(flush ? "" : "p-card")}>{children}</div>
          {footer ? <div className="border-t border-border bg-nested px-card py-3">{footer}</div> : null}
        </div>
      </section>
    );
  }

  return (
    <section className={cn("flex flex-col overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-border", className)} {...props}>
      {hasHeader ? (
        <div className="flex flex-col gap-2 border-b border-border px-card py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            {title ? <h2 className="text-section text-foreground">{title}</h2> : null}
            {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(flush ? "" : "p-card")}>{children}</div>
      {footer ? <div className="border-t border-border bg-nested px-card py-3">{footer}</div> : null}
    </section>
  );
}
