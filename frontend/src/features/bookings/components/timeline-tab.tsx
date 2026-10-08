/**
 * Timeline: booking events and emails merged, newest first.
 */

import {
  ArrowRightLeft,
  Banknote,
  BanknoteX,
  FileText,
  Inbox,
  Mail,
  MailWarning,
  MessageCircle,
  Pencil,
  PlusCircle,
  SlidersHorizontal,
  StickyNote,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime, formatRelativeDay, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { BookingDetail, BookingEmail, BookingEvent } from "../types";

interface Entry {
  key: string;
  at: string;
  icon: LucideIcon;
  tone: "default" | "accent" | "warn" | "danger" | "info";
  title: React.ReactNode;
  detail?: React.ReactNode;
  actor: string;
}

const EVENT_ICONS: Record<string, { icon: LucideIcon; tone: Entry["tone"] }> = {
  created: { icon: PlusCircle, tone: "accent" },
  updated: { icon: Pencil, tone: "default" },
  override: { icon: SlidersHorizontal, tone: "info" },
  status_changed: { icon: ArrowRightLeft, tone: "accent" },
  note: { icon: StickyNote, tone: "default" },
  payment_recorded: { icon: Banknote, tone: "accent" },
  payment_deleted: { icon: BanknoteX, tone: "danger" },
  arrivals_recorded: { icon: UserCheck, tone: "accent" },
  ticket_sent: { icon: MessageCircle, tone: "accent" },
  document_issued: { icon: FileText, tone: "info" },
  email_sent: { icon: Mail, tone: "default" },
  email_failed: { icon: MailWarning, tone: "danger" },
  email_received: { icon: Inbox, tone: "info" },
};

function changes(data: Record<string, unknown> | null): { field: string; from: unknown; to: unknown }[] {
  const raw = data?.changes;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, { from?: unknown; to?: unknown }>).map(([field, v]) => ({ field, from: v?.from, to: v?.to }));
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function fromEvent(e: BookingEvent): Entry {
  const meta = EVENT_ICONS[e.kind] ?? { icon: Pencil, tone: "default" as const };
  let detail: React.ReactNode = null;
  if (e.kind === "status_changed" && e.data) {
    const from = e.data.from as string | undefined;
    const to = e.data.to as string | undefined;
    const reason = e.data.reason as string | undefined;
    detail = (
      <span className="flex flex-wrap items-center gap-1.5">
        {from ? <StatusBadge status={from} /> : null}
        {from && to ? <span aria-hidden="true">→</span> : null}
        {to ? <StatusBadge status={to} /> : null}
        {reason ? <span className="text-muted-foreground">· {reason}</span> : null}
      </span>
    );
  } else if (e.kind === "updated") {
    const list = changes(e.data);
    if (list.length) {
      detail = (
        <ul className="flex flex-col gap-0.5">
          {list.map((c) => (
            <li key={c.field} className="text-muted-foreground">
              <span className="text-foreground">{humanise(c.field)}</span>: {fmtValue(c.from)} <span aria-hidden="true">→</span> <span className="text-foreground">{fmtValue(c.to)}</span>
            </li>
          ))}
        </ul>
      );
    }
  } else if (e.kind === "note" && typeof e.data?.text === "string") {
    detail = <p className="whitespace-pre-wrap">{e.data.text}</p>;
  }
  return {
    key: `event-${e.id}`,
    at: e.created_at,
    icon: meta.icon,
    tone: meta.tone,
    title: e.kind === "note" ? "Note" : e.summary,
    detail,
    actor: e.actor_name ?? (e.kind === "email_received" ? "Customer" : "System"),
  };
}

function fromEmail(m: BookingEmail): Entry {
  const inbound = m.direction === "inbound";
  const failed = m.send_status === "failed";
  return {
    key: `email-${m.id}`,
    at: m.sent_at,
    icon: failed ? MailWarning : inbound ? Inbox : Mail,
    tone: failed ? "danger" : inbound ? "info" : "default",
    title: (
      <span className="flex flex-wrap items-center gap-1.5">
        <span>{inbound ? "Email received" : failed ? "Email failed" : m.kind ? `${humanise(m.kind)} emailed` : "Email sent"}</span>
        {m.has_attachments ? <StatusBadge status="attachment" label="Attachment" tone="neutral" dot={false} /> : null}
      </span>
    ),
    detail: (
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{m.subject ?? "(no subject)"}</span>
        {m.snippet ? <span className="line-clamp-2 text-muted-foreground">{m.snippet}</span> : null}
        {failed && m.send_error ? <span className="text-destructive">{m.send_error}</span> : null}
      </span>
    ),
    actor: inbound ? m.from_name ?? m.from_email ?? "Customer" : "Farmyard Park",
  };
}

export function TimelineTab({ booking }: { booking: BookingDetail }) {
  const entries = useMemo(() => {
    const all = [...booking.events.map(fromEvent), ...booking.emails.map(fromEmail)];
    all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    let lastDay = "";
    return all.map((e) => {
      const day = e.at.slice(0, 10);
      const showDay = day !== lastDay;
      lastDay = day;
      return { ...e, day, showDay };
    });
  }, [booking.events, booking.emails]);

  if (entries.length === 0) {
    return (
      <Section>
        <EmptyState compact icon={StickyNote} title="Nothing on the timeline yet" />
      </Section>
    );
  }

  return (
    <Section flush>
      <ol className="px-5 py-4">
        {entries.map((e) => {
          const Icon = e.icon;
          return (
            <li key={e.key} className="relative">
              {e.showDay ? (
                <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {formatRelativeDay(e.day)}
                </div>
              ) : null}
              <div className="flex gap-3 pb-5">
                <div className="relative flex flex-col items-center">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
                      e.tone === "accent" && "bg-primary/10 text-primary ring-primary/20",
                      e.tone === "info" && "bg-status-blue-bg text-status-blue-fg ring-foreground/8",
                      e.tone === "danger" && "bg-destructive/10 text-destructive ring-destructive/20",
                      e.tone === "warn" && "bg-status-amber-bg text-status-amber-fg ring-foreground/8",
                      e.tone === "default" && "bg-muted text-muted-foreground ring-foreground/8",
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1 pt-1 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="font-medium text-foreground">{e.title}</span>
                    <span className="text-xs text-muted-foreground tabular" title={formatDateTime(e.at)}>
                      {e.actor} · {formatDateTime(e.at)}
                    </span>
                  </div>
                  {e.detail ? <div className="mt-1 text-sm">{e.detail}</div> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
