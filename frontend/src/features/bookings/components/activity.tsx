/**
 * Activity: the booking's story, newest first, grouped by day (spec §6).
 *
 * Three weights: notes and emails are cards (avatar, text or subject +
 * snippet, "Open" → Conversation); money, status, document, ticket and
 * arrival events are one-liners with an icon and a coloured pill; field
 * edits collapse into "3 fields changed" and the sheet import's burst of
 * events into one "Imported from the booking sheet" line, both expandable.
 * Chips: All · Notes · Emails · Money · Changes. The composer sits on top.
 */

import {
  ArrowRightLeft,
  Banknote,
  BanknoteX,
  BellOff,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Inbox,
  Landmark,
  Mail,
  MailWarning,
  MessageCircle,
  MessageSquareText,
  Pencil,
  PlusCircle,
  SlidersHorizontal,
  StickyNote,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/section-header";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { StatusPill, type StatusTone } from "@/components/status-pill";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, formatMoney, formatRelativeDay, formatTime, formatWeekday, humanise, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

import { documentPdfUrl, useAddNote } from "../api";
import { DOCUMENT_KIND_LABELS, type BookingDetail, type BookingEmail, type BookingEvent, type DocumentKind } from "../types";
import { useBookingActions } from "../use-booking-actions";

type Chip = "all" | "notes" | "emails" | "money" | "changes";

interface Entry {
  key: string;
  at: string;
  chip: Exclude<Chip, "all">;
  weight: "card" | "line";
  icon: LucideIcon;
  /** Icon colour (text-*-text keeps it legible in dark mode). */
  tone: "neutral" | "green" | "amber" | "red" | "blue";
  title: ReactNode;
  pill?: { label: string; tone: StatusTone };
  body?: ReactNode;
  /** Expandable detail (field diffs, the import burst). */
  expand?: ReactNode;
  actor: string;
  avatar?: string;
  /** Link for the card's "Open" (emails → Conversation). */
  open?: string;
}

const money = (n: unknown) => formatMoney(typeof n === "number" ? n : Number(n), { compact: true });

function changesOf(data: Record<string, unknown> | null): { field: string; from: unknown; to: unknown }[] {
  const raw = data?.changes;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, { from?: unknown; to?: unknown }>).map(([field, v]) => ({ field, from: v?.from, to: v?.to }));
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

const FIELD_LABELS: Record<string, string> = {
  people_booked: "Visitors",
  group_type: "Kind of group",
  contact_mobile: "Mobile",
  contact_email: "Email",
  hold_expires_on: "Hold expires",
  price_per_person: "Price per visitor",
  deposit_due: "Deposit",
  internal_notes: "Internal note",
  customer_notes: "Customer notes",
  customer_vat_number: "VAT number",
};

function DiffList({ list }: { list: { field: string; from: unknown; to: unknown }[] }) {
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {list.map((c) => (
        <li key={c.field} className="text-muted-foreground">
          <span className="text-foreground">{FIELD_LABELS[c.field] ?? humanise(c.field)}</span>: {fmtValue(c.from)} <span aria-hidden="true">→</span> <span className="text-foreground">{fmtValue(c.to)}</span>
        </li>
      ))}
    </ul>
  );
}

