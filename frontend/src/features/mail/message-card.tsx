/**
 * The four skins of a conversation stream (spec §7):
 *
 *   incoming  paper card, full width, initials avatar, blue "From" dot
 *   outgoing  indented one avatar column, accent tint with a 2 px accent rule,
 *             "Farmyard Park · Linda", kind chip, send state
 *   note      amber card, "Note · only the team sees this"
 *   event     one muted line with an icon, linking to the document or payment
 *
 * Older messages collapse to one line (name · first line · time) and open on
 * click; the stream decides which are open. An inbound message the person is
 * still waiting on carries a small amber "Unanswered" mark (v3: decided per
 * person by the server, cleared by any reply to them or by Done).
 */

import {
  ArrowRightLeft,
  Banknote,
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  FileText,
  Landmark,
  Mail,
  Paperclip,
  Pencil,
  RotateCw,
  StickyNote,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";
import { formatTime, initials, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { cardTime, firstLine, formatBytes, kindChip, senderName } from "./lib";
import { MessageHtml, MessageText } from "./message-body";
import type { EventItem, MessageItem, NoteItem } from "./types";

// ----------------------------------------------------------------- shared

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-grey-soft text-sm font-semibold text-grey-text select-none", className)}>
      {initials(name)}
    </span>
  );
}

