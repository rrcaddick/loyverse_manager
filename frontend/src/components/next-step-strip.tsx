/**
 * NextStepStrip — the urgency-coloured one-liner under a record header or
 * at the top of a work row, with the move-on verb (spec §6, §4).
 *
 *   <NextStepStrip
 *     urgency="amber"
 *     icon={Clock}
 *     title="Deposit due in 3 days"
 *     detail="R 3 800 by Fri 31 Oct · proforma sent 12 days ago"
 *     primary={<Button>Record payment</Button>}
 *     secondary={<Button variant="ghost">Send reminder</Button>}
 *   />
 *
 * Urgency: neutral (nothing due), blue (information), amber (waiting on
 * someone), red (overdue or wrong), green (done). Only the left edge and the
 * icon carry the colour — never a tinted fill.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type Urgency = "neutral" | "blue" | "amber" | "red" | "green";

const EDGE: Record<Urgency, string> = {
  neutral: "",
  blue: "edge-blue",
  amber: "edge-amber",
  red: "edge-red",
  green: "edge-green",
};

const ICON: Record<Urgency, string> = {
  neutral: "text-muted-foreground",
  blue: "text-blue-solid",
  amber: "text-amber-solid",
  red: "text-red-solid",
  green: "text-green-solid",
};

interface NextStepStripProps {
  urgency?: Urgency;
  icon?: LucideIcon;
  title: ReactNode;
  detail?: ReactNode;
  /** The one filled verb. */
  primary?: ReactNode;
  /** Ghost button(s). */
  secondary?: ReactNode;
  /** The ⋯ menu trigger. */
  menu?: ReactNode;
  className?: string;
}

export function NextStepStrip({ urgency = "neutral", icon: Icon, title, detail, primary, secondary, menu, className }: NextStepStripProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-row-queue flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-card py-2 pr-3 pl-4 ring-1 ring-border",
        EDGE[urgency],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className={cn("size-5 shrink-0", ICON[urgency])} /> : null}
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium text-foreground">{title}</div>
        {detail ? <div className="truncate text-sm text-muted-foreground">{detail}</div> : null}
      </div>
      {primary || secondary || menu ? (
        <div className="flex shrink-0 items-center gap-2">
          {secondary}
          {primary}
          {menu}
        </div>
      ) : null}
    </div>
  );
}