function fromEvent(e: BookingEvent): Entry {
  const actor = e.actor_name ?? "System";
  const base = { key: `event-${e.id}`, at: e.created_at, actor };
  switch (e.kind) {
    case "note":
      return { ...base, chip: "notes", weight: "card", icon: StickyNote, tone: "amber", title: actor, avatar: actor, body: <p className="whitespace-pre-wrap text-body text-foreground">{typeof e.data?.text === "string" ? e.data.text : e.summary}</p> };
    case "payment_recorded":
      return { ...base, chip: "money", weight: "line", icon: Banknote, tone: "green", title: `${money(e.data?.amount)} ${String(e.data?.kind ?? "").toUpperCase()} payment recorded${e.data?.reference ? ` · ${String(e.data.reference)}` : ""}`, pill: { label: "Paid", tone: "green" } };
    case "payment_matched":
      return { ...base, chip: "money", weight: "line", icon: Landmark, tone: "green", title: `Bank credit ${money(e.data?.amount)} matched${e.data?.method ? ` (${String(e.data.method)})` : ""}${e.data?.description ? ` · ${String(e.data.description)}` : ""}`, pill: { label: "Matched", tone: "green" } };
    case "payment_deleted":
      return { ...base, chip: "money", weight: "line", icon: BanknoteX, tone: "red", title: e.summary, pill: { label: "Removed", tone: "red-muted" } };
    case "payment_unmatched":
      return { ...base, chip: "money", weight: "line", icon: BanknoteX, tone: "red", title: e.summary, pill: { label: "Unmatched", tone: "red-muted" } };
    case "status_changed": {
      const from = e.data?.from as string | undefined;
      const to = e.data?.to as string | undefined;
      const reason = e.data?.reason as string | undefined;
      return {
        ...base,
        chip: "changes",
        weight: "line",
        icon: ArrowRightLeft,
        tone: "blue",
        title: (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {from ? <StatusPill status={from} size="sm" /> : null}
            {from && to ? <span aria-hidden="true">→</span> : null}
            {to ? <StatusPill status={to} size="sm" /> : null}
            {reason ? <span className="text-muted-foreground">· {reason}</span> : null}
          </span>
        ),
      };
    }
    case "document_issued": {
      const kind = e.data?.kind as DocumentKind | undefined;
      const id = e.data?.document_id as number | undefined;
      const label = kind ? DOCUMENT_KIND_LABELS[kind] : "Document";
      return {
        ...base,
        chip: "changes",
        weight: "line",
        icon: FileText,
        tone: "blue",
        title: (
          <span>
            {label} <span className="font-mono">{String(e.data?.number ?? "")}</span> issued{e.data?.version ? ` (v${String(e.data.version)})` : ""}
            {id ? (
              <a href={documentPdfUrl(id)} target="_blank" rel="noopener" className="ml-2 text-primary underline-offset-3 hover:underline">
                PDF
              </a>
            ) : null}
          </span>
        ),
        pill: { label, tone: "blue" },
      };
    }
    case "ticket_sent":
      return { ...base, chip: "changes", weight: "line", icon: MessageCircle, tone: "green", title: e.summary, pill: { label: "Ticket", tone: "green" } };
    case "arrivals_recorded":
      return { ...base, chip: "changes", weight: "line", icon: UserCheck, tone: "green", title: `${String(e.data?.count ?? "")} arrived (${String(e.data?.source ?? "manual")})`, pill: { label: "Arrived", tone: "green" } };
    case "email_failed":
      return { ...base, chip: "emails", weight: "line", icon: MailWarning, tone: "red", title: `Email failed: ${e.summary}${e.data?.error ? ` — ${String(e.data.error)}` : ""}`, pill: { label: "Failed", tone: "red" } };
    case "email_sent":
      return { ...base, chip: "emails", weight: "line", icon: Mail, tone: "neutral", title: `Emailed: ${e.summary}`, pill: { label: "Sent", tone: "green-muted" } };
    case "email_received":
      return { ...base, chip: "emails", weight: "line", icon: Inbox, tone: "blue", title: `Received: ${e.summary}`, pill: { label: "Received", tone: "blue" } };
    case "override":
      return { ...base, chip: "changes", weight: "line", icon: SlidersHorizontal, tone: "blue", title: e.summary, pill: { label: "Override", tone: "blue" } };
    case "reminder_dismissed":
      return { ...base, chip: "changes", weight: "line", icon: BellOff, tone: "neutral", title: e.summary };
    case "created":
      return { ...base, chip: "changes", weight: "line", icon: PlusCircle, tone: "green", title: e.summary, pill: { label: "Created", tone: "green" } };
    case "updated": {
      const list = changesOf(e.data);
      if (list.length) {
        return {
          ...base,
          chip: "changes",
          weight: "line",
          icon: Pencil,
          tone: "neutral",
          title: list.length === 1 ? `${FIELD_LABELS[list[0]!.field] ?? humanise(list[0]!.field)} changed` : `${list.length} fields changed`,
          expand: <DiffList list={list} />,
        };
      }
      return { ...base, chip: "changes", weight: "line", icon: e.summary.toLowerCase().includes("question") ? MessageSquareText : Pencil, tone: "neutral", title: e.summary };
    }
    default:
      return { ...base, chip: "changes", weight: "line", icon: Pencil, tone: "neutral", title: e.summary };
  }
}

