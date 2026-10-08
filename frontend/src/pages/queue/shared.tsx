/**
 * Chrome shared by the queue sections: the card with icon/count, the row
 * layout, the collapsed "nothing to do" line and a few day-count helpers.
 */

import {
  Banknote,
  BellRing,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Hourglass,
  MailQuestion,
  Reply,
  Sparkles,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import type { QueueSectionKey } from "@/features/queue/types";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const SECTION_META: Record<QueueSectionKey, { description: string; empty: string; icon: LucideIcon }> = {
  needs_reply: { description: "Bookings whose latest email is from the customer and has not been answered.", empty: "every customer email has a reply", icon: Reply },
  unmatched_emails: { description: "Inbound mail the sync could not link to a booking.", empty: "nothing waiting for review", icon: MailQuestion },
  new_requests: { description: "Enquiries that have not been sent a proforma yet.", empty: "no new enquiries", icon: Sparkles },
  payments_to_confirm: { description: "Bank credits the matcher could only suggest a booking for. Confirm the right one.", empty: "no suggested payments", icon: Banknote },
  unmatched_credits: { description: "Credits from the last 30 days with no booking. Match them or park them.", empty: "every recent credit is accounted for", icon: CircleDollarSign },
  reminders_due: { description: "Reminder emails that are due or overdue, grouped by kind.", empty: "no reminders due", icon: BellRing },
  tickets_to_send: { description: "Confirmed groups that have not received their vehicle ticket.", empty: "every confirmed group has its ticket", icon: Ticket },
  visits_this_week: { description: "Groups arriving in the next seven days.", empty: "no groups this week", icon: CalendarDays },
  arrivals_to_record: { description: "Past visits with no arrival count yet.", empty: "all arrivals recorded", icon: ClipboardCheck },
  lapsing: { description: "Unpaid holds expiring within three days.", empty: "no holds about to lapse", icon: Hourglass },
};

export function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular", className)}>
      {formatNumber(count)}
    </span>
  );
}

interface QueueSectionCardProps {
  sectionKey: QueueSectionKey;
  title: string;
  count: number;
  actions?: ReactNode;
  children: ReactNode;
}

export function QueueSectionCard({ sectionKey, title, count, actions, children }: QueueSectionCardProps) {
  const meta = SECTION_META[sectionKey];
  const Icon = meta.icon;
  return (
    <Section
      id={`queue-${sectionKey}`}
      aria-labelledby={`queue-${sectionKey}-title`}
      className="scroll-mt-20"
      flush
      title={
        <span id={`queue-${sectionKey}-title`} className="flex items-center gap-2.5">
          <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
          {title}
          <CountBadge count={count} />
        </span>
      }
      description={meta.description}
      actions={actions}
    >
      {children}
    </Section>
  );
}

interface QueueRowProps {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** One worklist row: content left, actions right (stacked below on phones). */
export function QueueRow({ children, actions, className }: QueueRowProps) {
  return (
    <li className={cn("flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:gap-6", className)}>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">{actions}</div> : null}
    </li>
  );
}

interface QueueListProps<T> {
  items: T[];
  getKey: (item: T) => string | number;
  render: (item: T) => ReactNode;
  /** Rows shown before "Show all". Default 6. */
  limit?: number;
  label?: string;
}

/** A divided list that shows the first few rows and expands on request. */
export function QueueList<T>({ items, getKey, render, limit = 6, label = "rows" }: QueueListProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);
  const hidden = items.length - visible.length;
  return (
    <>
      <ul className="divide-y divide-border">{visible.map((item) => <QueueFragment key={getKey(item)}>{render(item)}</QueueFragment>)}</ul>
      {items.length > limit ? (
        <div className="border-t border-border bg-muted/40 px-5 py-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Show fewer" : `Show all ${formatNumber(items.length)} ${label}`}
            {!expanded && hidden > 0 ? <span className="text-muted-foreground">(+{formatNumber(hidden)})</span> : null}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function QueueFragment({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** A section with nothing in it collapses to one quiet line. */
export function EmptySectionLine({ sectionKey, title }: { sectionKey: QueueSectionKey; title: string }) {
  const meta = SECTION_META[sectionKey];
  return (
    <div id={`queue-${sectionKey}`} className="flex scroll-mt-20 items-center gap-3 px-3 py-2 text-sm">
      <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-success/70" />
      <span className="font-medium text-foreground/80">{title}</span>
      <span className="text-muted-foreground">· {meta.empty}</span>
    </div>
  );
}

// ------------------------------------------------------------------ helpers

/** Whole days from `fromIso` to `toIso` (date or datetime strings, SAST). */
export function daysBetween(fromIso: string | null | undefined, toIso: string): number | null {
  if (!fromIso) return null;
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** "today" / "tomorrow" / "in 3 days" / "2 days ago". */
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${formatNumber(days)} days` : `${formatNumber(-days)} days ago`;
}

/** "6 days overdue" / "due today". */
export function overdueLabel(daysOverdue: number): string {
  if (daysOverdue <= 0) return "due today";
  return `${formatNumber(daysOverdue)} ${daysOverdue === 1 ? "day" : "days"} overdue`;
}

/** Group type codes read better as words. */
export function groupTypeLabel(code: string | null | undefined): string {
  if (!code) return "—";
  const labels: Record<string, string> = {
    school: "School",
    creche: "Crèche",
    church: "Church group",
    nonprofit: "Non-profit",
    family: "Family or friends",
    corporate: "Corporate",
    pensioners: "Pensioners",
    other: "Other",
  };
  return labels[code] ?? code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " ");
}

export function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "form":
      return "Web form";
    case "email":
      return "Email";
    case "import":
      return "Booking sheet";
    case "manual":
      return "Added by hand";
    default:
      return source ?? "—";
  }
}
