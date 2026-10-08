/**
 * The record header (spec §6): reference eyebrow, group name at 24 px with
 * the status pill, one 15 px facts line, and on the right ONE computed
 * primary button (from next-step.ts), Edit and the ⋯ overflow in three
 * groups — Send, Record, Status. Impossible actions are hidden; blocked ones
 * are disabled with the reason beneath.
 *
 * `NextStepCard` renders the same rule's strip under the header.
 */

import { AlertTriangle, FileSpreadsheet, MoreHorizontal, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { CopyButton } from "@/components/copy-button";
import { NextStepStrip } from "@/components/next-step-strip";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateShort, formatPhone, humanise, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/types/api";

import { ACTION_LABELS, REMINDER_COPY, STATUS_CHANGE_COPY, availability, type ActionId, type Availability } from "../actions";
import { relativeTo, useGroupTypeLabel } from "../lib";
import { nextStep, type StepVerb } from "../next-step";
import type { BookingDetail, EmailReminderKind } from "../types";
import { useBookingActions } from "../use-booking-actions";

/** A StepVerb as a button; `primary` is the one filled verb. */
export function VerbButton({ verb, primary = false, size, className }: { verb: StepVerb; primary?: boolean; size?: "sm" | "default"; className?: string }) {
  const actions = useBookingActions();
  const destructive = verb.kind === "status" && verb.destructive;
  return (
    <Button
      size={size}
      variant={primary ? "default" : destructive ? "destructive" : "ghost"}
      className={className}
      onClick={() => actions.run(verb)}
    >
      {verb.label}
    </Button>
  );
}

export function NextStepCard({ booking }: { booking: BookingDetail }) {
  const step = nextStep(booking);
  return (
    <NextStepStrip
      // Phones: let the text take the whole first line so the verbs wrap beneath it.
      className="max-sm:[&>div:first-of-type]:basis-full"
      urgency={step.urgency}
      icon={step.icon}
      title={step.title}
      detail={step.detail}
      primary={step.primary ? <VerbButton verb={step.primary} primary /> : undefined}
      secondary={step.secondary.length ? step.secondary.map((v, i) => <VerbButton key={`${v.kind}-${i}`} verb={v} />) : undefined}
    />
  );
}

// ------------------------------------------------------------------ header

export function RecordHeader({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const groupType = useGroupTypeLabel();
  const step = nextStep(booking);

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-mono font-medium text-foreground">
          {booking.reference}
          <CopyButton value={booking.reference} size="icon-xs" variant="ghost" />
        </span>
        {booking.source === "import" ? (
          <span className="inline-flex items-center gap-1 text-blue-text" title="Imported from the booking sheet">
            <FileSpreadsheet aria-hidden="true" className="size-3.5" />
            Imported from the booking sheet
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[1.5rem] leading-8 font-semibold text-foreground">{booking.group_name}</span>
            <StatusPill status={booking.status} />
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body text-foreground">
            <Link to={`/today/${booking.visit_date}`} className="font-medium underline-offset-3 hover:underline">
              {formatDateShort(booking.visit_date)} {booking.visit_date.slice(0, 4)}
            </Link>
            <Dot />
            <span className="text-muted-foreground">{relativeTo(booking.visit_date)}</span>
            <Dot />
            <span className="tabular">{pluralise(booking.people_booked, "visitor")}</span>
            {booking.arrived_count !== null ? <span className="tabular text-green-text">({booking.arrived_count} arrived)</span> : null}
            {booking.group_type ? (
              <>
                <Dot />
                <span>{groupType(booking.group_type)}</span>
              </>
            ) : null}
            <Dot />
            <span>{booking.contact_name}</span>
            {booking.contact_mobile ? (
              <>
                <Dot />
                <a href={`tel:+${booking.contact_mobile}`} className="tabular underline-offset-3 hover:underline">
                  {formatPhone(booking.contact_mobile)}
                </a>
              </>
            ) : null}
            {booking.contact_email ? null : (
              <>
                <Dot />
                <button type="button" onClick={() => actions.openEdit("contact")} className="inline-flex items-center gap-1 font-medium text-amber-text underline-offset-3 hover:underline">
                  <AlertTriangle aria-hidden="true" className="size-3.5" />
                  no email
                </button>
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {step.primary ? <VerbButton verb={step.primary} primary /> : null}
          <Button variant="outline" onClick={() => actions.openEdit()}>
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
          <OverflowMenu booking={booking} />
        </div>
      </div>
    </header>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-faint-foreground">
      ·
    </span>
  );
}

// ---------------------------------------------------------------- overflow

const SEND_ORDER: ActionId[] = ["send-proforma", "send-invoice", "send-final-invoice", "send-ticket-email", "send-ticket-whatsapp"];
const SEND_TAIL: ActionId[] = ["send-answers", "send-payment-confirmation", "send-acknowledgement"];
const REMINDERS: EmailReminderKind[] = ["still_interested", "deposit_reminder", "final_details"];

function OverflowMenu({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const a = (id: ActionId) => availability(booking, id);
  const reminders = REMINDERS.filter((k) => !a(`reminder:${k}`).hidden);
  const sendTop = SEND_ORDER.filter((id) => !a(id).hidden);
  const sendTail = SEND_TAIL.filter((id) => !a(id).hidden);
  const canArrivals = !a("record-arrivals").hidden;
  const confirmable = !a("confirm").hidden;
  const transitions = booking.allowed_transitions.filter((t) => !(t === "confirmed" && confirmable));
  const expiry = !a("send-expiry").hidden;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-label text-muted-foreground uppercase">Send</DropdownMenuLabel>
          {sendTop.map((id) => (
            <MenuAction key={id} availability={a(id)} label={ACTION_LABELS[id]} onSelect={() => actions.send(id)} />
          ))}
          {reminders.length ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Reminder…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72">
                {reminders.map((kind) => (
                  <MenuAction key={kind} availability={a(`reminder:${kind}`)} label={REMINDER_COPY[kind].label} description={REMINDER_COPY[kind].description} onSelect={() => actions.send(`reminder:${kind}`)} />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {sendTail.map((id) => (
            <MenuAction key={id} availability={a(id)} label={ACTION_LABELS[id]} onSelect={() => actions.send(id)} />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-label text-muted-foreground uppercase">Record</DropdownMenuLabel>
          <MenuAction availability={{ enabled: true }} label="Record payment" onSelect={actions.openPayment} />
          {canArrivals ? <MenuAction availability={a("record-arrivals")} label="Record arrivals" onSelect={actions.openArrivals} /> : null}
          <MenuAction availability={{ enabled: true }} label="Add note" onSelect={actions.focusNote} />
        </DropdownMenuGroup>
        {transitions.length || confirmable || expiry ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center justify-between gap-2 text-label text-muted-foreground uppercase">
                Status <StatusPill status={booking.status} size="sm" />
              </DropdownMenuLabel>
              {confirmable ? <MenuAction availability={a("confirm")} label={ACTION_LABELS.confirm} description={STATUS_CHANGE_COPY.confirmed?.description} onSelect={() => actions.send("confirm")} /> : null}
              {transitions.map((target) => (
                <StatusItem key={target} target={target} onSelect={() => actions.changeStatus(target)} />
              ))}
              {expiry ? <MenuAction availability={a("send-expiry")} label={ACTION_LABELS["send-expiry"]} description="Emails the customer that the hold lapsed and marks the booking lapsed." destructive onSelect={() => actions.send("send-expiry")} /> : null}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusItem({ target, onSelect }: { target: BookingStatus; onSelect: () => void }) {
  const copy = STATUS_CHANGE_COPY[target];
  return (
    <DropdownMenuItem variant={copy?.destructive ? "destructive" : "default"} onSelect={onSelect} className="flex-col items-start gap-0.5 py-1.5">
      <span className="font-medium">{copy?.label ?? humanise(target)}</span>
      {copy?.description ? <span className="text-xs text-muted-foreground">{copy.description}</span> : null}
    </DropdownMenuItem>
  );
}

function MenuAction({ availability: av, onSelect, label, description, destructive }: { availability: Availability; onSelect: () => void; label: string; description?: string; destructive?: boolean }) {
  return (
    <DropdownMenuItem disabled={!av.enabled} onSelect={onSelect} variant={destructive ? "destructive" : "default"} className="flex-col items-start gap-0.5 py-1.5" aria-label={av.enabled ? undefined : `${label}, unavailable: ${av.reason}`}>
      <span className="font-medium">{label}</span>
      {!av.enabled ? <span className="text-xs text-muted-foreground">{av.reason}</span> : description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
    </DropdownMenuItem>
  );
}

/** Wraps a button so a disabled one still explains itself. */
export function Gated({ availability: av, children }: { availability: Availability; children: ReactNode }) {
  if (av.enabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("inline-flex rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-selection-ring")} aria-label={av.reason}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{av.reason}</TooltipContent>
    </Tooltip>
  );
}