function fromEmail(m: BookingEmail): Entry {
  const inbound = m.direction === "inbound";
  const failed = m.send_status === "failed";
  const who = inbound ? m.from_name || m.from_email || "Customer" : "Farmyard Park";
  return {
    key: `email-${m.id}`,
    at: m.sent_at,
    chip: "emails",
    weight: "card",
    icon: failed ? MailWarning : inbound ? Inbox : Mail,
    tone: failed ? "red" : inbound ? "blue" : "neutral",
    title: who,
    avatar: who,
    actor: who,
    pill: failed ? { label: "Failed", tone: "red" } : m.kind ? { label: humanise(m.kind), tone: "neutral" } : inbound ? { label: "From", tone: "blue" } : { label: "Sent", tone: "green-muted" },
    body: (
      <div className="min-w-0">
        <div className="truncate text-body font-medium text-foreground">{m.subject ?? "(no subject)"}</div>
        {m.snippet ? <div className="line-clamp-2 text-sm text-muted-foreground">{m.snippet}</div> : null}
        {failed && m.send_error ? <div className="text-sm text-red-text">{m.send_error}</div> : null}
      </div>
    ),
    open: "?tab=conversation",
  };
}

/** Events the sheet import wrote in one burst collapse into a single line. */
function collapseImport(events: BookingEvent[]): { entries: Entry[]; importAt: string | null } {
  const created = events.find((e) => e.kind === "created" && e.data?.source === "import");
  if (!created) return { entries: events.map(fromEvent), importAt: null };
  const stamp = created.created_at;
  const burst = events.filter((e) => e.created_at === stamp || (e.kind === "status_changed" && e.data?.sheet_row !== undefined));
  const burstIds = new Set(burst.map((e) => e.id));
  const rest = events.filter((e) => !burstIds.has(e.id)).map(fromEvent);
  const row = burst.find((e) => e.data?.sheet_row !== undefined)?.data?.sheet_row;
  const entry: Entry = {
    key: `import-${created.id}`,
    at: stamp,
    chip: "changes",
    weight: "line",
    icon: FileSpreadsheet,
    tone: "blue",
    title: `Imported from the booking sheet${row !== undefined ? ` (row ${String(row)})` : ""} · ${burst.length} entries`,
    pill: { label: "Imported", tone: "blue" },
    actor: "Import",
    expand: (
      <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
        {burst.map((e) => (
          <li key={e.id}>{e.summary}</li>
        ))}
      </ul>
    ),
  };
  return { entries: [...rest, entry], importAt: stamp };
}

const ICON_TONE: Record<Entry["tone"], string> = {
  neutral: "text-muted-foreground",
  green: "text-green-text",
  amber: "text-amber-text",
  red: "text-red-text",
  blue: "text-blue-text",
};

