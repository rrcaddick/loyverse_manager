/**
 * Record how many people arrived (POST /bookings/:id/arrivals). The count can
 * come from Loyverse (GET …/arrivals, which only reports) or be typed in.
 */

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { FormError, NumberField, applyApiErrors, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { formatDateTime, formatNumber, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/types/api";

import { useFetchArrivals, useRecordArrivals } from "../api";
import type { ArrivalSource } from "../types";

const schema = z.object({
  count: z.number({ error: "Enter the number of arrivals" }).int("Whole numbers only").min(0, "Cannot be negative"),
});

export interface ArrivalsSubject {
  id: number;
  reference: string;
  group_name: string;
  status: BookingStatus;
  people_booked: number;
  arrived_count: number | null;
  arrived_source: ArrivalSource | null;
  arrived_at: string | null;
}

export interface ArrivalsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: ArrivalsSubject;
  /** Pre-filled from a Loyverse fetch that already happened. */
  initial?: { count: number; source: ArrivalSource } | null;
}

export function ArrivalsDialog({ open, onOpenChange, booking, initial = null }: ArrivalsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record arrivals</DialogTitle>
          <DialogDescription>
            {booking.reference} · {booking.group_name} · {pluralise(booking.people_booked, "person", "people")} booked
          </DialogDescription>
        </DialogHeader>
        {open ? <ArrivalsForm key={`${booking.id}-${initial?.count ?? "x"}`} booking={booking} initial={initial} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ArrivalsForm({ booking, initial, onClose }: { booking: ArrivalsSubject; initial: ArrivalsDialogProps["initial"]; onClose: () => void }) {
  const record = useRecordArrivals(booking.id);
  const fetchArrivals = useFetchArrivals(booking.id);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<number | null>(initial?.source === "loyverse" ? initial.count : null);
  const form = useZodForm({ schema, defaultValues: { count: initial?.count ?? booking.arrived_count ?? Number.NaN } });
  const count = form.watch("count");
  const source: ArrivalSource = fetched !== null && count === fetched ? "loyverse" : "manual";

  async function fromLoyverse() {
    setError(null);
    try {
      const result = await fetchArrivals.mutateAsync();
      setFetched(result.count);
      form.setValue("count", result.count, { shouldDirty: true, shouldValidate: true });
    } catch (err) {
      setError(errorMessage(err, "Loyverse could not be reached"));
    }
  }

  async function onSubmit(values: z.output<typeof schema>) {
    setError(null);
    try {
      const detail = await record.mutateAsync({ count: values.count, source });
      toast.success(`${formatNumber(values.count)} arrivals recorded for ${booking.reference}`, {
        description: detail.status === "completed" && booking.status !== "completed" ? "The booking is now completed." : undefined,
      });
      onClose();
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  const busy = form.formState.isSubmitting;
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
        <FormError message={error} />
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium">Count from Loyverse</div>
              <div className="text-xs text-muted-foreground">Sums the group's ticket sales at the gate tills for the visit day.</div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={fromLoyverse} disabled={fetchArrivals.isPending}>
              {fetchArrivals.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              Fetch
            </Button>
          </div>
          {fetched !== null ? (
            <p className="text-sm tabular" aria-live="polite">
              Loyverse counted <span className="font-semibold">{formatNumber(fetched)}</span> {fetched === 1 ? "arrival" : "arrivals"}.
            </p>
          ) : null}
        </div>
        <NumberField control={form.control} name="count" label="People arrived" integer min={0} required className="sm:max-w-xs" suffix="people" />
        <p className={cn("text-xs text-muted-foreground", source === "loyverse" && "text-primary")}>
          {source === "loyverse" ? "Will be recorded as counted by Loyverse." : "Will be recorded as a manual count."}
          {booking.arrived_count !== null ? (
            <>
              {" "}
              Currently {formatNumber(booking.arrived_count)} ({booking.arrived_source ?? "manual"}
              {booking.arrived_at ? `, ${formatDateTime(booking.arrived_at)}` : ""}).
            </>
          ) : null}
          {booking.status === "confirmed" ? " Recording a count above zero marks the booking completed." : null}
        </p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Record arrivals
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
