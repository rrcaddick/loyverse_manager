/**
 * Reading pane: the selected message's whole Gmail thread in order, with the
 * selected one expanded, plus the action bar that drives triage.
 */

import { ArrowLeft, Ban, Check, ChevronDown, Download, ExternalLink, FileText, Link2, Link2Off, Paperclip, Reply, RotateCcw, Send, Sparkles, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { formatBytes, useBounceBack, useDetachMessage, useMessage, useResolveMessage, useThread } from "./api";
import { AttachDialog } from "./attach-dialog";
import { ComposerDialog, type ComposerTarget } from "./composer-dialog";
import { CreateBookingDialog } from "./create-booking-dialog";
import { MessageBody } from "./message-body";
import { counterpart, messageTime } from "./format";
import { BookingChip, KindBadge, ReviewBadge, RowMarkers, SenderAvatar } from "./message-meta";
import type { FullMessage } from "./types";

interface ThreadViewProps {
  messageId: number;
  /** Shown on phones to return to the list. */
  onBack?: () => void;
}

export function ThreadView({ messageId, onBack }: ThreadViewProps) {
  const message = useMessage(messageId);
  const thread = useThread(message.data?.gmail_thrid ?? null);
  const selected = message.data ?? null;
  const messages = useMemo<FullMessage[]>(() => {
    if (thread.data?.messages?.length) return thread.data.messages;
    return selected ? [selected] : [];
  }, [thread.data, selected]);

  // InboxPage remounts this view per message (key={messageId}), so the
  // initial expansion set never needs resetting.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([messageId]));

  const attachOpen = useState(false);
  const createOpen = useState(false);
  const composer = useSubjectDialog<ComposerTarget>();
  const detaching = useSubjectDialog<FullMessage>();
  const bouncing = useSubjectDialog<FullMessage>();
  const detach = useDetachMessage();
  const resolve = useResolveMessage();
  const bounce = useBounceBack();

  if (message.isPending) return <ThreadSkeleton />;
  if (message.isError || !selected) {
    return (
      <div className="p-6">
        {onBack ? <BackButton onBack={onBack} /> : null}
        <EmptyState compact title="Message not found" description={message.error ? errorMessage(message.error) : "It may have been removed from the mailbox."} action={<Button variant="outline" size="sm" onClick={() => void message.refetch()}>Try again</Button>} />
      </div>
    );
  }

  const booking = selected.booking ?? thread.data?.booking ?? null;
  const pending = selected.review_status === "pending";
  const summary = thread.data?.summary ?? selected.thread ?? null;
  const bounceInfo = selected.bounce_back ?? null;

  async function setReview(status: "resolved" | "not_booking" | "pending") {
    await resolve.mutateAsync({ id: selected!.id, status });
    toast.success(status === "pending" ? "Reopened for review" : status === "resolved" ? "Marked resolved" : "Marked as not a booking");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-5 py-4">
        {onBack ? <BackButton onBack={onBack} /> : null}
        <h2 className="text-lg font-semibold text-foreground">{selected.subject || "(no subject)"}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {booking ? <BookingChip booking={booking} /> : <span className="rounded-md bg-muted px-1.5 py-0.5">Not linked to a booking</span>}
          <ReviewBadge status={selected.review_status} />
          <KindBadge kind={selected.kind} />
          {summary ? (
            <span className="tabular">
              {pluralise(summary.count, "message")}
              {summary.count > 1 ? ` · ${summary.inbound} in, ${summary.outbound} out` : ""}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Message actions">
          <Button variant="outline" size="sm" onClick={() => composer.show({ mode: "reply", message: selected, booking })}>
            <Reply data-icon="inline-start" />
            Reply
          </Button>
          {booking ? (
            <Button variant="ghost" size="sm" onClick={() => detaching.show(selected)}>
              <Link2Off data-icon="inline-start" />
              Detach
            </Button>
          ) : (
            <>
              <Button variant={pending ? "default" : "outline"} size="sm" onClick={() => attachOpen[1](true)}>
                <Link2 data-icon="inline-start" />
                Attach to booking
              </Button>
              <Button variant="outline" size="sm" onClick={() => createOpen[1](true)}>
                <Sparkles data-icon="inline-start" />
                Create booking
              </Button>
            </>
          )}
          {pending ? (
            <>
              <Button variant="ghost" size="sm" disabled={resolve.isPending} onClick={() => void setReview("resolved")}>
                <Check data-icon="inline-start" />
                Mark resolved
              </Button>
              <Button variant="ghost" size="sm" disabled={resolve.isPending} onClick={() => void setReview("not_booking")}>
                <Ban data-icon="inline-start" />
                Not a booking
              </Button>
            </>
          ) : selected.review_status === "resolved" || selected.review_status === "not_booking" ? (
            <Button variant="ghost" size="sm" disabled={resolve.isPending} onClick={() => void setReview("pending")}>
              <RotateCcw data-icon="inline-start" />
              Reopen review
            </Button>
          ) : null}
          {selected.direction === "inbound" && !booking ? (
            <Button variant="ghost" size="sm" onClick={() => bouncing.show(selected)} title={bounceInfo ? `Form link already sent ${formatDate(bounceInfo.last_sent_at)}` : undefined}>
              <Send data-icon="inline-start" />
              Send form link
              {bounceInfo ? <span className="text-xs text-muted-foreground">· sent {formatDate(bounceInfo.last_sent_at)}</span> : null}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {thread.isError ? (
          <Alert variant="destructive" className="m-5">
            <AlertCircle />
            <AlertTitle>Only this message could be loaded</AlertTitle>
            <AlertDescription>{errorMessage(thread.error)}</AlertDescription>
          </Alert>
        ) : null}
        <ol className="divide-y divide-border">
          {messages.map((m) => (
            <MessageCard
              key={m.id}
              message={m}
              isSelected={m.id === messageId}
              siblingCount={messages.length}
              expanded={expanded.has(m.id) || messages.length === 1}
              onToggle={() =>
                setExpanded((set) => {
                  const next = new Set(set);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  return next;
                })
              }
            />
          ))}
        </ol>
        {thread.isPending && selected.gmail_thrid && (selected.thread?.count ?? 1) > 1 ? (
          <div className="flex items-center gap-2 px-5 py-4 text-xs text-muted-foreground" role="status">
            <Skeleton className="size-3 rounded-full" /> Loading the rest of the conversation…
          </div>
        ) : null}
      </div>

      <AttachDialog message={selected} threadCount={summary?.count ?? messages.length} open={attachOpen[0]} onOpenChange={attachOpen[1]} />
      <CreateBookingDialog message={selected} open={createOpen[0]} onOpenChange={createOpen[1]} />
      <ComposerDialog target={composer.subject} open={composer.open} onOpenChange={composer.onOpenChange} />
      <ConfirmDialog
        open={detaching.open}
        onOpenChange={detaching.onOpenChange}
        title={`Detach from ${booking?.reference ?? "the booking"}?`}
        description="The message no longer shows on the booking. An inbound email goes back to the review list."
        confirmLabel="Detach"
        onConfirm={async () => {
          if (!detaching.subject) return;
          await detach.mutateAsync(detaching.subject.id);
        }}
      />
      <ConfirmDialog
        open={bouncing.open}
        onOpenChange={bouncing.onOpenChange}
        title="Send the booking form link?"
        description={
          <>
            Replies to {selected.from_email} with the standard note and a link to the online request form, threaded under their email.
            {bounceInfo ? ` A form link was already sent to this address on ${formatDateTime(bounceInfo.last_sent_at)}.` : ""}
          </>
        }
        confirmLabel="Send link"
        onConfirm={async () => {
          if (!bouncing.subject) return;
          await bounce.mutateAsync(bouncing.subject.id);
        }}
      />
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={onBack}>
      <ArrowLeft data-icon="inline-start" />
      All messages
    </Button>
  );
}

function MessageCard({
  message,
  isSelected,
  siblingCount,
  expanded,
  onToggle,
}: {
  message: FullMessage;
  isSelected: boolean;
  /** Re-scroll when the rest of the thread arrives around the selected message. */
  siblingCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const who = counterpart(message);
  const outbound = message.direction === "outbound";
  const headingId = `message-${message.id}-heading`;

  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: "start" });
  }, [isSelected, siblingCount]);

  return (
    <li ref={ref} className={cn("scroll-mt-2", isSelected && "bg-primary/3")} aria-current={isSelected ? "true" : undefined}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`message-${message.id}-body`}
        className="flex w-full items-start gap-3 px-5 py-3.5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <SenderAvatar name={outbound ? "Farmyard Park" : who.name} outbound={outbound} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span id={headingId} className="min-w-0 truncate text-sm font-medium text-foreground">
              {outbound ? "Farmyard Park" : message.from_name || message.from_email}
              {!outbound && message.from_name && message.from_email ? <span className="ml-1.5 font-normal text-muted-foreground">{message.from_email}</span> : null}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <RowMarkers item={message} />
              <time dateTime={message.sent_at} className="text-xs text-muted-foreground tabular">
                {messageTime(message.sent_at)}
              </time>
              <ChevronDown aria-hidden="true" className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
            </span>
          </div>
          {expanded ? (
            <div className="text-xs text-muted-foreground">
              to {message.to_emails.join(", ") || "—"}
              {message.cc_emails.length > 0 ? ` · cc ${message.cc_emails.join(", ")}` : ""}
              <KindBadge kind={message.kind} />
            </div>
          ) : (
            <div className="truncate text-xs text-muted-foreground">{message.snippet}</div>
          )}
        </div>
      </button>
      {expanded ? (
        <div id={`message-${message.id}-body`} className="px-5 pb-5 pl-16" aria-labelledby={headingId}>
          {message.send_status === "failed" ? (
            <Alert variant="destructive" className="mb-3">
              <AlertCircle />
              <AlertTitle>This email failed to send</AlertTitle>
              <AlertDescription>{message.send_error ?? "The mail server rejected it."}</AlertDescription>
            </Alert>
          ) : null}
          <MessageBody html={message.body_html} text={message.body_text} label={message.subject ?? "message"} />
          <Attachments message={message} />
        </div>
      ) : null}
    </li>
  );
}

function Attachments({ message }: { message: FullMessage }) {
  const skipped = message.attachments_meta.filter((a) => a.skipped);
  if (message.attachments.length === 0 && skipped.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-col gap-1.5" aria-label="Attachments">
      {message.attachments.map((att) => {
        const previewable = /^(image\/|application\/pdf)/.test(att.content_type ?? "");
        return (
          <li key={att.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={att.filename}>
              {att.filename}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular">{formatBytes(att.size_bytes)}</span>
            {previewable ? (
              <Button asChild variant="ghost" size="icon-xs" aria-label={`Open ${att.filename} in a new tab`}>
                <a href={`${att.url}?inline=1`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="icon-xs" aria-label={`Download ${att.filename}`}>
              <a href={att.url} download={att.filename}>
                <Download />
              </a>
            </Button>
          </li>
        );
      })}
      {skipped.map((a) => (
        <li key={a.filename} className="flex items-center gap-2 px-2.5 py-1 text-xs text-muted-foreground">
          <Paperclip aria-hidden="true" className="size-3.5" />
          {a.filename} · not stored ({formatBytes(a.size)} is over the limit)
        </li>
      ))}
    </ul>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-live="polite">
      <div className="space-y-3 border-b border-border px-5 py-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3.5 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-20 rounded-lg" />
          <Skeleton className="h-7 w-32 rounded-lg" />
          <Skeleton className="h-7 w-28 rounded-lg" />
        </div>
      </div>
      <div className="flex gap-3 px-5 py-4">
        <Skeleton className="size-8 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      </div>
    </div>
  );
}
