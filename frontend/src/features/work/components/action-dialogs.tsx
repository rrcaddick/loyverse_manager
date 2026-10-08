/**
 * The small pieces of UI a Work verb may need before it fires:
 *
 *   BookingActionDialog  — every send is confirmed with the recipient and the
 *                          attachment named (sends are never silent).
 *   ExtendHoldPopover    — pick the new hold date in a calendar, then Extend.
 *   IgnoreReasonMenu     — the reason list behind "Ignore" on a bank credit.
 *   SetStatusDialog      — "Mark as no show?" (the only set_status today).
 */

import { AlertCircle } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { KeyValue, type KeyValueItem } from "@/components/key-value";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useBooking } from "@/features/bookings/api";
import type { BookingDetail } from "@/features/bookings/types";
import { formatDate, formatDateShort, formatPhone, parseDate, pluralise, todayIso, toIsoDate } from "@/lib/format";

import { IGNORE_REASONS, type BookingActionAction, type IgnoreInput, type SendReminderAction, type SetStatusAction, type WorkRow } from "../types";

// ------------------------------------------------------------ send actions

type Channel = "email" | "whatsapp" | "none";

interface SendPlan {
  channel: Channel;
  to: string | null;
  attaches: string | null;
  missing: string | null;
}

function actionName(action: BookingActionAction | SendReminderAction): string {
  return action.action === "send_reminder" ? "send-reminder" : action.name;
}

function describeSend(action: BookingActionAction | SendReminderAction, detail: BookingDetail | undefined): SendPlan {
  const name = actionName(action);
  const kind = action.kind;
  const proforma = detail?.documents.find((d) => d.kind === "proforma");
  const email = detail?.contact_email ?? null;
  const mobile = detail?.contact_mobile ?? null;
  // "Missing" is only known once the booking has loaded.
  const loaded = !!detail;
  const plan = (channel: Channel, attaches: string | null): SendPlan => {
    if (channel === "whatsapp") return { channel, to: mobile ? formatPhone(mobile) : null, attaches, missing: loaded && !mobile ? "This booking has no mobile number. Add one on the booking first." : null };
    if (channel === "email") return { channel, to: email, attaches, missing: loaded && !email ? "This booking has no email address. Add one on the booking first." : null };
    return { channel, to: null, attaches, missing: null };
  };
  switch (name) {
    case "send-ticket-whatsapp":
      return plan("whatsapp", "the vehicle ticket (image)");
    case "send-ticket-email":
      return plan("email", "the vehicle ticket (PDF)");
    case "send-reminder":
      if (kind === "final_details") return plan("email", "the vehicle ticket, if it has not been emailed yet");
      return plan("email", proforma ? proforma.filename : "the proforma");
    case "send-proforma":
      return plan("email", proforma ? proforma.filename : "a new proforma");
    case "send-invoice":
      return plan("email", "the statement");
    case "send-final-invoice":
      return plan("email", "the tax invoice");
    case "send-payment-confirmation":
    case "send-expiry":
    case "send-acknowledgement":
    case "send-answers":
      return plan("email", null);
    default:
      return plan("none", null);
  }
}

interface BookingActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: { action: BookingActionAction | SendReminderAction; row: WorkRow };
  onConfirm: () => Promise<unknown>;
}

