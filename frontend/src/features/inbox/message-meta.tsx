/** Small shared presentation bits for inbox rows and headers. */

import { ArrowUpRight, Bot, Paperclip, Send } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { InboxListItem, MessageBookingRef, ReviewStatus } from "./types";

export function BookingChip({ booking, link = true, className }: { booking: MessageBookingRef; link?: boolean; className?: string }) {
  const body = (
    <>
      <span className="font-medium tabular">{booking.reference}</span>
      <span className="max-w-40 truncate text-muted-foreground">{booking.group_name}</span>
      {link ? <ArrowUpRight aria-hidden="true" className="size-3 text-muted-foreground" /> : null}
    </>
  );
  const classes = cn(
    "inline-flex h-5 max-w-full items-center gap-1 rounded-md bg-primary/8 px-1.5 text-xs text-foreground ring-1 ring-inset ring-primary/15",
    link && "outline-none hover:bg-primary/12 focus-visible:ring-2 focus-visible:ring-ring/50",
    className,
  );
  return link ? (
    <Link to={`/bookings/${booking.id}`} className={classes} onClick={(e) => e.stopPropagation()} title={`Open booking ${booking.reference}`}>
      {body}
    </Link>
  ) : (
    <span className={classes}>{body}</span>
  );
}

const REVIEW_META: Record<ReviewStatus, { label: string; tone: StatusTone } | null> = {
  none: null,
  pending: { label: "Review", tone: "amber" },
  resolved: { label: "Resolved", tone: "green-muted" },
  not_booking: { label: "Not a booking", tone: "neutral" },
};

export function ReviewBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  const meta = REVIEW_META[status];
  if (!meta) return null;
  return <StatusBadge status={status} label={meta.label} tone={meta.tone} className={className} />;
}

export function KindBadge({ kind }: { kind: string | null }) {
  if (!kind || kind === "custom") return null;
  const label = kind.replace(/_/g, " ");
  return <StatusBadge status={kind} label={label.charAt(0).toUpperCase() + label.slice(1)} tone="blue" dot={false} />;
}

export function SenderAvatar({ name, outbound, className }: { name: string; outbound?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
        outbound ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
        className,
      )}
    >
      {outbound ? <Send className="size-3.5" /> : initials(name)}
    </span>
  );
}

export function RowMarkers({ item }: { item: InboxListItem }) {
  const markers: ReactNode[] = [];
  if (item.has_attachments) markers.push(<Paperclip key="att" aria-label="Has attachments" className="size-3.5 text-muted-foreground" />);
  if (item.is_auto_generated) markers.push(<Bot key="auto" aria-label="Automated message" className="size-3.5 text-muted-foreground" />);
  if (item.send_status === "failed") markers.push(<StatusBadge key="failed" status="failed" label="Failed" tone="red" />);
  if (markers.length === 0) return null;
  return <span className="inline-flex items-center gap-1.5">{markers}</span>;
}
