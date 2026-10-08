import { ArrowUpRight, Paperclip, Reply } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { BookingLine } from "@/features/queue/booking-line";
import type { NeedsReplyItem, QueueSection } from "@/features/queue/types";
import { formatDateTime, formatRelativeDay } from "@/lib/format";
import { cn } from "@/lib/utils";

import { QueueList, QueueRow, QueueSectionCard, daysBetween } from "../shared";

type Section = Extract<QueueSection, { key: "needs_reply" }>;

export function NeedsReplySection({ section, today }: { section: Section; today: string }) {
  return (
    <QueueSectionCard sectionKey={section.key} title={section.title} count={section.count}>
      <QueueList
        items={section.items}
        getKey={(item) => item.message.id}
        label="conversations"
        render={(item) => <NeedsReplyRow item={item} today={today} />}
      />
    </QueueSectionCard>
  );
}

function NeedsReplyRow({ item, today }: { item: NeedsReplyItem; today: string }) {
  const { booking, message } = item;
  const waiting = daysBetween(message.sent_at, today);
  const urgent = waiting !== null && waiting >= 3;
  return (
    <QueueRow
      actions={
        <>
          <Button asChild variant="outline" size="sm">
            <Link to={`/inbox/${message.id}`}>
              <Reply data-icon="inline-start" />
              Open thread
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to={`/bookings/${booking.id}`}>
              Open booking
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </>
      }
    >
      <BookingLine booking={booking} />
      <div className="rounded-lg bg-muted/50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{message.from_name || message.from_email}</span>
          {message.from_name && message.from_email ? <span className="truncate">{message.from_email}</span> : null}
          <span aria-hidden="true">·</span>
          <time dateTime={message.sent_at} title={formatDateTime(message.sent_at)}>
            {formatRelativeDay(message.sent_at)}
          </time>
          {waiting !== null && waiting > 0 ? (
            <span className={cn("rounded-md px-1.5 py-px tabular", urgent ? "bg-status-amber-bg text-status-amber-fg" : "bg-muted text-muted-foreground")}>
              waiting {waiting} {waiting === 1 ? "day" : "days"}
            </span>
          ) : null}
          {message.has_attachments ? <Paperclip aria-label="Has attachments" className="size-3.5" /> : null}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-foreground">{message.subject || "(no subject)"}</div>
        {message.snippet ? <p className="line-clamp-2 text-sm text-muted-foreground">{message.snippet}</p> : null}
      </div>
    </QueueRow>
  );
}
