/**
 * CountBadge — the number chip on tabs, nav items and rails. One and two
 * digits get the same chip (owner's note, 29 Oct 2026); three or more
 * stretch. Highlight is the accent (#FF4081); muted is its quieter form for
 * secondary rows; neutral is a grey chip for counts that are not a call.
 *
 *   <CountBadge count={12} />                 accent chip, 20 px
 *   <CountBadge count={3} tone="muted" />
 *   <CountBadge count={91} size="md" />       24 px, the nav's Work badge
 */

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONES = {
  highlight: "bg-highlight text-highlight-foreground",
  muted: "bg-highlight/70 text-highlight-foreground",
  neutral: "bg-muted text-muted-foreground",
} as const;

const SIZES = {
  sm: "h-5 min-w-7 px-1.5 text-xs",
  md: "h-6 min-w-8 px-2 text-xs",
} as const;

export interface CountBadgeProps extends Omit<React.ComponentProps<"span">, "children"> {
  count: number;
  tone?: keyof typeof TONES;
  size?: keyof typeof SIZES;
}

export function CountBadge({ count, tone = "highlight", size = "sm", className, ...props }: CountBadgeProps) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular", SIZES[size], TONES[tone], className)} {...props}>
      {formatNumber(count)}
    </span>
  );
}
