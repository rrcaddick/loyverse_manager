/**
 * Emails tab: the booking's thread (bodies fetched on expand from
 * /inbox/messages/:id and rendered in a sandboxed iframe), a reply composer
 * that threads onto the booking, and the outbound send log.
 */

import { ChevronDown, Download, Inbox, Mail, MailWarning, Paperclip, Reply, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl, errorMessage } from "@/lib/api";
import { formatDateTime, formatNumber, humanise, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useInboxMessage, useReplyEmail } from "../api";
import { paragraphsToHtml } from "../lib";
import type { BookingDetail, BookingEmail, InboxMessage } from "../types";

export function EmailsTab({ booking }: { booking: BookingDetail }) {
  const emails = booking.emails;
  const last = emails[emails.length - 1];
  // null = untouched: the newest message is open by default.
  const [openState, setOpenIds] = useState<Set<number> | null>(null);
  const openIds = openState ?? new Set(last ? [last.id] : []);

  const outbound = emails.filter((m) => m.direction === "outbound");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,1fr)]">
      <div className="flex flex-col gap-6">
        <Section
          title="Conversation"
          description={
            emails.length
              ? `${formatNumber(emails.length)} ${emails.length === 1 ? "message" : "messages"} linked to ${booking.reference}`
              : "Nothing linked yet. Mail that mentions the reference or comes from the contact's address is linked automatically."
          }
          actions={
            emails.length > 1 ? (
              <Button variant="ghost" size="sm" onClick={() => setOpenIds(openIds.size === emails.length ? new Set() : new Set(emails.map((m) => m.id)))}>
                {openIds.size === emails.length ? "Collapse all" : "Expand all"}
              </Button>
            ) : null
          }
          flush
        >
          {emails.length === 0 ? (
            <EmptyState compact icon={Inbox} title="No emails yet" description="Send the proforma, or attach a message from the inbox." />
          ) : (
            <ol className="divide-y divide-border">
              {emails.map((m) => (
                <EmailMessage
                  key={m.id}
                  message={m}
                  open={openIds.has(m.id)}
                  onOpenChange={(open) =>
                    setOpenIds((s) => {
                      const next = new Set(s ?? openIds);
                      if (open) next.add(m.id);
                      else next.delete(m.id);
                      return next;
                    })
                  }
                />
              ))}
            </ol>
          )}
        </Section>
        <ReplyComposer booking={booking} />
      </div>

      <Section title="Send log" description="Every email this system sent for the booking." flush>
        {outbound.length === 0 ? (
          <EmptyState compact icon={Mail} title="Nothing sent yet" />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {[...outbound].reverse().map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-5 py-3">
                <span className="mt-0.5 text-muted-foreground" aria-hidden="true">
                  {m.send_status === "failed" ? <MailWarning className="size-4 text-destructive" /> : <Mail className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium">{m.kind ? humanise(m.kind) : "Sent from Gmail"}</span>
                    <SendStatus message={m} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">to {(m.to_emails ?? []).join(", ") || "—"}</div>
                  <div className="text-xs text-muted-foreground tabular">{formatDateTime(m.sent_at)}</div>
                  {m.send_error ? <div className="mt-1 text-xs text-destructive">{m.send_error}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function SendStatus({ message }: { message: BookingEmail }) {
  if (message.direction !== "outbound") return null;
  if (message.send_status === "failed") return <StatusBadge status="failed" label="Failed" tone="red" />;
  if (message.send_status === "sent") return <StatusBadge status="sent" label="Sent" tone="green-muted" />;
  return <StatusBadge status="synced" label="Synced" tone="neutral" dot={false} />;
}

// ----------------------------------------------------------------- message

function EmailMessage({ message, open, onOpenChange }: { message: BookingEmail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const inbound = message.direction === "inbound";
  const full = useInboxMessage(message.id, open);
  const name = inbound ? message.from_name || message.from_email || "Customer" : message.from_name || "Farmyard Park";

  return (
    <li className={cn("px-5 py-3", !inbound && "bg-muted/25")}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={`${open ? "Collapse" : "Expand"} message from ${name}, ${formatDateTime(message.sent_at)}`}
          >
            <Avatar className={cn("size-8 rounded-lg", inbound ? "bg-status-blue-bg" : "bg-primary/10")}>
              <AvatarFallback className={cn("rounded-lg text-xs font-semibold", inbound ? "bg-status-blue-bg text-status-blue-fg" : "bg-primary/10 text-primary")}>
                {initials(name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium text-foreground">{name}</span>
                {inbound ? <span className="text-xs text-muted-foreground">{message.from_email}</span> : <span className="text-xs text-muted-foreground">to {(message.to_emails ?? []).join(", ")}</span>}
                <span className="ml-auto text-xs text-muted-foreground tabular">{formatDateTime(message.sent_at)}</span>
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">
                <span className={cn("truncate", open ? "text-foreground" : "text-foreground")}>{message.subject ?? "(no subject)"}</span>
                {message.kind ? <StatusBadge status={message.kind} label={humanise(message.kind)} tone="neutral" dot={false} /> : null}
                <SendStatus message={message} />
                {message.has_attachments ? <Paperclip aria-hidden="true" className="size-3.5 text-muted-foreground" /> : null}
              </span>
              {!open && message.snippet ? <span className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{message.snippet}</span> : null}
            </span>
            <ChevronDown aria-hidden="true" className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 pl-11">
            {full.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : full.isError ? (
              <p className="text-sm text-destructive">{errorMessage(full.error)}</p>
            ) : full.data ? (
              <MessageBody message={full.data} />
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function MessageBody({ message }: { message: InboxMessage }) {
  const [plain, setPlain] = useState(!message.body_html);
  return (
    <div className="flex flex-col gap-3">
      {message.body_html && !plain ? (
        <HtmlFrame html={message.body_html} title={`Email: ${message.subject ?? "message"}`} />
      ) : (
        <pre className="max-h-[32rem] overflow-auto rounded-lg border border-border bg-card p-3 font-sans text-sm whitespace-pre-wrap scrollbar-thin">
          {message.body_text || "(empty message)"}
        </pre>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {message.body_html && message.body_text ? (
          <button type="button" className="underline-offset-3 hover:underline" onClick={() => setPlain((p) => !p)}>
            {plain ? "Show formatted" : "Show plain text"}
          </button>
        ) : null}
        {message.cc_emails?.length ? <span>cc {message.cc_emails.join(", ")}</span> : null}
      </div>
      {message.attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <li key={a.id}>
              <Button asChild variant="outline" size="sm">
                <a href={apiUrl(`/inbox/attachments/${a.id}`)} download={a.filename}>
                  <Download data-icon="inline-start" />
                  <span className="max-w-56 truncate">{a.filename}</span>
                  <span className="text-muted-foreground tabular">{formatBytes(a.size_bytes)}</span>
                </a>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Sandboxed rendering of customer HTML. Scripts, forms and top-level
 * navigation stay blocked (no allow-scripts / allow-forms / allow-top-navigation);
 * allow-same-origin is granted only so the parent can read the document's
 * height for auto-sizing, and links open in a new tab.
 */
function HtmlFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: cid:; style-src 'unsafe-inline'; font-src https: data:">` +
      `<base target="_blank">` +
      `<style>html,body{margin:0;padding:0}body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f1d1a;background:#fff;padding:12px;word-break:break-word}img{max-width:100%;height:auto}blockquote{border-left:2px solid #ddd;margin:0;padding-left:10px;color:#555}</style>` +
      `</head><body>${html}</body></html>`,
    [html],
  );

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    const next = Math.min(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 80), 2400);
    setHeight(next + 8);
  }, []);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const onLoad = () => {
      measure();
      const doc = frame.contentDocument;
      doc?.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
    };
    frame.addEventListener("load", onLoad);
    const timer = window.setTimeout(measure, 300);
    return () => {
      frame.removeEventListener("load", onLoad);
      window.clearTimeout(timer);
    };
  }, [measure, srcDoc]);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={{ height }}
      className="w-full rounded-lg border border-border bg-white"
    />
  );
}

// --------------------------------------------------------------- composer

function replySubject(emails: BookingEmail[], booking: BookingDetail): string {
  const lastInbound = [...emails].reverse().find((m) => m.direction === "inbound" && m.subject);
  const base = lastInbound?.subject ?? emails[emails.length - 1]?.subject;
  if (base) return /^re:/i.test(base.trim()) ? base.trim() : `Re: ${base.trim()}`;
  return `${booking.reference} – ${booking.group_name}`;
}

function ReplyComposer({ booking }: { booking: BookingDetail }) {
  const reply = useReplyEmail(booking.id);
  const [subject, setSubject] = useState(() => replySubject(booking.emails, booking));
  const [body, setBody] = useState("");
  const [attach, setAttach] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const canSend = !!booking.contact_email && body.trim().length > 0;

  return (
    <Section
      title="Reply"
      description={booking.contact_email ? `Sends from the bookings mailbox to ${booking.contact_email}, threaded onto this conversation.` : "Add a contact email to the booking before replying."}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) setConfirm(true);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reply-subject">Subject</Label>
          <Input id="reply-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!booking.contact_email} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reply-body">Message</Label>
          <Textarea
            id="reply-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Hi ${booking.contact_name.split(" ")[0] ?? ""},\n\n`}
            disabled={!booking.contact_email}
          />
          <p className="text-xs text-muted-foreground">Blank lines start a new paragraph. Your signature from the email settings is added automatically.</p>
        </div>
        {booking.documents.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Attach documents</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {booking.documents.map((d) => {
                const id = `attach-${d.id}`;
                return (
                  <div key={d.id} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={attach.has(d.id)}
                      onCheckedChange={(v) =>
                        setAttach((s) => {
                          const next = new Set(s);
                          if (v) next.add(d.id);
                          else next.delete(d.id);
                          return next;
                        })
                      }
                    />
                    <Label htmlFor={id} className="font-normal">
                      {d.label} {d.number} <span className="text-muted-foreground">v{d.version}</span>
                    </Label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <Button type="submit" disabled={!canSend || reply.isPending}>
            <Reply data-icon="inline-start" />
            Send reply
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Send this reply?"
        confirmLabel="Send"
        onConfirm={async () => {
          const detail = await reply.mutateAsync({
            subject: subject.trim() || undefined,
            body_html: paragraphsToHtml(body),
            attach_document_ids: [...attach],
          });
          toast.success(`Reply sent to ${detail.action_result?.to ?? booking.contact_email}`);
          setBody("");
          setAttach(new Set());
        }}
      >
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
          <dt className="text-muted-foreground">To</dt>
          <dd className="font-medium break-all">{booking.contact_email}</dd>
          <dt className="text-muted-foreground">Subject</dt>
          <dd>{subject || "(default)"}</dd>
          <dt className="text-muted-foreground">Attachments</dt>
          <dd>{attach.size ? booking.documents.filter((d) => attach.has(d.id)).map((d) => d.filename).join(", ") : "None"}</dd>
        </dl>
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Send aria-hidden="true" className="size-3" />
          {body.trim().split(/\s+/).length} words
        </p>
      </ConfirmDialog>
    </Section>
  );
}
