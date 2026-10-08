/**
 * WorkRow — the one row anatomy used in every Work view and in Today's
 * "Up next" (spec §4):
 *
 *   ● FY1737 Group name · Sat 7 Nov · 24 people            [Open] [Extend] [⋯]
 *     Hold expires in 1 d · deposit R1 680 outstanding
 *
 * 56 px, status dot in the booking's colour, a 3 px edge bar when the row
 * has waited a week or the hold is already past. `primary` is the one
 * filled verb, `secondary[0]` the ghost, the rest sit under ⋯. On the
 * focused row `1` fires the primary verb, `2` the secondary and Enter
 * selects it. Verbs that need an input open it here — Extend a date
 * popover, Ignore a reason menu — and hand the result to `onAction`.
 */

import { MoreHorizontal } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { EdgeBar, type EdgeTone } from "@/components/edge-bar";
import { KeyboardHint } from "@/components/keyboard-hint";
import { BOOKING_STATUS_META, StatusDot, type StatusTone } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isEditableTarget } from "@/hooks/use-keyboard";
import { formatDateShort, formatMoney, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { IGNORE_REASONS, type ExtendHoldAction, type IgnoreInput, type WorkAction, type WorkRow as WorkRowData } from "../types";
import { ExtendHoldPopover, IgnoreReasonMenu } from "./action-dialogs";

export interface ActionInput {
  /** extend_hold: the chosen date. */
  date?: string;
  /** ignore_transaction: the chosen reason. */
  ignore?: IgnoreInput;
}

export interface WorkRowProps {
  row: WorkRowData;
  /** "compact": title, context and the primary verb only (Today's Up next). */
  variant?: "full" | "compact";
  selected?: boolean;
  /** An action on this row is in flight. */
  busy?: boolean;
  /** Suppress the urgency edge bar (the Stale view, where every row is old). */
  quiet?: boolean;
  onSelect?: (row: WorkRowData) => void;
  onAction: (action: WorkAction, row: WorkRowData, input?: ActionInput) => void;
  as?: "li" | "div";
  className?: string;
}

const INTERACTIVE = "a, button, input, select, textarea, [role='button'], [role='menuitem'], [data-no-row-click]";

function edgeTone(row: WorkRowData): EdgeTone | null {
  if (row.kind === "hold" && row.age_days > 0) return "red";
  if (row.kind === "arrival") return "amber";
  if (row.kind !== "ticket" && row.age_days >= 7) return "amber";
  return null;
}

function dotTone(row: WorkRowData): { tone: StatusTone; label: string } {
  if (row.booking) {
    const meta = BOOKING_STATUS_META[row.booking.status];
    return { tone: meta.tone, label: meta.label };
  }
  return { tone: "amber", label: "Unmatched credit" };
}

function needsInput(action: WorkAction): boolean {
  if (action.action === "extend_hold") return true;
  if (action.action === "ignore_transaction") return !action.reason;
  return false;
}

export function WorkRow({ row, variant = "full", selected = false, busy = false, quiet = false, onSelect, onAction, as = "li", className }: WorkRowProps) {
  const compact = variant === "compact";
  const [openInput, setOpenInput] = useState<"primary" | "secondary" | "menu" | null>(null);
  // An Extend chosen from the ⋯ menu opens its date popover anchored on the ⋯
  // button, after the menu has closed (see onCloseAutoFocus below).
  const [menuExtend, setMenuExtend] = useState<ExtendHoldAction | null>(null);
  const pendingExtend = useRef<ExtendHoldAction | null>(null);
  const secondary = row.secondary[0];
  const rest = row.secondary.slice(1);
  const dot = dotTone(row);
  const edge = quiet ? null : edgeTone(row);

  function fire(action: WorkAction, slot: "primary" | "secondary") {
    if (busy) return;
    if (needsInput(action)) setOpenInput(slot);
    else onAction(action, row);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (isEditableTarget(event.target)) return;
    if (event.key === "1") {
      event.preventDefault();
      fire(row.primary, "primary");
    } else if (event.key === "2" && secondary && !compact) {
      event.preventDefault();
      fire(secondary, "secondary");
    } else if (event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault();
      onSelect?.(row);
    }
  }

  function onClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (!target || !event.currentTarget.contains(target) || target.closest(INTERACTIVE)) return;
    onSelect?.(row);
  }

  const titleMeta: string[] = [];
  if (row.booking) {
    titleMeta.push(formatDateShort(row.booking.visit_date));
    if (row.booking.people_booked > 0) titleMeta.push(pluralise(row.booking.people_booked, "person", "people"));
  }

  return (
    <EdgeBar
      as={as}
      tone={edge}
      data-work-row={row.id}
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onKeyDown={onKeyDown}
      onClick={onClick}
      className={cn(
        "group/row @container/row flex min-h-row-queue items-center gap-3 py-2 pr-3 pl-4 outline-none transition-colors",
        onSelect && "cursor-pointer hover:bg-nested",
        "focus-visible:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:ring-inset",
        selected && "bg-selection-row hover:bg-selection-row",
        className,
      )}
    >
      <StatusDot tone={dot.tone} label={dot.label} className="shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-x-2 overflow-hidden text-body">
          {row.kind === "money" ? (
            <>
              {row.amount !== null ? <span className="shrink-0 font-semibold text-foreground tabular">{formatMoney(row.amount, { compact: true })}</span> : null}
              <span className="min-w-0 truncate font-medium text-foreground">{row.title}</span>
            </>
          ) : (
            <>
              {row.booking ? <span className="shrink-0 font-mono text-sm text-muted-foreground">{row.booking.reference}</span> : null}
              <span className="min-w-0 truncate font-semibold text-foreground">{row.booking?.group_name ?? row.title}</span>
              {/* Date, people and amount only when the row is wide enough (the detail panel narrows the list). */}
              {!compact && titleMeta.length > 0 ? <span className="hidden shrink-0 text-sm text-muted-foreground tabular @xl/row:inline">· {titleMeta.join(" · ")}</span> : null}
              {!compact && row.amount !== null ? <span className="hidden shrink-0 text-sm text-foreground tabular @3xl/row:inline">· {formatMoney(row.amount, { compact: true })}</span> : null}
            </>
          )}
        </div>
        <div className="truncate text-sm text-muted-foreground">{row.context}</div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5" data-no-row-click>
        {!compact && secondary ? (
          <ActionButton
            action={secondary}
            row={row}
            variant="ghost"
            hint="2"
            busy={busy}
            open={openInput === "secondary"}
            onOpenChange={(next) => setOpenInput(next ? "secondary" : null)}
            onAction={onAction}
            onFire={() => fire(secondary, "secondary")}
          />
        ) : null}
        <ActionButton
          action={row.primary}
          row={row}
          variant="default"
          size={compact ? "sm" : "default"}
          hint={compact ? null : "1"}
          busy={busy}
          open={openInput === "primary"}
          onOpenChange={(next) => setOpenInput(next ? "primary" : null)}
          onAction={onAction}
          onFire={() => fire(row.primary, "primary")}
        />
        {!compact && rest.length > 0 ? (
          <ExtendHoldPopover
            anchorOnly
            open={openInput === "menu" && menuExtend !== null}
            onOpenChange={(next) => {
              if (!next) {
                setOpenInput(null);
                setMenuExtend(null);
              }
            }}
            reference={row.booking?.reference ?? ""}
            currentHold={menuExtend?.hold_expires_on ?? null}
            visitDate={row.booking?.visit_date ?? null}
            busy={busy}
            onPick={(date) => {
              const action = menuExtend;
              setOpenInput(null);
              setMenuExtend(null);
              if (action) onAction(action, row, { date });
            }}
          >
            <span className="inline-flex">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`More actions for ${row.booking?.reference ?? row.title}`} disabled={busy}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48"
                onClick={(event) => event.stopPropagation()}
                onCloseAutoFocus={(event) => {
                  // Open the date popover only once the menu has closed, and keep
                  // focus from bouncing to the trigger (which would dismiss it).
                  if (pendingExtend.current) {
                    event.preventDefault();
                    setMenuExtend(pendingExtend.current);
                    setOpenInput("menu");
                    pendingExtend.current = null;
                  }
                }}
              >
                {rest.map((action, index) => {
                  const key = `${action.action}-${index}`;
                  if (action.action === "extend_hold") {
                    return (
                      <DropdownMenuItem
                        key={key}
                        onSelect={() => {
                          pendingExtend.current = action;
                        }}
                      >
                        {action.verb}
                      </DropdownMenuItem>
                    );
                  }
                  if (action.action === "ignore_transaction" && !action.reason) {
                    return (
                      <DropdownMenuSub key={key}>
                        <DropdownMenuSubTrigger>{action.verb}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-48">
                          {IGNORE_REASONS.map((reason) => (
                            <DropdownMenuItem
                              key={reason.label}
                              onSelect={() => onAction(action, row, { ignore: reason.note ? { reason: reason.value, note: reason.note } : { reason: reason.value } })}
                            >
                              {reason.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    );
                  }
                  return (
                    <DropdownMenuItem key={key} onSelect={() => fire(action, "secondary")}>
                      {action.verb}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </ExtendHoldPopover>
        ) : null}
      </div>
    </EdgeBar>
  );
}

interface ActionButtonProps {
  action: WorkAction;
  row: WorkRowData;
  variant: "default" | "ghost";
  size?: "default" | "sm";
  hint: string | null;
  busy: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: WorkRowProps["onAction"];
  onFire: () => void;
}

/** A verb button; wraps itself in the popover or menu its action needs. */
function ActionButton({ action, row, variant, size = "default", hint, busy, open, onOpenChange, onAction, onFire }: ActionButtonProps) {
  const button = (
    <Button variant={variant} size={size} disabled={busy} onClick={needsInput(action) ? undefined : onFire} aria-label={`${action.verb} · ${row.booking?.reference ?? row.title}`}>
      {action.verb}
      {hint ? <KeyboardHint keys={[hint]} className="hidden group-focus-within/row:inline-flex" /> : null}
    </Button>
  );

  if (action.action === "extend_hold") {
    return (
      <ExtendHoldPopover
        open={open}
        onOpenChange={onOpenChange}
        reference={row.booking?.reference ?? ""}
        currentHold={action.hold_expires_on}
        visitDate={row.booking?.visit_date ?? null}
        busy={busy}
        onPick={(date) => {
          onOpenChange(false);
          onAction(action, row, { date });
        }}
      >
        {button}
      </ExtendHoldPopover>
    );
  }

  if (action.action === "ignore_transaction" && !action.reason) {
    return (
      <IgnoreReasonMenu open={open} onOpenChange={onOpenChange} onPick={(ignore) => onAction(action, row, { ignore })}>
        {button}
      </IgnoreReasonMenu>
    );
  }

  return button;
}
