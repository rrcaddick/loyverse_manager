import { ArrowUpRight, Paperclip, Search } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import type { QueueSection, UnmatchedEmailItem } from "@/features/queue/types";
import { formatDateTime, formatRelativeDay } from "@/lib/format";

import { QueueList, QueueRow, QueueSectionCard } from "../shared";

type Section = Extract<QueueSection, { key: "unmatched_emails" }>;

export function UnmatchedEmailsSection({ section }: { section: Section }) {
  return (
    <QueueSectionCard
      sectionKey={section.key}
      title={section.title}
      count={section.count}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/inbox?view=review">
            Review in the inbox
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      }
    >
      <QueueList items={section.items} getKey={(item) => item.id} label="emails" render={(item) => <EmailRow item={item} />} />
    </QueueSectionCard>
  );
}

function EmailRow({ item }: { item: UnmatchedEmailItem }) {
  return (
    <QueueRow
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to={`/inbox/${item.id}`}>
            <Search data-icon="inline-start" />
            Review
          </Link>
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{item.from_name || item.from_email || "Unknown sender"}</span>
        {item.from_name && item.from_email ? <span className="truncate">{item.from_email}</span> : null}
        <span aria-hidden="true">·</span>
        <time dateTime={item.sent_at} title={formatDateTime(item.sent_at)}>
          {formatRelativeDay(item.sent_at)}
        </time>
        {item.has_attachments ? <Paperclip aria-label="Has attachments" className="size-3.5" /> : null}
      </div>
      <div>
        <Link to={`/inbox/${item.id}`} className="block truncate text-sm font-medium text-foreground underline-offset-4 hover:underline">
          {item.subject || "(no subject)"}
        </Link>
        {item.snippet ? <p className="line-clamp-2 text-sm text-muted-foreground">{item.snippet}</p> : null}
      </div>
    </QueueRow>
  );
}
