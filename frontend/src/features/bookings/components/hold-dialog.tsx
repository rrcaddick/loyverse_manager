/**
 * The hold expiry date (PATCH /bookings/:id {hold_expires_on}). Only
 * tentative bookings lapse, so the rail offers this on those alone.
 */

import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { DateField, FormError, applyApiErrors, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/format";

import { useUpdateBooking } from "../api";
import type { BookingDetail } from "../types";

interface HoldDialogProps {
  booking: BookingDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const holdSchema = z.object({ hold_expires_on: z.string() });

export function HoldDialog({ booking, open, onOpenChange }: HoldDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Hold expiry</DialogTitle>
          <DialogDescription>The day the provisional hold lapses if no deposit arrives. It moves with the visit date unless set here by hand.</DialogDescription>
        </DialogHeader>
        {open ? <HoldForm key={booking.updated_at} booking={booking} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function HoldForm({ booking, onClose }: { booking: BookingDetail; onClose: () => void }) {
  const update = useUpdateBooking(booking.id);
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema: holdSchema, defaultValues: { hold_expires_on: booking.hold_expires_on ?? "" } });

  async function onSubmit(values: z.output<typeof holdSchema>) {
    setError(null);
    try {
      await update.mutateAsync({ hold_expires_on: values.hold_expires_on || null });
      toast.success(values.hold_expires_on ? `Hold now expires ${formatDate(values.hold_expires_on)}` : "Hold expiry cleared");
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
        <DateField control={form.control} name="hold_expires_on" label="Hold expires on" clearable max={booking.visit_date} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !form.formState.isDirty}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
