/**
 * The booking's action bar. Every button is always rendered (stable layout);
 * unavailable ones are disabled with the precondition in a tooltip. Every
 * send opens a confirm step that spells out the recipient, the attachment
 * and the side effect before anything leaves the building.
 */

import {
  Banknote,
  BellRing,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  FileText,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Receipt,
  Repeat,
  Ticket,
  UserCheck,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney, formatNumber, formatPhone, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/types/api";

import { REMINDER_COPY, STATUS_CHANGE_COPY, availability, confirmNeedsReason, latestDocument, proformaIsStale, type ActionId } from "../actions";
import { useBookingAction, type ActionVariables } from "../api";
import type { BookingDetail, EmailReminderKind } from "../types";
import { ArrivalsDialog } from "./arrivals-dialog";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { StatusDialog } from "./status-dialog";

interface ActionBarProps {
  booking: BookingDetail;
  onEdit: () => void;
}

export function ActionBar({ booking, onEdit }: ActionBarProps) {
  const [pending, setPending] = useState<ActionId | null>(null);
  const [payment, setPayment] = useState(false);
  const [arrivals, setArrivals] = useState(false);
  const [statusTarget, setStatusTarget] = useState<BookingStatus | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);

  const a = (id: ActionId) => availability(booking, id);
  const transitions = booking.allowed_transitions.filter((t) => t !== "confirmed" || !a("confirm").enabled);

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-2 ring-1 ring-foreground/10 sm:flex-row sm:flex-wrap sm:items-center">
      <Group label="Send">
        <Gated availability={a("send-proforma")}>
          <Button variant="outline" size="sm" onClick={() => setPending("send-proforma")}>
            <FileText data-icon="inline-start" />
            Proforma
          </Button>
        </Gated>
        <Gated availability={a("send-invoice")}>
          <Button variant="outline" size="sm" onClick={() => setPending("send-invoice")}>
            <Receipt data-icon="inline-start" />
            Invoice
          </Button>
        </Gated>
        <Gated availability={a("send-final-invoice")}>
          <Button variant="outline" size="sm" onClick={() => setPending("send-final-invoice")}>
            <FileCheck2 data-icon="inline-start" />
            Final invoice
          </Button>
        </Gated>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Ticket data-icon="inline-start" />
              Ticket
              <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <MenuAction availability={a("send-ticket-email")} onSelect={() => setPending("send-ticket-email")} icon={<Mail />} label="Email the vehicle ticket" />
            <MenuAction availability={a("send-ticket-whatsapp")} onSelect={() => setPending("send-ticket-whatsapp")} icon={<MessageCircle />} label="WhatsApp the vehicle ticket" />
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <BellRing data-icon="inline-start" />
              Reminders
              <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {(Object.keys(REMINDER_COPY) as EmailReminderKind[]).map((kind) => (
              <MenuAction
                key={kind}
                availability={a(`reminder:${kind}`)}
                onSelect={() => setPending(`reminder:${kind}`)}
                label={REMINDER_COPY[kind].label}
                description={REMINDER_COPY[kind].description}
              />
            ))}
            <DropdownMenuSeparator />
            <MenuAction
              availability={a("send-expiry")}
              onSelect={() => setPending("send-expiry")}
              label="Send expiry notice"
              description="Tells them the hold has lapsed and marks the booking lapsed."
              destructive
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="More emails">
              <MoreHorizontal data-icon="inline-start" />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Other emails</DropdownMenuLabel>
            <MenuAction availability={a("send-payment-confirmation")} onSelect={() => setPending("send-payment-confirmation")} label="Payment confirmation" description="Thanks them for the latest payment and shows the balance." />
            <MenuAction availability={a("send-answers")} onSelect={() => setPending("send-answers")} label="Send answers" description="Replies to the questions answered on the Questions tab." />
            <MenuAction availability={a("send-acknowledgement")} onSelect={() => setPending("send-acknowledgement")} label="Acknowledgement" description="“We received your request” with a link to the form." />
          </DropdownMenuContent>
        </DropdownMenu>
      </Group>

      <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

      <Group label="Booking">
        <Gated availability={a("confirm")}>
          <Button size="sm" onClick={() => setPending("confirm")}>
            <CheckCircle2 data-icon="inline-start" />
            Confirm
          </Button>
        </Gated>
        <Button variant="outline" size="sm" onClick={() => setPayment(true)}>
          <Banknote data-icon="inline-start" />
          Record payment
        </Button>
        <Gated availability={a("record-arrivals")}>
          <Button variant="outline" size="sm" onClick={() => setArrivals(true)}>
            <UserCheck data-icon="inline-start" />
            Record arrivals
          </Button>
        </Gated>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={transitions.length === 0} title={transitions.length === 0 ? "No further status changes from here" : undefined}>
              <Repeat data-icon="inline-start" />
              Change status
              <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="flex items-center gap-2">
              Currently <StatusBadge status={booking.status} />
            </DropdownMenuLabel>
            {transitions.map((target) => {
              const copy = STATUS_CHANGE_COPY[target];
              return (
                <DropdownMenuItem
                  key={target}
                  variant={copy?.destructive ? "destructive" : "default"}
                  onSelect={() => {
                    setStatusTarget(target);
                    setStatusOpen(true);
                  }}
                  className="flex-col items-start gap-0.5 py-1.5"
                >
                  <span className="font-medium">{copy?.label ?? humanise(target)}</span>
                  {copy?.description ? <span className="text-xs text-muted-foreground">{copy.description}</span> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      </Group>

      <SendDialog booking={booking} action={pending} onClose={() => setPending(null)} />
      <RecordPaymentDialog open={payment} onOpenChange={setPayment} booking={booking} />
      <ArrivalsDialog open={arrivals} onOpenChange={setArrivals} booking={booking} />
      <StatusDialog booking={booking} target={statusTarget} open={statusOpen} onOpenChange={setStatusOpen} />
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  );
}

/** Wraps a button so a disabled one still explains itself in a tooltip. */
function Gated({ availability: av, children }: { availability: { enabled: boolean; reason?: string }; children: React.ReactElement<{ disabled?: boolean }> }) {
  if (av.enabled) return children;
  const child = { ...children, props: { ...children.props, disabled: true } } as React.ReactElement<{ disabled?: boolean }>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={av.reason}>
          {child}
        </span>
      </TooltipTrigger>
      <TooltipContent>{av.reason}</TooltipContent>
    </Tooltip>
  );
}

function MenuAction({
  availability: av,
  onSelect,
  icon,
  label,
  description,
  destructive,
}: {
  availability: { enabled: boolean; reason?: string };
  onSelect: () => void;
  icon?: ReactNode;
  label: string;
  description?: string;
  destructive?: boolean;
}) {
  return (
    <DropdownMenuItem
      disabled={!av.enabled}
      onSelect={onSelect}
      variant={destructive ? "destructive" : "default"}
      className={cn("items-start gap-2 py-1.5", !icon && "flex-col gap-0.5")}
      aria-label={av.enabled ? undefined : `${label}, unavailable: ${av.reason}`}
    >
      {icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span> : null}
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {!av.enabled ? <span className="text-xs text-muted-foreground">{av.reason}</span> : description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </DropdownMenuItem>
  );
}

// ---------------------------------------------------------------- sending

interface SendSpec {
  title: string;
  confirmLabel: string;
  to: string;
  attachment: string;
  effect: string | null;
  destructive?: boolean;
  reason?: "required" | "optional";
  successVerb: string;
  variables: (extras: { reason?: string; attachInvoice?: boolean }) => ActionVariables;
  /** Offer “attach the latest invoice”. */
  invoiceOption?: boolean;
}

function spec(booking: BookingDetail, action: ActionId): SendSpec {
  const email = booking.contact_email ?? "";
  const proforma = latestDocument(booking, "proforma");
  const invoice = latestDocument(booking, "invoice");
  const proformaAttachment =
    proforma && !proformaIsStale(booking) ? `${proforma.filename} (version ${proforma.version}, ${formatMoney(proforma.total)})` : "A new proforma version, issued now";
  switch (action) {
    case "send-proforma":
      return {
        title: "Send the proforma?",
        confirmLabel: "Send proforma",
        to: email,
        attachment: proformaAttachment,
        effect: booking.status === "enquiry" ? "Status becomes Proforma sent and the hold clock starts." : "Records when the proforma was sent.",
        successVerb: "Proforma sent",
        variables: () => ({ action: "send-proforma" }),
      };
    case "send-invoice":
      return {
        title: "Send the invoice?",
        confirmLabel: "Send invoice",
        to: email,
        attachment: `A tax invoice issued now for ${formatMoney(booking.finance.total_amount)} showing ${formatMoney(booking.finance.paid_total)} paid`,
        effect: "Records when the invoice was sent.",
        successVerb: "Invoice sent",
        variables: () => ({ action: "send-invoice" }),
      };
    case "send-final-invoice":
      return {
        title: "Send the final invoice?",
        confirmLabel: "Send final invoice",
        to: email,
        attachment: `A final tax invoice issued now, billed on ${formatNumber(booking.arrived_count ?? 0)} arrivals`,
        effect: "Records when the final invoice was sent.",
        successVerb: "Final invoice sent",
        variables: () => ({ action: "send-final-invoice" }),
      };
    case "send-ticket-email":
      return {
        title: "Email the vehicle ticket?",
        confirmLabel: "Send ticket",
        to: email,
        attachment: `Vehicle entry ticket PDF (barcode ${booking.barcode ?? "—"})`,
        effect: "Records the ticket as emailed.",
        successVerb: "Vehicle ticket emailed",
        variables: () => ({ action: "send-ticket-email" }),
      };
    case "send-ticket-whatsapp":
      return {
        title: "WhatsApp the vehicle ticket?",
        confirmLabel: "Send on WhatsApp",
        to: `${formatPhone(booking.contact_mobile)} (WhatsApp)`,
        attachment: "The vehicle ticket as an image, through the approved WhatsApp template",
        effect: "Records the ticket as sent on WhatsApp.",
        successVerb: "Vehicle ticket sent on WhatsApp",
        variables: () => ({ action: "send-ticket-whatsapp" }),
      };
    case "send-payment-confirmation": {
      const last = booking.payments[booking.payments.length - 1];
      return {
        title: "Send a payment confirmation?",
        confirmLabel: "Send confirmation",
        to: email,
        attachment: invoice ? `Optional: ${invoice.filename}` : "None",
        effect: last ? `Thanks them for ${formatMoney(last.amount)} and shows the balance of ${formatMoney(booking.finance.balance_due)}.` : null,
        successVerb: "Payment confirmation sent",
        invoiceOption: !!invoice,
        variables: ({ attachInvoice }) => ({ action: "send-payment-confirmation", body: { attach_invoice: !!attachInvoice } }),
      };
    }
    case "send-answers":
      return {
        title: "Send the answers?",
        confirmLabel: "Send answers",
        to: email,
        attachment: "None",
        effect: `Replies with the ${formatNumber(booking.questions.filter((q) => q.answer).length)} answered question(s).`,
        successVerb: "Answers sent",
        variables: () => ({ action: "send-answers" }),
      };
    case "send-acknowledgement":
      return {
        title: "Send an acknowledgement?",
        confirmLabel: "Send",
        to: email,
        attachment: "None",
        effect: "Confirms the request was received and links to the booking form.",
        successVerb: "Acknowledgement sent",
        variables: () => ({ action: "send-acknowledgement" }),
      };
    case "send-expiry":
      return {
        title: "Send the expiry notice?",
        confirmLabel: "Send and mark lapsed",
        to: email,
        attachment: "None",
        effect: "Status becomes Lapsed. The day frees up on the calendar; the booking can be reopened later.",
        destructive: true,
        reason: "optional",
        successVerb: "Expiry notice sent",
        variables: ({ reason }) => ({ action: "send-expiry", body: reason ? { reason } : {} }),
      };
    case "reminder:still_interested":
    case "reminder:deposit_reminder": {
      const kind = action.slice("reminder:".length) as EmailReminderKind;
      return {
        title: `Send “${REMINDER_COPY[kind].label}”?`,
        confirmLabel: "Send reminder",
        to: email,
        attachment: proforma ? `${proforma.filename} (version ${proforma.version})` : "None — no proforma has been issued yet",
        effect: "Marks this reminder as sent in the queue.",
        successVerb: "Reminder sent",
        variables: () => ({ action: "send-reminder", body: { kind } }),
      };
    }
    case "reminder:final_details":
      return {
        title: "Send the final details?",
        confirmLabel: "Send final details",
        to: email,
        attachment: booking.ticket_emailed_at ? "None — the ticket was already emailed" : `Vehicle entry ticket PDF (barcode ${booking.barcode ?? "—"})`,
        effect: booking.ticket_emailed_at ? "Marks this reminder as sent." : "Marks the ticket as emailed and this reminder as sent.",
        successVerb: "Final details sent",
        variables: () => ({ action: "send-reminder", body: { kind: "final_details" } }),
      };
    case "confirm":
      return {
        title: `Confirm ${booking.reference}?`,
        confirmLabel: "Confirm booking",
        to: "",
        attachment: "",
        effect: confirmNeedsReason(booking)
          ? `The deposit of ${formatMoney(booking.finance.deposit_due)} is not covered (${formatMoney(booking.finance.paid_total)} paid). Confirming anyway needs a reason.`
          : booking.deposit_waived
            ? "The deposit is waived, so the booking can be confirmed now."
            : "The deposit is covered. Nothing is emailed; send the ticket afterwards.",
        reason: confirmNeedsReason(booking) ? "required" : "optional",
        successVerb: "Booking confirmed",
        variables: ({ reason }) => ({ action: "confirm", body: reason ? { reason } : {} }),
      };
    default:
      return {
        title: humanise(action),
        confirmLabel: "Run",
        to: email,
        attachment: "None",
        effect: null,
        successVerb: "Done",
        variables: () => ({ action: "send-acknowledgement" }),
      };
  }
}

export function SendDialog({ booking, action, onClose }: { booking: BookingDetail; action: ActionId | null; onClose: () => void }) {
  const run = useBookingAction(booking.id);
  const [reason, setReason] = useState("");
  const [attachInvoice, setAttachInvoice] = useState(true);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the last spec while the dialog animates out.
  const [lastAction, setLastAction] = useState<ActionId | null>(null);
  const current = action ?? lastAction;
  if (action && action !== lastAction) setLastAction(action);
  if (!current) return null;
  const s = spec(booking, current);
  const isEmail = current !== "confirm";
  const missingReason = s.reason === "required" && !reason.trim();

  function reset() {
    setReason("");
    setTouched(false);
    setError(null);
    setAttachInvoice(true);
  }

  return (
    <ConfirmDialog
      open={!!action}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          reset();
        }
      }}
      title={s.title}
      confirmLabel={s.confirmLabel}
      destructive={s.destructive}
      onConfirm={async () => {
        setError(null);
        if (missingReason) {
          setTouched(true);
          throw new Error("reason required");
        }
        try {
          const detail = await run.mutateAsync(s.variables({ reason: reason.trim() || undefined, attachInvoice }));
          const result = detail.action_result;
          toast.success(result?.to ? `${s.successVerb} to ${result.to}` : s.successVerb, {
            description: result?.subject ? `Subject: ${result.subject}` : undefined,
          });
          reset();
        } catch (err) {
          setError(err instanceof Error ? err.message : "The action failed");
          throw err;
        }
      }}
    >
      <div className="flex flex-col gap-3 text-sm">
        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
            {error}
          </p>
        ) : null}
        {isEmail ? (
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <dt className="text-muted-foreground">To</dt>
            <dd className="font-medium break-all">{s.to}</dd>
            <dt className="text-muted-foreground">Attachment</dt>
            <dd>{s.attachment}</dd>
            {s.effect ? (
              <>
                <dt className="text-muted-foreground">Then</dt>
                <dd>{s.effect}</dd>
              </>
            ) : null}
          </dl>
        ) : s.effect ? (
          <p className="text-muted-foreground">{s.effect}</p>
        ) : null}
        {s.invoiceOption ? (
          <div className="flex items-center gap-2">
            <Checkbox id="attach-invoice" checked={attachInvoice} onCheckedChange={(v) => setAttachInvoice(!!v)} />
            <Label htmlFor="attach-invoice" className="font-normal">
              Attach the latest invoice
            </Label>
          </div>
        ) : null}
        {s.reason ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-reason">
              Reason{s.reason === "optional" ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
            </Label>
            <Textarea
              id="send-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && missingReason ? true : undefined}
              placeholder={current === "confirm" ? "e.g. deposit arranged by phone, pays on arrival" : undefined}
            />
            {touched && missingReason ? (
              <p role="alert" className="text-sm text-destructive">
                A reason is required — it is recorded on the booking.
              </p>
            ) : null}
          </div>
        ) : null}
        {booking.source === "import" && isEmail ? (
          <p className="text-xs text-muted-foreground">Imported from the booking sheet: check the email address above is current before sending.</p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
