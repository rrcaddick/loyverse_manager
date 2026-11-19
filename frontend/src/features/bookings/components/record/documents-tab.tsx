/**
 * Documents (owner's notes, 29 Oct 2026): one table for the proforma, the
 * invoice, the final invoice and the vehicle ticket, each with its status
 * (Not issued · Not sent · Sent · Re-sent), when it was sent, whether the
 * send succeeded, and the actions: Preview (the PDF, which can be saved from
 * the viewer) and Send or Re-send. The ticket goes by email and WhatsApp in
 * one send. Reminders, lapse and cancellation notices are not documents.
 */

import { ChevronDown, Eye, FileText, Send } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { StatusPill, type StatusTone } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { availability, latestDocument, type ActionId } from "../../actions";
import { documentPdfUrl, fetchDocumentPreview, openBlobInNewTab, ticketPdfUrl, useBookingAction } from "../../api";
import { isTentative } from "../../lib";
import { DOCUMENT_KIND_LABELS, FIRM_STATUSES, type BookingDetail, type BookingEmail, type DocumentKind } from "../../types";
import { useBookingActions } from "../../use-booking-actions";

const DOC_SEND: Record<DocumentKind, ActionId> = { proforma: "send-proforma", invoice: "send-invoice", final_invoice: "send-final-invoice" };
const KINDS: DocumentKind[] = ["proforma", "invoice", "final_invoice"];

interface Row {
  key: string;
  title: string;
  number: string | null;
  status: { label: string; tone: StatusTone };
  sentAt: string | null;
  sendStatus: { label: string; tone: StatusTone; title?: string } | null;
  preview: ReactNode;
  send: ReactNode;
}

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

  const sendsOf = (kind: string): BookingEmail[] => booking.emails.filter((m) => m.direction === "outbound" && m.kind === kind).sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
  const sendStatusOf = (mail: BookingEmail | undefined): Row["sendStatus"] =>
    !mail ? null : mail.send_status === "failed" ? { label: "Failed", tone: "red", title: mail.send_error ?? undefined } : { label: "Delivered", tone: "green" };

  const rows: Row[] = [];
  for (const kind of KINDS) {
    const latest = latestDocument(booking, kind);
    const send = availability(booking, DOC_SEND[kind]);
    if (!latest && (send.hidden || ended)) continue;
    const sends = sendsOf(kind);
    const last = sends[0];
    rows.push({
      key: kind,
      title: DOCUMENT_KIND_LABELS[kind],
      number: latest?.number ?? null,
      status: !latest ? { label: "Not issued", tone: "neutral" } : sends.length === 0 ? { label: "Not sent", tone: "amber" } : sends.length > 1 ? { label: "Re-sent", tone: "green-muted" } : { label: "Sent", tone: "green" },
      sentAt: last?.sent_at ?? null,
      sendStatus: sendStatusOf(last),
      preview: latest ? (
        <Button asChild variant="ghost" size="sm">
          <a href={documentPdfUrl(latest.id)} target="_blank" rel="noopener">
            <Eye data-icon="inline-start" />
            Preview
          </a>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => preview(kind)} disabled={previewing !== null}>
          {previewing === kind ? <Spinner data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
          Preview
        </Button>
      ),
      send: (
        <Button variant={sends.length ? "ghost" : "outline"} size="sm" disabled={!send.enabled} title={send.enabled ? undefined : send.reason} onClick={() => actions.send(DOC_SEND[kind])}>
          <Send data-icon="inline-start" />
          {sends.length ? "Re-send" : "Send"}
        </Button>
      ),
    });
  }
  if ((FIRM_STATUSES as readonly string[]).includes(booking.status) && booking.barcode) {
    const av = availability(booking, "send-ticket");
    const emailSends = sendsOf("ticket");
    const sentAt = [booking.ticket_emailed_at, booking.ticket_sent_at].filter((d): d is string => !!d).sort().pop() ?? null;
    const timesSent = Math.max(emailSends.length, booking.events.filter((e) => e.kind === "ticket_sent").length);
    const emailStatus = sendStatusOf(emailSends[0]);
    const whatsappSent = !!booking.ticket_sent_at;
    rows.push({
      key: "ticket",
      title: "Vehicle ticket",
      number: booking.barcode,
      status: !sentAt ? { label: "Not sent", tone: "amber" } : timesSent > 1 ? { label: "Re-sent", tone: "green-muted" } : { label: "Sent", tone: "green" },
      sentAt,
      sendStatus: !sentAt
        ? null
        : emailStatus?.tone === "red"
          ? { label: "Email failed", tone: "red", title: emailStatus.title }
          : { label: [booking.ticket_emailed_at ? "Email" : null, whatsappSent ? "WhatsApp" : null].filter(Boolean).join(" · ") || "Delivered", tone: "green" },
      preview: (
        <Button asChild variant="ghost" size="sm">
          <a href={ticketPdfUrl(booking.barcode)} target="_blank" rel="noopener">
            <Eye data-icon="inline-start" />
            Preview
          </a>
        </Button>
      ),
      send: (
        <Button variant={sentAt ? "ghost" : "outline"} size="sm" disabled={!av.enabled} title={av.enabled ? undefined : av.reason} onClick={() => actions.send("send-ticket")}>
          <Send data-icon="inline-start" />
          {sentAt ? "Re-send" : "Send"}
        </Button>
      ),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-section flex items-center gap-2 text-foreground">
        <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
        Documents
      </h2>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
        <Table>
          <TableHeader className="bg-table-head text-table-head-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-thead text-label pl-5 text-table-head-foreground uppercase">Document</TableHead>
              <TableHead className="h-thead text-label text-table-head-foreground uppercase">Status</TableHead>
              <TableHead className="h-thead text-label text-table-head-foreground uppercase">Sent</TableHead>
              <TableHead className="h-thead text-label text-table-head-foreground uppercase">Send status</TableHead>
              <TableHead className="h-thead text-label pr-5 text-right text-table-head-foreground uppercase">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} className="even:bg-nested">
                <TableCell className="py-2.5 pl-5">
                  <span className="text-body font-medium text-foreground">{r.title}</span>
                  {r.number ? <span className="ml-2 font-mono text-sm text-muted-foreground">{r.number}</span> : null}
                </TableCell>
                <TableCell className="py-2.5">
                  <StatusPill tone={r.status.tone} label={r.status.label} className="w-24 justify-center" />
                </TableCell>
                <TableCell className="py-2.5 text-body tabular text-foreground">{r.sentAt ? formatDateTime(r.sentAt) : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="py-2.5">{r.sendStatus ? <StatusPill tone={r.sendStatus.tone} label={r.sendStatus.label} size="sm" dot={false} title={r.sendStatus.title} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="py-2.5 pr-5">
                  <div className="flex items-center justify-end gap-1">
                    {r.preview}
                    {r.send}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {booking.documents.length > 0 || (!ended && !latestDocument(booking, "proforma") && isTentative(booking.status)) ? (
          <div className="flex flex-wrap items-center gap-4 px-5 py-3">
            {booking.documents.length > 0 ? (
              <Collapsible open={allOpen} onOpenChange={setAllOpen}>
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
                          v{d.version} · {formatDate(d.issued_at)} · {d.label}
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
