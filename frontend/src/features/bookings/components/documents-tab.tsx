/**
 * Documents tab: issued proforma / invoice versions with PDFs, previews of
 * what a new one would look like, and "issue without sending".
 */

import { Download, ExternalLink, Eye, FilePlus2, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { documentPdfUrl, fetchDocumentPreview, openBlobInNewTab, useBookingAction } from "../api";
import { DOCUMENT_KIND_LABELS, type BookingDetail, type DocumentKind } from "../types";

export function DocumentsTab({ booking }: { booking: BookingDetail }) {
  const issue = useBookingAction(booking.id);
  const [previewing, setPreviewing] = useState<DocumentKind | null>(null);

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

  async function issueProforma() {
    try {
      const detail = await issue.mutateAsync({ action: "issue-proforma" });
      const doc = detail.action_result?.document;
      toast.success(doc ? `${doc.label} ${doc.number} issued (version ${doc.version})` : "Proforma issued");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const kinds: DocumentKind[] = ["proforma", "invoice", "final_invoice"];

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Preview"
        description="Renders the document as it would be issued now, from the current numbers. Nothing is stored or sent."
        actions={
          <Button variant="outline" size="sm" onClick={issueProforma} disabled={issue.isPending}>
            {issue.isPending ? <Spinner data-icon="inline-start" /> : <FilePlus2 data-icon="inline-start" />}
            Issue proforma without sending
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          {kinds.map((kind) => (
            <Button key={kind} variant="outline" onClick={() => preview(kind)} disabled={previewing !== null}>
              {previewing === kind ? <Spinner data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
              Preview {DOCUMENT_KIND_LABELS[kind].toLowerCase()}
            </Button>
          ))}
        </div>
        {booking.arrived_count === null ? (
          <p className="mt-3 text-xs text-muted-foreground">The final invoice bills on arrivals; until they are recorded it falls back to the booked number.</p>
        ) : null}
      </Section>

      <Section title="Issued documents" description="Newest first. Versions count per number, so an invoice and a final invoice share INV numbering." flush>
        {booking.documents.length === 0 ? (
          <EmptyState compact icon={FileText} title="No documents issued yet" description="Sending the proforma issues the first version." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="[&_td]:align-middle">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs tracking-wide uppercase">Document</TableHead>
                  <TableHead className="text-right text-xs tracking-wide uppercase">Total</TableHead>
                  <TableHead className="text-right text-xs tracking-wide uppercase">Paid</TableHead>
                  <TableHead className="text-right text-xs tracking-wide uppercase">Due</TableHead>
                  <TableHead className="text-xs tracking-wide uppercase">Issued</TableHead>
                  <TableHead className="text-xs tracking-wide uppercase">Emailed</TableHead>
                  <TableHead className="text-right text-xs tracking-wide uppercase">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {booking.documents.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.label}</span>
                        <span className="font-mono text-sm">{d.number}</span>
                        <StatusBadge status="version" label={`v${d.version}`} tone="neutral" dot={false} />
                      </div>
                      <div className="text-xs text-muted-foreground">{d.filename}</div>
                    </TableCell>
                    <TableCell className="text-right tabular">{formatMoney(d.total)}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(d.paid)}</TableCell>
                    <TableCell className={cn("text-right tabular", d.due <= 0 && "text-success")}>{formatMoney(d.due)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular">{formatDateTime(d.issued_at)}</TableCell>
                    <TableCell>
                      {d.email_message_id ? <StatusBadge status="emailed" label="Attached to email" tone="green-muted" /> : <span className="text-xs text-muted-foreground">Not emailed</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="outline" size="sm">
                          <a href={documentPdfUrl(d.id)} target="_blank" rel="noopener">
                            <ExternalLink data-icon="inline-start" />
                            View PDF
                          </a>
                        </Button>
                        <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${d.filename}`}>
                          <a href={documentPdfUrl(d.id, true)} download={d.filename}>
                            <Download />
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}
