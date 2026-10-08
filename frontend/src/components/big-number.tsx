/**
 * BigNumber — a display tile: label, 36 px tabular number, a "remaining"
 * line, optional link (spec §0.3, §3).
 *
 *   <BigNumber label="People" value={formatNumber(300)} detail="200 confirmed" />
 *   <BigNumber label="Owed at the gate" value={formatMoney(20210, { compact: true })} detail="R 7 790 paid" tone="amber" />
 *   <BigNumber label="Needs you" value={12} detail="oldest 3 d" to="/work" />
 *   <BigNumberRow>…four tiles…</BigNumberRow>
 *
 * `tone` colours the number only when the state deviates (paid green,
 * overdue red); leave it neutral otherwise. `loading` renders a skeleton of
 * the same height so the row never jumps.
 */

import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type NumberTone = "neutral" | "green" | "amber" | "red" | "blue";

const TONE_TEXT: Record<NumberTone, string> = {
  neutral: "text-foreground",
  green: "text-green-text",
  amber: "text-amber-text",
  red: "text-red-text",
  blue: "text-blue-text",
};

export interface BigNumberProps {
  label: ReactNode;
  value: ReactNode;
  /** The second line: "200 confirmed", "R 7 790 paid", "oldest 3 d". */
  detail?: ReactNode;
  tone?: NumberTone;
  icon?: LucideIcon;
  /** Makes the whole tile a link. */
  to?: string;
  onClick?: () => void;
  loading?: boolean;
  /** "lg" for the day view at 1920. */
  size?: "md" | "lg";
  className?: string;
  /** Accessible name when the label alone is ambiguous. */
  "aria-label"?: string;
}

export function BigNumber({ label, value, detail, tone = "neutral", icon: Icon, to, onClick, loading, size = "md", className, ...rest }: BigNumberProps) {
  const interactive = !!to || !!onClick;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-label truncate text-muted-foreground uppercase">{label}</span>
        {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
        {interactive && !Icon ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-faint-foreground" /> : null}
      </div>
      {loading ? (
        <Skeleton className={cn("mt-1 w-24", size === "lg" ? "h-12" : "h-10")} />
      ) : (
        <div className={cn("mt-1 tabular", size === "lg" ? "text-4xl font-semibold tracking-tight" : "text-display", TONE_TEXT[tone])}>{value}</div>
      )}
      <div className="mt-1 min-h-5 text-sm text-muted-foreground">{loading ? <Skeleton className="h-4 w-32" /> : detail}</div>
    </>
  );
  const classes = cn(
    "flex min-w-0 flex-col rounded-xl bg-card p-card text-left ring-1 ring-border",
    interactive && "transition-colors outline-none hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring",
    className,
  );
  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes} {...rest}>
        {body}
      </button>
    );
  }
  return (
    <div className={classes} {...rest}>
      {body}
    </div>
  );
}

/** Four tiles across at ≥ 1280, two at tablet, one on phones. */
export function BigNumberRow({ className, children, columns = 4 }: { className?: string; children: ReactNode; columns?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
