/**
 * WorkRow — one line per item with a single verb (UI round two, 26 and
 * 29 Oct 2026):
 *
 *   ● FY1737 Group name · Sat 7 Nov · 24 people                    [Send reminder]
 *     Booking expires in 1 d · deposit R1 680 outstanding
 *
 * 56 px, status dot in the booking's colour, a 3 px edge bar when the row
 * has waited a week or the expiry is already past. The row itself opens the
 * booking or the enquiry where the work is done (no side panel); `primary`
 * is the one verb. On the focused row `1` fires the verb and Enter opens
 * the row. A verb that needs a date (Extend) opens its popover here.
 */

import type { KeyboardEvent, MouseEvent } from "react";
import { useState } from "react";

import { EdgeBar, type EdgeTone } from "@/components/edge-bar";
import { KeyboardHint } from "@/components/keyboard-hint";
import { BOOKING_STATUS_META, StatusDot, type StatusTone } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { isEditableTarget } from "@/hooks/use-keyboard";
import { formatDateShort, formatMoney, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { WorkAction, WorkRow as WorkRowData } from "../types";
import { ExtendHoldPopover } from "./action-dialogs";

export interface ActionInput {
  /** extend_hold: the chosen date. */
  date?: string;
}

export interface WorkRowProps {
  row: WorkRowData;
  /** An action on this row is in flight. */
  busy?: boolean;
  /** Suppress the urgency edge bar (the Stale view, where every row is old). */
  quiet?: boolean;
  /** Open the booking or enquiry the row is about. */
  onOpen: (row: WorkRowData) => void;
  onAction: (action: WorkAction, row: WorkRowData, input?: ActionInput) => void;
  className?: string;
}

const INTERACTIVE = "a, button, input, select, textarea, [role='button'], [role='menuitem'], [data-no-row-click]";

function edgeTone(row: WorkRowData): EdgeTone | null {
  if (row.kind === "hold" && row.age_days > 0) return "red";
  if (row.kind !== "ticket" && row.age_days >= 7) return "amber";
  return null;
}

function dotTone(row: WorkRowData): { tone: StatusTone; label: string } {
  if (row.booking) {
    const meta = BOOKING_STATUS_META[row.booking.status];
    return { tone: meta.tone, label: meta.label };
  }
  return { tone: "blue", label: "Enquiry" };
}

export function WorkRow({ row, busy = false, quiet = false, onOpen, onAction, className }: WorkRowProps) {
  const [extendOpen, setExtendOpen] = useState(false);
  const dot = dotTone(row);
  const edge = quiet ? null : edgeTone(row);
  const needsDate = row.primary.action === "extend_hold";

  function fire() {
    if (busy) return;
    if (needsDate) setExtendOpen(true);
    else onAction(row.primary, row);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (isEditableTarget(event.target)) return;
    if (event.key === "1") {
      event.preventDefault();
      fire();
    } else if (event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault();
      onOpen(row);
    }
  }

  function onClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (!target || !event.currentTarget.contains(target) || target.closest(INTERACTIVE)) return;
    onOpen(row);
  }

  const titleMeta: string[] = [];
  if (row.booking) {
    titleMeta.push(formatDateShort(row.booking.visit_date));
    if (row.booking.people_booked > 0) titleMeta.push(pluralise(row.booking.people_booked, "person", "people"));
  }

  const button = (
    <Button variant="default" className="min-w-32" disabled={busy} onClick={needsDate ? undefined : fire} aria-label={`${row.primary.verb} · ${row.booking?.reference ?? row.title}`}>
      {row.primary.verb}
      <KeyboardHint keys={["1"]} className="hidden group-focus-within/row:inline-flex" />
    </Button>
  );

  return (
    <EdgeBar
      as="li"
      tone={edge}
      data-work-row={row.id}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={onClick}
      className={cn(
        "group/row @container/row flex min-h-row-queue cursor-pointer items-center gap-3 py-2 pr-3 pl-4 outline-none transition-colors hover:bg-nested",
        "focus-visible:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:ring-inset",
        className,
      )}
    >
      <StatusDot tone={dot.tone} label={dot.label} className="shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-x-2 overflow-hidden text-body">
          {row.booking ? <span className="shrink-0 font-mono text-sm text-muted-foreground">{row.booking.reference}</span> : null}
          <span className="min-w-0 truncate font-semibold text-foreground">{row.booking?.group_name ?? row.title}</span>
          {titleMeta.length > 0 ? <span className="hidden shrink-0 text-sm text-muted-foreground tabular @xl/row:inline">· {titleMeta.join(" · ")}</span> : null}
          {row.amount !== null ? <span className="hidden shrink-0 text-sm text-foreground tabular @3xl/row:inline">· {formatMoney(row.amount, { compact: true })}</span> : null}
        </div>
        <div className="truncate text-sm text-muted-foreground">{row.context}</div>
      </div>

      <div className="flex shrink-0 items-center" data-no-row-click>
        {needsDate && row.primary.action === "extend_hold" ? (
          <ExtendHoldPopover
            open={extendOpen}
            onOpenChange={setExtendOpen}
            reference={row.booking?.reference ?? ""}
            currentHold={row.primary.hold_expires_on}
            visitDate={row.booking?.visit_date ?? null}
            busy={busy}
            onPick={(date) => {
              setExtendOpen(false);
              onAction(row.primary, row, { date });
            }}
          >
            {button}
          </ExtendHoldPopover>
        ) : (
          button
        )}
      </div>
    </EdgeBar>
  );
}
