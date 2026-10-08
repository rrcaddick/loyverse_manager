/**
 * EmptyState — status, a learning cue and a pathway (NN/g), in three sizes.
 *
 *   <EmptyState icon={Inbox} title="Nothing to reply to" hint="Mail is checked every minute; customer replies land here." link={{ to: "/mail", label: "Open Mail" }} />
 *   <EmptyState variant="inline" title="No payments yet" />                   one line inside a card
 *   <EmptyState variant="page" icon={FileQuestion} title="Page not found" action={<Button…/>} />
 *
 * `compact` is kept as an alias for variant="inline".
 */

import { ArrowRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Second sentence: how this fills up ("Mail is checked every minute…"). */
  hint?: ReactNode;
  /** Primary / secondary actions. */
  action?: ReactNode;
  /** A pathway link rendered as "Label →". */
  link?: { to: string; label: string };
  variant?: "page" | "card" | "inline";
  /** Alias for variant="inline". */
  compact?: boolean;
  className?: string;
}

/** Centred empty state with an icon tile, used by tables, lists and pages. */
export function EmptyState({ icon: Icon, title, description, hint, action, link, variant, compact, className }: EmptyStateProps) {
  const resolved = variant ?? (compact ? "inline" : "card");
  if (resolved === "inline") {
    return (
      <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-body text-muted-foreground", className)}>
        {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
        <span className="text-foreground">{title}</span>
        {description ? <span>{description}</span> : null}
        {link ? (
          <Link to={link.to} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
            {link.label}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
        {action}
      </div>
    );
  }
  return (
    <Empty className={cn(resolved === "page" ? "p-16" : "p-10", "border-0", className)}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon" className="size-10 rounded-xl [&_svg:not([class*='size-'])]:size-5">
            <Icon aria-hidden="true" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle className={cn(resolved === "page" ? "text-section" : "text-body font-medium")}>{title}</EmptyTitle>
        {description ? <EmptyDescription className="text-body">{description}</EmptyDescription> : null}
        {hint ? <EmptyDescription className="text-sm">{hint}</EmptyDescription> : null}
      </EmptyHeader>
      {action || link ? (
        <EmptyContent className="flex-row flex-wrap justify-center">
          {action}
          {link ? (
            <Link to={link.to} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-body font-medium text-primary underline-offset-4 hover:underline">
              {link.label}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
