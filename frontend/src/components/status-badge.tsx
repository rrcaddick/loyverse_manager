import { cva, type VariantProps } from "class-variance-authority";

import { humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/types/api";

/**
 * Status pills. `tone` is the semantic colour; `StatusBadge` maps booking
 * statuses to tones so every list and detail page agrees.
 */
export const statusBadgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ring-foreground/8 [&>svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-status-neutral-bg text-status-neutral-fg",
        amber: "bg-status-amber-bg text-status-amber-fg",
        green: "bg-status-green-bg text-status-green-fg",
        "green-muted": "bg-status-green-muted-bg text-status-green-muted-fg",
        red: "bg-status-red-bg text-status-red-fg",
        "red-muted": "bg-status-red-muted-bg text-status-red-muted-fg",
        blue: "bg-status-blue-bg text-status-blue-fg",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof statusBadgeVariants>["tone"]>;

export const BOOKING_STATUS_META: Record<BookingStatus, { label: string; tone: StatusTone }> = {
  enquiry: { label: "Enquiry", tone: "neutral" },
  proforma_sent: { label: "Proforma sent", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "green" },
  completed: { label: "Completed", tone: "green-muted" },
  cancelled: { label: "Cancelled", tone: "red" },
  lapsed: { label: "Lapsed", tone: "red-muted" },
  no_show: { label: "No show", tone: "red-muted" },
};

interface StatusBadgeProps extends Omit<React.ComponentProps<"span">, "children"> {
  /** A booking status, or any other string (rendered with `tone`). */
  status: BookingStatus | string;
  tone?: StatusTone;
  /** Override the label (defaults to the status meta or a humanised string). */
  label?: string;
  /** Show a leading dot in the tone colour. */
  dot?: boolean;
}

export function StatusBadge({ status, tone, label, dot = true, className, ...props }: StatusBadgeProps) {
  const meta = (BOOKING_STATUS_META as Record<string, { label: string; tone: StatusTone } | undefined>)[status];
  const resolvedTone = tone ?? meta?.tone ?? "neutral";
  const text = label ?? meta?.label ?? humanise(status);
  return (
    <span className={cn(statusBadgeVariants({ tone: resolvedTone }), className)} {...props}>
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-80" /> : null}
      {text}
    </span>
  );
}

/** Generic yes/no pill. */
export function BooleanBadge({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  return <StatusBadge status={value ? "yes" : "no"} label={value ? yes : no} tone={value ? "green" : "neutral"} />;
}