function AttachmentChips({ message }: { message: MessageItem }) {
  if (!message.attachments.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={pluralise(message.attachments.length, "attachment")}>
      {message.attachments.map((a) => (
        <li key={a.id}>
          <a
            href={a.url}
            target="_blank"
            rel="noopener"
            className="inline-flex h-7 max-w-64 items-center gap-1.5 rounded-md bg-nested px-2 text-sm text-foreground ring-1 ring-border hover:bg-muted"
          >
            <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{a.filename}</span>
            {a.size_bytes ? <span className="shrink-0 text-xs text-muted-foreground tabular">{formatBytes(a.size_bytes)}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

interface BodyProps {
  message: MessageItem;
  expandAll: boolean;
  onViewOriginal?: (message: MessageItem) => void;
}

/** New text, then the quoted history and signature behind labelled toggles. */
function MessageBody({ message, expandAll, onViewOriginal }: BodyProps) {
  const [quoted, setQuoted] = useState(false);
  const [signature, setSignature] = useState(false);
  const showQuoted = quoted || expandAll;
  const showSignature = signature || expandAll;
  const label = message.subject ?? "message";
  const hasNew = Boolean(message.body_new_html?.trim() || message.body_new_text?.trim());

  return (
    <div className="flex flex-col gap-3">
      {message.body_new_html ? (
        <MessageHtml html={message.body_new_html} label={label} />
      ) : message.body_new_text ? (
        <MessageText text={message.body_new_text} />
      ) : null}
      {!hasNew ? <p className="text-sm text-muted-foreground italic">This message has no text.</p> : null}
      {showSignature && message.signature_text ? <MessageText text={message.signature_text} muted className="text-sm" /> : null}
      {showQuoted && message.body_quoted_html ? (
        <div className="border-l-2 border-border pl-3">
          <MessageHtml html={message.body_quoted_html} label={`Quoted history: ${label}`} controls={false} />
        </div>
      ) : null}
      <AttachmentChips message={message} />
      {message.has_quoted || message.has_signature || message.has_original_html ? (
        <div className="-ml-2 flex flex-wrap items-center gap-x-1 gap-y-0.5">
          {message.has_quoted ? (
            <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" aria-expanded={showQuoted} onClick={() => setQuoted((v) => !v)}>
              {showQuoted ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
              {showQuoted ? "Hide quoted history" : `Show quoted history${message.quoted_lines ? ` (${pluralise(message.quoted_lines, "line")})` : ""}`}
            </Button>
          ) : null}
          {message.has_signature ? (
            <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" aria-expanded={showSignature} onClick={() => setSignature((v) => !v)}>
              {showSignature ? "Hide signature" : "Show signature"}
            </Button>
          ) : null}
          {message.has_original_html && onViewOriginal ? (
            <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onViewOriginal(message)}>
              View original
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------- messages

/** The small amber mark on a message nobody has answered yet. */
export function UnansweredMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-amber-soft px-1.5 text-xs font-medium text-amber-text ring-1 ring-pill-ring ring-inset", className)}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-solid" />
      Unanswered
    </span>
  );
}

interface MessageCardProps extends BodyProps {
  open: boolean;
  onToggle: () => void;
  /** v3: show the amber "Unanswered" mark (inbound only). */
  unanswered?: boolean;
  /** Resend a failed outbound message (refills the composer). */
  onRetry?: (message: MessageItem) => void;
  /** Scroll anchor for the newest message. */
  id?: string;
}

export function MessageCard(props: MessageCardProps) {
  const { message, open } = props;
  if (!open) return <CollapsedLine {...props} />;
  return message.type === "inbound" ? <InboundCard {...props} /> : <OutboundCard {...props} />;
}

function CollapsedLine({ message, onToggle, id, unanswered }: MessageCardProps) {
  const inbound = message.type === "inbound";
  const name = inbound ? senderName(message) : "Farmyard Park";
  const chip = kindChip(message);
  const failed = message.send_status === "failed";
  return (
    <button
      id={id}
      type="button"
      onClick={onToggle}
      aria-expanded={false}
      className={cn(
        "flex h-11 w-full min-w-0 items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:outline-none",
        !inbound && "ml-6 w-[calc(100%-1.5rem)] border-l-2 border-primary/60 sm:ml-11 sm:w-[calc(100%-2.75rem)]",
      )}
    >
      {inbound ? (
        <Avatar name={name} className="size-6 text-xs" />
      ) : (
        <CornerUpLeft aria-hidden="true" className="size-4 shrink-0 text-direction-out" />
      )}
      <span className="w-32 shrink-0 truncate text-body font-medium text-foreground">{name}</span>
      {chip ? <span className="shrink-0 rounded-md bg-nested px-1.5 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">{chip}</span> : null}
      {inbound && unanswered ? <UnansweredMark /> : null}
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{firstLine(message)}</span>
      {message.has_attachments ? <Paperclip aria-label="Has attachments" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      <span className={cn("shrink-0 text-xs tabular", failed ? "font-medium text-red-text" : "text-muted-foreground")}>{failed ? "Failed" : formatTime(message.at)}</span>
    </button>
  );
}

function InboundCard({ message, onToggle, id, unanswered, ...body }: MessageCardProps) {
  const name = senderName(message);
  return (
    <article id={id} className={cn("rounded-xl bg-card p-card ring-1 ring-border", unanswered && "edge-amber")} aria-label={`From ${name}${unanswered ? " (unanswered)" : ""}`} data-unanswered={unanswered ? "true" : undefined}>
      <header className="mb-3 flex items-start gap-3">
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1.5 text-label text-blue-text uppercase">
              <span aria-hidden="true" className="size-2 rounded-full bg-direction-in" />
              From
            </span>
            <span className="truncate text-body font-semibold text-foreground">{name}</span>
            {message.from_email && message.from_email !== name ? <span className="truncate text-sm text-muted-foreground">{message.from_email}</span> : null}
          </div>
          {message.cc_emails.length ? <div className="truncate text-sm text-muted-foreground">cc {message.cc_emails.join(", ")}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {unanswered ? <UnansweredMark /> : null}
          <time dateTime={message.at} className="text-sm text-muted-foreground tabular">
            {cardTime(message.at)}
          </time>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Collapse message" onClick={onToggle}>
            <ChevronUp />
          </Button>
        </div>
      </header>
      <MessageBody message={message} {...body} />
    </article>
  );
}

function OutboundCard({ message, onToggle, onRetry, id, unanswered: _unanswered, ...body }: MessageCardProps) {
  const chip = kindChip(message);
  const failed = message.send_status === "failed";
  const sender = message.sent_by_name || (message.kind ? "Farmyard Park" : message.from_name || "Farmyard Park");
  return (
    <article
      id={id}
      className={cn(
        "ml-6 rounded-xl border-l-2 p-card ring-1 ring-border sm:ml-11",
        failed ? "border-red-solid bg-card" : "border-primary bg-[color-mix(in_oklch,var(--primary)_6%,var(--card))]",
      )}
      aria-label={`Sent by ${sender}`}
    >
      <header className="mb-3 flex items-start gap-3">
        <CornerUpLeft aria-hidden="true" className="mt-1 size-4 shrink-0 text-direction-out" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-body font-semibold text-foreground">
              Farmyard Park{sender && sender !== "Farmyard Park" ? <span className="font-normal text-muted-foreground"> · {sender}</span> : null}
            </span>
            {chip ? <span className="rounded-md bg-card px-1.5 py-0.5 text-xs font-medium text-foreground ring-1 ring-border">{chip}</span> : null}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            to {message.to_emails.join(", ")}
            {message.cc_emails.length ? ` · cc ${message.cc_emails.join(", ")}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {failed ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-text" role="status">
              Failed
              {onRetry ? (
                <Button type="button" variant="ghost" size="xs" className="text-red-text" onClick={() => onRetry(message)}>
                  <RotateCw data-icon="inline-start" />
                  Retry
                </Button>
              ) : null}
            </span>
          ) : (
            <time dateTime={message.at} className="text-sm text-muted-foreground tabular">
              Sent {cardTime(message.at)}
            </time>
          )}
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Collapse message" onClick={onToggle}>
            <ChevronUp />
          </Button>
        </div>
      </header>
      {failed && message.send_error ? (
        <p className="mb-3 rounded-md bg-red-soft px-3 py-2 text-sm text-red-text" role="alert">
          {message.send_error}
        </p>
      ) : null}
      <MessageBody message={message} {...body} />
    </article>
  );
}

/** The optimistic card shown while a reply is in flight. */
export function PendingCard({ to, subject, html, state, error, onRetry }: { to: string[]; subject: string; html: string; state: "sending" | "failed"; error?: string; onRetry?: () => void }) {
  return (
    <article
      className={cn("ml-6 rounded-xl border-l-2 p-card ring-1 ring-border sm:ml-11", state === "failed" ? "border-red-solid bg-card" : "border-primary bg-[color-mix(in_oklch,var(--primary)_6%,var(--card))] opacity-80")}
      aria-busy={state === "sending"}
      aria-live="polite"
    >
      <header className="mb-3 flex items-start gap-3">
        <CornerUpLeft aria-hidden="true" className="mt-1 size-4 shrink-0 text-direction-out" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-body font-semibold text-foreground">Farmyard Park</span>
            <span className="rounded-md bg-card px-1.5 py-0.5 text-xs font-medium text-foreground ring-1 ring-border">Reply</span>
          </div>
          <div className="truncate text-sm text-muted-foreground">
            to {to.join(", ")} · {subject}
          </div>
        </div>
        {state === "failed" ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-text" role="status">
            Failed
            {onRetry ? (
              <Button type="button" variant="ghost" size="xs" className="text-red-text" onClick={onRetry}>
                <RotateCw data-icon="inline-start" />
                Retry
              </Button>
            ) : null}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground" role="status">
            Sending…
          </span>
        )}
      </header>
      {error ? (
        <p className="mb-3 rounded-md bg-red-soft px-3 py-2 text-sm text-red-text" role="alert">
          {error}
        </p>
      ) : null}
      <MessageHtml html={html} label={subject} controls={false} />
    </article>
  );
}

// ------------------------------------------------------------------ notes

export function NoteCard({ note }: { note: NoteItem }) {
  return (
    <article className="ml-6 rounded-xl bg-amber-soft p-4 ring-1 ring-amber-solid/25 sm:ml-11" aria-label="Internal note">
      <header className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="inline-flex items-center gap-1.5 text-label text-amber-text uppercase">
          <StickyNote aria-hidden="true" className="size-3.5" />
          Note · only the team sees this
        </span>
        <span className="ml-auto text-sm text-amber-text/90 tabular">
          {note.author_name ? `${note.author_name} · ` : ""}
          {cardTime(note.at)}
        </span>
      </header>
      <p className="text-body whitespace-pre-wrap text-foreground">{note.body}</p>
    </article>
  );
}

// ----------------------------------------------------------------- events

const EVENT_ICONS: Record<string, LucideIcon> = {
  payment_matched: Landmark,
  payment_recorded: Banknote,
  payment_deleted: Banknote,
  payment_unmatched: Landmark,
  document_issued: FileText,
  status_changed: ArrowRightLeft,
  ticket_sent: Ticket,
  arrivals_recorded: Users,
  email_sent: Mail,
  email_received: Mail,
  email_failed: Mail,
  created: Pencil,
  updated: Pencil,
  override: Pencil,
};

function eventHref(event: EventItem): string | null {
  const link = event.link;
  if (!link) return null;
  switch (link.kind) {
    case "document":
      return link.id ? `${API_BASE}/documents/${link.id}/pdf` : null;
    case "payment":
      return link.bank_transaction_id ? `/bank?tx=${link.bank_transaction_id}` : link.booking_id ? `/bookings/${link.booking_id}` : null;
    case "booking":
      return link.booking_id ? `/bookings/${link.booking_id}` : link.id ? `/bookings/${link.id}` : null;
    case "message":
      return null;
    default:
      return null;
  }
}

export function EventLine({ event }: { event: EventItem }) {
  const Icon = EVENT_ICONS[event.kind] ?? Pencil;
  const href = eventHref(event);
  const external = href?.startsWith(API_BASE);
  const content = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{event.summary}</span>
      <time dateTime={event.at} className="shrink-0 text-xs tabular">
        {cardTime(event.at)}
      </time>
    </>
  );
  const className = "ml-6 flex min-h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground sm:ml-11";
  if (href && external) {
    return (
      <a href={href} target="_blank" rel="noopener" className={cn(className, "hover:bg-nested hover:text-foreground")}>
        {content}
      </a>
    );
  }
  if (href) {
    return (
      <Link to={href} className={cn(className, "hover:bg-nested hover:text-foreground")}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}