export function Activity({ booking }: { booking: BookingDetail }) {
  const [chip, setChip] = useState<Chip>("all");

  const entries = useMemo(() => {
    const emailIds = new Set(booking.emails.map((m) => m.id));
    // Mail that is in the stream already shows as a card; its event is noise.
    const events = booking.events.filter((e) => !((e.kind === "email_sent" || e.kind === "email_received") && typeof e.data?.email_message_id === "number" && emailIds.has(e.data.email_message_id)));
    const { entries: fromEvents } = collapseImport(events);
    const all = [...fromEvents, ...booking.emails.map(fromEmail)];
    all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return all;
  }, [booking.events, booking.emails]);

  const counts = useMemo(() => {
    const c: Record<Chip, number> = { all: entries.length, notes: 0, emails: 0, money: 0, changes: 0 };
    for (const e of entries) c[e.chip] += 1;
    return c;
  }, [entries]);

  const visible = chip === "all" ? entries : entries.filter((e) => e.chip === chip);
  const days: { day: string; items: Entry[] }[] = [];
  for (const e of visible) {
    const day = e.at.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(e);
    else days.push({ day, items: [e] });
  }

  const chips = (
    <SegmentedTabs
      aria-label="Activity filter"
      size="sm"
      value={chip}
      onChange={setChip}
      items={[
        { value: "all", label: "All" },
        { value: "notes", label: "Notes", count: counts.notes },
        { value: "emails", label: "Emails", count: counts.emails },
        { value: "money", label: "Money", count: counts.money },
        { value: "changes", label: "Changes", count: counts.changes },
      ]}
    />
  );

  return (
    <section className="flex flex-col gap-4" aria-labelledby="activity-title">
      <SectionHeader id="activity-title" icon={StickyNote} tone="blue" title="Activity" count={entries.length} actions={<div className="hidden sm:block">{chips}</div>} />
      <div className="sm:hidden">{chips}</div>
      <NoteComposer booking={booking} />
      {visible.length === 0 ? (
        <EmptyState variant="card" icon={StickyNote} title={chip === "all" ? "Nothing on the timeline yet" : `No ${chip} yet`} hint="Notes, emails, money and changes land here as they happen." />
      ) : (
        <ol className="flex flex-col gap-5">
          {days.map(({ day, items }) => (
            <li key={day}>
              <div className="mb-2 flex items-center gap-3">
                <span className="text-label text-muted-foreground uppercase">{dayLabel(day)}</span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
              <ol className="flex flex-col gap-2">
                {items.map((e) => (
                  <li key={e.key}>{e.weight === "card" ? <EntryCard entry={e} /> : <EntryLine entry={e} />}</li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function dayLabel(day: string): string {
  const rel = formatRelativeDay(day);
  if (rel === "Today" || rel === "Yesterday") return rel;
  return `${formatWeekday(day).slice(0, 3)} ${formatDate(day)}`;
}

function EntryCard({ entry }: { entry: Entry }) {
  const Icon = entry.icon;
  const note = entry.chip === "notes";
  return (
    <article className={cn("flex gap-3 rounded-xl bg-card p-3 ring-1 ring-border", note && "edge-amber", entry.tone === "blue" && "edge-blue")}>
      <Avatar className="size-9 rounded-lg">
        <AvatarFallback className={cn("rounded-lg text-sm font-semibold", note ? "bg-amber-soft text-amber-text" : entry.tone === "blue" ? "bg-blue-soft text-blue-text" : "bg-nested text-muted-foreground")}>
          {initials(entry.avatar ?? entry.actor)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Icon aria-hidden="true" className={cn("size-4", ICON_TONE[entry.tone])} />
          <span className="text-body font-medium text-foreground">{entry.title}</span>
          {entry.pill ? <StatusPill tone={entry.pill.tone} label={entry.pill.label} size="sm" dot={false} /> : null}
          {note ? <span className="text-sm text-muted-foreground">only the team sees this</span> : null}
          <span className="ml-auto text-sm tabular text-muted-foreground" title={formatDateTime(entry.at)}>
            {formatTime(entry.at)}
          </span>
        </div>
        <div className="mt-1">{entry.body}</div>
        {entry.open ? (
          <div className="mt-2">
            <Button asChild variant="ghost" size="sm">
              <Link to={entry.open}>Open in Conversation</Link>
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function EntryLine({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const Icon = entry.icon;
  const content = (
    <>
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", ICON_TONE[entry.tone])} />
      <span className="min-w-0 flex-1 text-body text-foreground">{entry.title}</span>
      <span className="flex shrink-0 items-center gap-3 pl-7 sm:pl-0">
        {entry.pill ? <StatusPill tone={entry.pill.tone} label={entry.pill.label} size="sm" dot={false} /> : null}
        <span className="text-sm text-muted-foreground">{entry.actor}</span>
        <span className="text-sm tabular text-muted-foreground" title={formatDateTime(entry.at)}>
          {formatTime(entry.at)}
        </span>
        {entry.expand ? <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} /> : null}
      </span>
    </>
  );
  const rowClass = "flex min-h-row flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 [&>span:first-of-type]:basis-[calc(100%-1.75rem)] sm:[&>span:first-of-type]:basis-auto";
  if (!entry.expand) return <div className={rowClass}>{content}</div>;
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn(rowClass, "w-full rounded-lg text-left outline-none hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring")}>
        {content}
      </button>
      {open ? <div className="mt-1 ml-10 rounded-lg bg-nested px-3 py-2">{entry.expand}</div> : null}
    </div>
  );
}

function NoteComposer({ booking }: { booking: BookingDetail }) {
  const { noteRef } = useBookingActions();
  const addNote = useAddNote(booking.id);
  const [text, setText] = useState("");

  async function submit() {
    const value = text.trim();
    if (!value) return;
    await addNote.mutateAsync({ text: value });
    setText("");
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-border"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="new-note" className="sr-only">
        Add a note
      </label>
      <Textarea
        id="new-note"
        ref={noteRef}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note… (only the team sees it)"
        className="min-h-0 resize-y border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">N focuses this box · Ctrl+Enter adds</span>
        <Button type="submit" size="sm" disabled={!text.trim() || addNote.isPending}>
          {addNote.isPending ? <Spinner data-icon="inline-start" /> : <StickyNote data-icon="inline-start" />}
          Add note
        </Button>
      </div>
    </form>
  );
}
