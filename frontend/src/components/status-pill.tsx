/**
 * StatusPill — dot + text, 22 px tall, 1 px ring so it survives on any
 * surface. Bold (solid fill, white text) only for red.
 *
 *   <StatusPill status="proforma_sent" />                  booking status → tone + label
 *   <StatusPill tone="amber" label="Waiting 3 d" />
 *   <StatusPill tone="green-muted" label="Completed" />    tick, no fill
 *   <StatusPill tone="red" label="Overdue" icon={Clock} /> solid red
 *
 * Tones: neutral (grey) · amber · green · green-muted · red (bold) ·
 * red-muted (grey fill, red text: lapsed, no show) · blue. In the High
 * contrast theme fills drop away and the ring becomes the text colour.
 */

import { cva, type VariantProps } from "class-variance-authority";
import { Check, type LucideIcon } from "lucide-react";

import { humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/types/api";

export const statusPillVariants = cva(
  "inline-flex h-[1.375rem] shrink-0 items-center gap-1.5 rounded-md px-2 text-[0.8125rem] leading-none font-medium whitespace-nowrap ring-1 ring-pill-ring ring-inset [&>svg]:size-3.5 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "bg-status-neutral-bg text-status-neutral-fg",
        amber: "bg-status-amber-bg text-status-amber-fg",
        green: "bg-status-green-bg text-status-green-fg",
        "green-muted": "bg-status-green-muted-bg text-status-green-muted-fg",
        red: "bg-status-red-bg text-status-red-fg ring-transparent",
        "red-muted": "bg-status-red-muted-bg text-status-red-muted-fg",
        blue: "bg-status-blue-bg text-status-blue-fg",
      },
      size: {
        default: "",
        sm: "h-5 px-1.5 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "default" },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof statusPillVariants>["tone"]>;

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  icon?: LucideIcon;
}

/** Booking status → tone (docs/redesign-spec.md §2 status map). */
export const BOOKING_STATUS_META: Record<BookingStatus, StatusMeta> = {
  enquiry: { label: "Enquiry", tone: "neutral" },
  proforma_sent: { label: "Proforma sent", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "green" },
  completed: { label: "Completed", tone: "green-muted", icon: Check },
  cancelled: { label: "Cancelled", tone: "red" },
  lapsed: { label: "Lapsed", tone: "red-muted" },
  no_show: { label: "No show", tone: "red-muted" },
};

export interface StatusPillProps extends Omit<React.ComponentProps<"span">, "children">, VariantProps<typeof statusPillVariants> {
  /** A booking status, or any other string (rendered with `tone`). */
  status?: BookingStatus | string;
  /** Override the label (defaults to the status meta or a humanised string). */
  label?: string;
  /** Leading icon instead of the dot (completed shows a tick by default). */
  icon?: LucideIcon;
  /** Show the leading dot. Default true (false when an icon is given). */
  dot?: boolean;
}

export function StatusPill({ status, tone, size, label, icon, dot, className, ...props }: StatusPillProps) {
  const meta = status ? (BOOKING_STATUS_META as Record<string, StatusMeta | undefined>)[status] : undefined;
  const resolvedTone = tone ?? meta?.tone ?? "neutral";
  const Icon = icon ?? meta?.icon;
  const text = label ?? meta?.label ?? (status ? humanise(status) : "");
  const showDot = dot ?? !Icon;
  return (
    <span className={cn(statusPillVariants({ tone: resolvedTone, size }), className)} {...props}>
      {Icon ? <Icon aria-hidden="true" /> : showDot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {text}
    </span>
  );
}

/** Generic yes/no pill. */
export function BooleanPill({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  return <StatusPill label={value ? yes : no} tone={value ? "green" : "neutral"} />;
}

/** A bare status dot (for rows where the word is elsewhere). */
export function StatusDot({ tone = "neutral", className, label }: { tone?: StatusTone; className?: string; label?: string }) {
  const colour: Record<StatusTone, string> = {
    neutral: "bg-grey-solid",
    amber: "bg-amber-solid",
    green: "bg-green-solid",
    "green-muted": "bg-green-solid",
    red: "bg-red-solid",
    "red-muted": "bg-red-solid",
    blue: "bg-blue-solid",
  };
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("inline-block size-2 shrink-0 rounded-full", colour[tone], className)} />;
}
