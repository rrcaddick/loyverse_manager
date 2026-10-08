/**
 * The confirm step before anything leaves the building: To / Attachment /
 * Then, plus a reason where the action records one. Also used for the
 * manual Confirm (no email).
 */

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatNumber, formatPhone, humanise } from "@/lib/format";

import { REMINDER_COPY, confirmNeedsReason, latestDocument, proformaIsStale, type ActionId } from "../actions";
import { useBookingAction, type ActionVariables } from "../api";
import type { BookingDetail, EmailReminderKind } from "../types";

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
  /** Offer “attach the latest statement”. */
  invoiceOption?: boolean;
}

const money = (n: number) => formatMoney(n, { compact: true });

function spec(booking: BookingDetail, action: ActionId): SendSpec {
  const email = booking.contact_email ?? "";
  const proforma = latestDocument(booking, "proforma");
  const statement = latestDocument(booking, "invoice");
  const proformaAttachment =
    proforma && !proformaIsStale(booking) ? `${proforma.filename} (version ${proforma.version}, ${money(proforma.total)})` : "A new proforma version, issued now";
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
        title: "Send the statement?",
        confirmLabel: "Send statement",
        to: email,
        attachment: `A deposit receipt and statement issued now: ${money(booking.finance.total_amount)} total, ${money(booking.finance.paid_total)} received, ${money(booking.finance.balance_due)} balance`,
        effect: "Records when the statement was sent. This is not a tax invoice.",
        successVerb: "Statement sent",
        variables: () => ({ action: "send-invoice" }),
      };
    case "send-final-invoice":
      return {
        title: "Send the tax invoice?",
        confirmLabel: "Send tax invoice",
        to: email,
        attachment: `The tax invoice issued now, billed on ${formatNumber(booking.arrived_count ?? 0)} arrivals${booking.finance.final_amount !== null ? ` (${money(booking.finance.final_amount)})` : ""}`,
        effect: "Records when the tax invoice was sent. It is issued once, after the visit.",
        successVerb: "Tax invoice sent",
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
        attachment: statement ? `Optional: ${statement.filename}` : "None",
        effect: last ? `Thanks them for ${money(last.amount)} and shows the balance of ${money(booking.finance.balance_due)}.` : null,
        successVerb: "Payment confirmation sent",
        invoiceOption: !!statement,
        variables: ({ attachInvoice }) => ({ action: "send-payment-confirmation", body: { attach_invoice: !!attachInvoice } }),
      };
    }
    case "send-answers":
      return {
        title: "Send the answers?",
        confirmLabel: "Send answers",
        to: email,
        attachment: "None",
        effect: `Replies with the ${pluralQuestions(booking.questions.filter((q) => q.answer).length)}.`,
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
        effect: "Marks this reminder as sent in Work.",
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
          ? `The deposit of ${money(booking.finance.deposit_due)} is not covered (${money(booking.finance.paid_total)} paid). Confirming anyway needs a reason.`
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

function pluralQuestions(n: number): string {
  return `${formatNumber(n)} answered ${n === 1 ? "question" : "questions"}`;
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
      <div className="flex flex-col gap-3 text-body">
        {error ? (
          <p role="alert" className="rounded-lg bg-red-soft px-3 py-2 text-sm text-red-text">
            {error}
          </p>
        ) : null}
        {isEmail ? (
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-nested px-3 py-2.5 text-sm">
            <dt className="text-muted-foreground">To</dt>
            <dd className="font-medium break-all text-foreground">{s.to}</dd>
            <dt className="text-muted-foreground">Attachment</dt>
            <dd className="text-foreground">{s.attachment}</dd>
            {s.effect ? (
              <>
                <dt className="text-muted-foreground">Then</dt>
                <dd className="text-foreground">{s.effect}</dd>
              </>
            ) : null}
          </dl>
        ) : s.effect ? (
          <p className="text-sm text-muted-foreground">{s.effect}</p>
        ) : null}
        {s.invoiceOption ? (
          <div className="flex items-center gap-2">
            <Checkbox id="attach-invoice" checked={attachInvoice} onCheckedChange={(v) => setAttachInvoice(!!v)} />
            <Label htmlFor="attach-invoice" className="font-normal">
              Attach the latest statement
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
              <p role="alert" className="text-sm text-red-text">
                A reason is required — it is recorded on the booking.
              </p>
            ) : null}
          </div>
        ) : null}
        {booking.source === "import" && isEmail ? (
          <p className="text-sm text-muted-foreground">Imported from the booking sheet: check the address above is current before sending.</p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
