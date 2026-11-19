/**
 * SectionHeader — icon in the section's semantic colour, title, count pill,
 * optional actions, and a 1 px rule (spec §0.4).
 *
 *   <SectionHeader icon={Mail} tone="blue" title="Needs a reply" count={9} />
 *   <SectionHeader icon={Landmark} tone="amber" title="Confirm money" count={4} actions={<Button size="sm">…</Button>} as="h3" />
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type SectionTone = "neutral" | "green" | "amber" | "red" | "blue" | "accent";

const ICON_TONE: Record<SectionTone, string> = {
  neutral: "text-muted-foreground",
  green: "text-green-solid",
  amber: "text-amber-solid",
  red: "text-red-solid",
  blue: "text-blue-solid",
  accent: "text-primary",
};

interface SectionHeaderProps {
  title: ReactNode;
  icon?: LucideIcon;
  tone?: SectionTone;
  count?: number | null;
  description?: ReactNode;
  actions?: ReactNode;
  /** Heading level. Default h2. */
  as?: "h2" | "h3" | "h4";
  /** Drop the rule (inside a card that already has one). */
  rule?: boolean;
  className?: string;
  id?: string;
}

export function SectionHeader({ title, icon: Icon, tone = "neutral", count, description, actions, as: Tag = "h2", rule = true, className, id }: SectionHeaderProps) {
  const showCount = typeof count === "number" && count > 0;
  return (
    <div className={cn("flex flex-col gap-1", rule && "border-b border-border pb-2", className)}>
      <div className="flex min-h-8 items-center gap-2.5">
        {Icon ? <Icon aria-hidden="true" className={cn("size-5 shrink-0", ICON_TONE[tone])} /> : null}
        <Tag id={id} className="text-section min-w-0 truncate">
          {title}
        </Tag>
        {showCount ? (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold text-foreground tabular" aria-label={`${formatNumber(count)} items`}>
            {formatNumber(count)}
          </span>
        ) : null}
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
