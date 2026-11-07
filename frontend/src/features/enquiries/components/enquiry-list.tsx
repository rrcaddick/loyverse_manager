/**
 * The left column of /enquiries: one row per conversation waiting on us.
 * Sender, how long they have waited, the subject and the first line; the
 * status pill only when the row is not simply waiting. Rows are links so the
 * selected one lives in the URL (Work and the sidebar land on it).
 */

import { Link } from "react-router";

import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";

import { senderLabel, waitingLabel } from "../lib";
import { ENQUIRY_STATUS_META, type Enquiry } from "../types";

export interface EnquiryListProps {
  items: Enquiry[];
  selectedId: number | null;
  /** Builds the row's href so the bucket, search and page survive the click. */
  hrefFor: (enquiry: Enquiry) => string;
  className?: string;
}

export function EnquiryList({ items, selectedId, hrefFor, className }: EnquiryListProps) {
  return (
    <ul className={cn("divide-y divide-border", className)} aria-label="Enquiries">
      {items.map((e, index) => {
        const selected = e.id === selectedId;
        const meta = ENQUIRY_STATUS_META[e.status];
        return (
          <li key={e.id}>
            <Link
              to={hrefFor(e)}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "flex flex-col gap-0.5 px-4 py-3 outline-none transition-colors",
                "hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:ring-inset",
                selected ? "bg-selection-row text-foreground" : index % 2 === 1 ? "bg-nested" : "bg-card",
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className={cn("min-w-0 truncate text-body text-foreground", e.waiting ? "font-semibold" : "font-medium")}>{senderLabel(e)}</span>
                <span className="shrink-0 text-xs tabular text-muted-foreground">{waitingLabel(e)}</span>
              </span>
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-foreground">{e.subject?.trim() || "(no subject)"}</span>
                {e.status !== "open" ? <StatusPill tone={meta.tone} label={meta.label} size="sm" className="shrink-0" /> : null}
              </span>
              {e.snippet ? <span className="truncate text-sm text-muted-foreground">{e.snippet}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
