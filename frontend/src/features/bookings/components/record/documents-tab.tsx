/**
 * Documents (owner's plan, 29 Oct 2026): the PDFs we produce for the
 * customer, what went out and when, with view, download, send and resend.
 * Proforma, statement and tax invoice are issued and stored; the vehicle
 * ticket is rendered from the barcode and sent by email or WhatsApp. The
 * plain emails (reminders, lapse, cancellation) are not documents: they are
 * sent from the quick actions and shown in Activity and Conversation.
 */

import { ChevronDown, Download, ExternalLink, Eye, FileText, MessageCircle, Send, Ticket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { availability, latestDocument, type ActionId } from "../../actions";
import { documentPdfUrl, fetchDocumentPreview, openBlobInNewTab, ticketPdfUrl, useBookingAction } from "../../api";
import { isTentative } from "../../lib";
import { DOCUMENT_KIND_LABELS, FIRM_STATUSES, type BookingDetail, type DocumentKind } from "../../types";
import { useBookingActions } from "../../use-booking-actions";

const DOC_SEND: Record<DocumentKind, ActionId> = { proforma: "send-proforma", invoice: "send-invoice", final_invoice: "send-final-invoice" };
const KINDS: DocumentKind[] = ["proforma", "invoice", "final_invoice"];

export function DocumentsTab({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const [previewing, setPreviewing] = useState<DocumentKind | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const issue = useBookingAction(booking.id);
  const ended = booking.status === "cancelled" || booking.status === "lapsed" || booking.status === "no_show";

  async function preview(kind: DocumentKind) {
    setPreviewing(kind);
    try {
      await openBlobInNewTab(() => fetchDocumentPreview(booking.id, kind));
    } catch (err) {
      toast.error(errorMessage(err, "Could not render the preview"));
    } finally {
      setPreviewing(null);
    }
  }

  const emailFor = (id: number | null) => (id === null ? null : (booking.emails.find((m) => m.id === id) ?? null));

  return (
    <div className="flex max-w-4xl flex-col gap-card-gap">
      <Section
        title={
          <span className="inline-flex items-center gap-2">
            <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
            Documents
          </span>
        }
        description="What has gone to the customer and what to send next. Each send is a click until sending rules take over."
      >
        <ul className="divide-y divide-border">
          {KINDS.map((kind) => {
            const latest = latestDocument(booking, kind);
            const send = availability(booking, DOC_SEND[kind]);
            if (!latest && (send.hidden || ended)) return null;
            const mail = latest ? emailFor(latest.email_message_id) : null;
            return (
              <li key={kind} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <FileText aria-hidden="true" className={cn("size-5 shrink-0", latest ? "text-blue-text" : "text-faint-foreground")} />
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
                    <span className="font-medium text-foreground">{DOCUMENT_KIND_LABELS[kind]}</span>
                    {latest ? <span className="font-mono text-sm text-muted-foreground">{latest.number}</span> : null}
                    {latest && latest.version > 1 ? <StatusPill tone="neutral" label={`v${latest.version}`} size="sm" dot={false} /> : null}
                    {latest ? mail ? <StatusPill tone="green-muted" label="Sent" size="sm" dot={false} /> : <StatusPill tone="amber" label="Not sent" size="sm" dot={false} /> : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {latest ? (
                      <>
                        Issued {formatDate(latest.issued_at)}
                        {mail ? ` · emailed ${formatDate(mail.sent_at)}${mail.to_emails?.length ? ` to ${mail.to_emails.join(", ")}` : ""}` : " · not emailed yet"}
                      </>
                    ) : (
                      "Not issued yet"
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {latest ? (
                    <>
                      <Button asChild variant="ghost" size="sm">
                        <a href={documentPdfUrl(latest.id)} target="_blank" rel="noopener" aria-label={`View ${DOCUMENT_KIND_LABELS[kind]} ${latest.number}`}>
                          <ExternalLink data-icon="inline-start" />
                          View
                        </a>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <a href={documentPdfUrl(latest.id, true)} aria-label={`Download ${DOCUMENT_KIND_LABELS[kind]} ${latest.number}`}>
                          <Download data-icon="inline-start" />
                          Download
                        </a>
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => preview(kind)} disabled={previewing !== null}>
                      {previewing === kind ? <Spinner data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                      Preview
                    </Button>
                  )}
                  <Button variant={latest && mail ? "ghost" : "outline"} size="sm" disabled={!send.enabled} title={send.enabled ? undefined : send.reason} onClick={() => actions.send(DOC_SEND[kind])}>
                    <Send data-icon="inline-start" />
                    {latest && mail ? "Resend" : "Send"}
                  </Button>
                </div>
              </li>
            );
          })}
          <TicketRow booking={booking} />
        </ul>
        {booking.documents.length > 0 ? (
          <Collapsible open={allOpen} onOpenChange={setAllOpen} className="mt-3">
            <CollapsibleTrigger asChild>
              <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-3 hover:underline">
                <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform", !allOpen && "-rotate-90")} />
                All versions ({booking.documents.length})
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {booking.documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <a href={documentPdfUrl(d.id)} target="_blank" rel="noopener" className="font-mono text-foreground underline-offset-3 hover:underline">
                      {d.number}
                    </a>
                    <span className="text-muted-foreground">
                      v{d.version} · {formatDateTime(d.issued_at)} · {d.label}
                    </span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        {!ended && !latestDocument(booking, "proforma") && isTentative(booking.status) ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            disabled={issue.isPending}
            onClick={async () => {
              try {
                const detail = await issue.mutateAsync({ action: "issue-proforma" });
                const doc = detail.action_result?.document;
                toast.success(doc ? `${doc.label} ${doc.number} issued (version ${doc.version})` : "Proforma issued");
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          >
            {issue.isPending ? <Spinner data-icon="inline-start" /> : <FileText data-icon="inline-start" />}
            Issue proforma without sending
          </Button>
        ) : null}
      </Section>
    </div>
  );
}

/** The vehicle ticket: rendered from the barcode, sent by email or WhatsApp. */
function TicketRow({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const firm = (FIRM_STATUSES as readonly string[]).includes(booking.status);
  if (!firm || !booking.barcode) return null;
  const email = availability(booking, "send-ticket-email");
  const whatsapp = availability(booking, "send-ticket-whatsapp");
  const sent = booking.ticket_emailed_at || booking.ticket_sent_at;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 last:pb-0">
      <Ticket aria-hidden="true" className={cn("size-5 shrink-0", sent ? "text-blue-text" : "text-faint-foreground")} />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
          <span className="font-medium text-foreground">Vehicle ticket</span>
          <span className="font-mono text-sm text-muted-foreground">{booking.barcode}</span>
          {sent ? <StatusPill tone="green-muted" label="Sent" size="sm" dot={false} /> : <StatusPill tone="amber" label="Not sent" size="sm" dot={false} />}
        </div>
        <div className="text-sm text-muted-foreground">
          {booking.ticket_emailed_at ? `Emailed ${formatDate(booking.ticket_emailed_at)}` : "Not emailed"}
          {" · "}
          {booking.ticket_sent_at ? `WhatsApp ${formatDate(booking.ticket_sent_at)}` : "Not sent on WhatsApp"}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button asChild variant="ghost" size="sm">
          <a href={ticketPdfUrl(booking.barcode)} target="_blank" rel="noopener">
            <ExternalLink data-icon="inline-start" />
            View
          </a>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={ticketPdfUrl(booking.barcode, true)}>
            <Download data-icon="inline-start" />
            Download
          </a>
        </Button>
        <Button variant={booking.ticket_emailed_at ? "ghost" : "outline"} size="sm" disabled={!email.enabled} title={email.enabled ? undefined : email.reason} onClick={() => actions.send("send-ticket-email")}>
          <Send data-icon="inline-start" />
          {booking.ticket_emailed_at ? "Resend email" : "Email"}
        </Button>
        <Button variant={booking.ticket_sent_at ? "ghost" : "outline"} size="sm" disabled={!whatsapp.enabled} title={whatsapp.enabled ? undefined : whatsapp.reason} onClick={() => actions.send("send-ticket-whatsapp")}>
          <MessageCircle data-icon="inline-start" />
          {booking.ticket_sent_at ? "Resend WhatsApp" : "WhatsApp"}
        </Button>
      </div>
    </li>
  );
}
