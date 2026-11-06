/**
 * Vehicle report (6 Nov 2026): the cars that came in under a group's ticket
 * on the day, as the gate captured them: time, plate, the person at the
 * wheel, heads, how the ID was read. Print sends the list to paper.
 */

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { formatDateLong, formatNumber, pluralise } from "@/lib/format";

import { useVehicleReport } from "../api";

const SOURCE: Record<string, string> = { licence: "Driving licence", smart_id: "Smart ID", id_book: "ID book", manual: "Typed", disc: "Licence disc" };

function time(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

export function VehicleReportDialog({ bookingId, date, title, open, onOpenChange }: { bookingId: number | null; date: string; title: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const report = useVehicleReport(open ? bookingId : null, date, open);
  const rows = report.data?.items ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl print:max-w-none print:shadow-none">
        <DialogHeader>
          <DialogTitle className="text-section">Vehicle report · {title}</DialogTitle>
          <DialogDescription>
            {formatDateLong(date)}
            {report.data ? ` · ${pluralise(report.data.total, "vehicle")} · ${formatNumber(report.data.heads)} people` : ""}
          </DialogDescription>
        </DialogHeader>
        {report.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : report.isError ? (
          <p className="text-body text-red-text">{errorMessage(report.error)}</p>
        ) : rows.length === 0 ? (
          <p className="text-body text-muted-foreground">No vehicles have come in under this ticket yet.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg ring-1 ring-border print:max-h-none print:overflow-visible">
            <Table>
              <TableHeader className="bg-table-head text-table-head-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-thead pl-4 text-label uppercase">Time</TableHead>
                  <TableHead className="h-thead text-label uppercase">Plate</TableHead>
                  <TableHead className="h-thead text-label uppercase">Driver</TableHead>
                  <TableHead className="h-thead text-right text-label uppercase">People</TableHead>
                  <TableHead className="h-thead pr-4 text-label uppercase">Read from</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.plate ?? ""}-${r.at ?? i}`} className="hover:bg-transparent">
                    <TableCell className="pl-4 tabular">{time(r.at)}</TableCell>
                    <TableCell className="font-mono">{r.plate ?? "—"}</TableCell>
                    <TableCell>{r.person ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right tabular">{formatNumber(r.heads)}</TableCell>
                    <TableCell className="pr-4 text-sm text-muted-foreground">{r.manual ? "Typed" : SOURCE[r.source ?? ""] ?? r.source ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={() => window.print()} disabled={rows.length === 0}>
            <Printer data-icon="inline-start" />
            Print
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