/** Names the recipient and the attachment before anything is sent. */
export function BookingActionDialog({ open, onOpenChange, subject, onConfirm }: BookingActionDialogProps) {
  const { action, row } = subject;
  const detail = useBooking(open ? action.booking_id : null);
  const plan = describeSend(action, detail.data);
  const reference = detail.data?.reference ?? row.booking?.reference ?? "";
  const group = detail.data?.group_name ?? row.booking?.group_name ?? row.title;
  const visit = detail.data?.visit_date ?? row.booking?.visit_date ?? null;
  const people = detail.data?.people_booked ?? row.booking?.people_booked ?? null;

  const items: KeyValueItem[] = [];
  if (plan.channel !== "none") {
    items.push({
      label: plan.channel === "whatsapp" ? "WhatsApp to" : "Email to",
      value: detail.isPending ? <Skeleton className="h-4 w-40" /> : plan.to ?? <span className="text-red-text">Missing</span>,
    });
  }
  items.push({ label: "Attaches", value: plan.attaches ?? "Nothing" });
  if (visit) items.push({ label: "Visit", value: `${formatDateShort(visit)}${people ? ` · ${pluralise(people, "person", "people")}` : ""}` });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${action.verb} · ${reference}`}
      description={plan.channel === "none" ? `${group}` : `${group}. Nothing is sent until you confirm.`}
      confirmLabel={action.verb}
      onConfirm={onConfirm}
    >
      <div className="flex flex-col gap-3">
        <KeyValue layout="table" items={items} />
        {plan.missing ? (
          <p className="flex items-start gap-2 text-sm text-red-text">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {plan.missing}
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

// ------------------------------------------------------------- extend hold

interface ExtendHoldPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: string;
  currentHold: string | null;
  visitDate: string | null;
  busy?: boolean;
  onPick: (iso: string) => void;
  /** The trigger button — or, with `anchorOnly`, the element to anchor to (opened by the caller). */
  children: ReactNode;
  anchorOnly?: boolean;
}

export function ExtendHoldPopover({ open, onOpenChange, reference, currentHold, visitDate, busy, onPick, children, anchorOnly = false }: ExtendHoldPopoverProps) {
  const [picked, setPicked] = useState<Date | undefined>(undefined);
  const today = parseDate(todayIso())!;
  const latest = visitDate ? (parseDate(visitDate) ?? undefined) : undefined;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setPicked(undefined);
      }}
    >
      {anchorOnly ? <PopoverAnchor asChild>{children}</PopoverAnchor> : <PopoverTrigger asChild>{children}</PopoverTrigger>}
      <PopoverContent align="end" className="w-auto p-0" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-border px-3 py-2 text-sm">
          <div className="font-medium">New hold expiry · {reference}</div>
          <div className="text-xs text-muted-foreground tabular">
            {currentHold ? `Currently ${formatDate(currentHold)}` : "No hold date set"}
            {visitDate ? ` · visit ${formatDate(visitDate)}` : ""}
          </div>
        </div>
        <Calendar
          mode="single"
          selected={picked}
          onSelect={setPicked}
          defaultMonth={picked ?? (currentHold ? parseDate(currentHold) ?? today : today)}
          disabled={[{ before: today }, ...(latest ? [{ after: latest }] : [])]}
          weekStartsOn={1}
        />
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground tabular">{picked ? formatDate(picked) : "Pick a day"}</span>
          <Button
            size="sm"
            disabled={!picked || busy}
            onClick={() => {
              if (picked) onPick(toIsoDate(picked));
            }}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Extend
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ----------------------------------------------------------- ignore reason

interface IgnoreReasonMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (input: IgnoreInput) => void;
  children: ReactNode;
}

export function IgnoreReasonMenu({ open, onOpenChange, onPick, children }: IgnoreReasonMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuLabel>Ignore because it is…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {IGNORE_REASONS.map((reason) => (
          <DropdownMenuItem key={reason.label} onSelect={() => onPick(reason.note ? { reason: reason.value, note: reason.note } : { reason: reason.value })}>
            {reason.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --------------------------------------------------------------- set status

interface SetStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: { action: SetStatusAction; row: WorkRow };
  onConfirm: () => Promise<unknown>;
}

const STATUS_COPY: Partial<Record<SetStatusAction["status"], { title: string; description: string; destructive: boolean }>> = {
  no_show: { title: "Mark as no show?", description: "Confirmed but nobody arrived on the day. The booking closes and leaves the arrivals list. Nothing is emailed.", destructive: true },
  cancelled: { title: "Cancel this booking?", description: "The customer is not coming. Nothing is emailed; the day frees up on the calendar.", destructive: true },
  lapsed: { title: "Mark as lapsed?", description: "The hold expired without a deposit. Nothing is emailed.", destructive: true },
  completed: { title: "Mark as completed?", description: "Closes the booking as visited.", destructive: false },
};

export function SetStatusDialog({ open, onOpenChange, subject, onConfirm }: SetStatusDialogProps) {
  const { action, row } = subject;
  const copy = STATUS_COPY[action.status] ?? { title: `${action.verb}?`, description: "", destructive: false };
  const label = row.booking ? `${row.booking.reference} · ${row.booking.group_name}` : row.title;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={`${label}. ${copy.description}`}
      confirmLabel={action.verb}
      destructive={copy.destructive}
      onConfirm={onConfirm}
    />
  );
}
