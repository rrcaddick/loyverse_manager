/**
 * Pricing overrides and the hold date, all PATCH /bookings/:id.
 * Every override carries a reason; clearing one recomputes from the tier.
 */

import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { DateField, FormError, MoneyField, SwitchField, TextareaField, applyApiErrors, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

import { useUpdateBooking } from "../api";
import type { BookingDetail } from "../types";

interface DialogProps {
  booking: BookingDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// --------------------------------------------------------------- price

const priceSchema = z.object({
  price_per_person: z.number({ error: "Enter the price per person" }).min(0, "Cannot be negative"),
  price_override_reason: z.string().trim().min(3, "Give the reason for the special price"),
});

export function PriceOverrideDialog({ booking, open, onOpenChange }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Override price per person</DialogTitle>
          <DialogDescription>
            The tier price is applied automatically. A special price stays put when the date or numbers change, and the reason shows on the booking.
          </DialogDescription>
        </DialogHeader>
        {open ? <PriceForm key={booking.updated_at} booking={booking} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PriceForm({ booking, onClose }: { booking: BookingDetail; onClose: () => void }) {
  const update = useUpdateBooking(booking.id);
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({
    schema: priceSchema,
    defaultValues: { price_per_person: booking.price_per_person, price_override_reason: booking.price_override_reason ?? "" },
  });
  const price = form.watch("price_per_person");
  const total = Number.isFinite(price) ? price * booking.people_booked : null;

  async function onSubmit(values: z.output<typeof priceSchema>) {
    setError(null);
    try {
      await update.mutateAsync({ price_per_person: values.price_per_person, price_overridden: true, price_override_reason: values.price_override_reason });
      toast.success(`Price set to ${formatMoney(values.price_per_person)} per person`);
      onClose();
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  async function clear() {
    setError(null);
    try {
      await update.mutateAsync({ price_overridden: false, price_override_reason: null });
      toast.success("Price override removed — the tier price applies again");
      onClose();
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  const busy = form.formState.isSubmitting || update.isPending;
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
        <FormError message={error} />
        <MoneyField control={form.control} name="price_per_person" label="Price per person" required className="sm:max-w-xs" />
        <p className="-mt-2 text-xs text-muted-foreground tabular">
          {formatNumber(booking.people_booked)} people × price = {total === null ? "—" : formatMoney(total)} (VAT inclusive)
        </p>
        <TextareaField control={form.control} name="price_override_reason" label="Reason" rows={2} required placeholder="e.g. returning school, agreed last year's rate" />
        <DialogFooter className="sm:justify-between">
          {booking.price_overridden ? (
            <Button type="button" variant="ghost" onClick={clear} disabled={busy}>
              Remove override
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Save price
            </Button>
          </div>
        </DialogFooter>
      </form>
    </Form>
  );
}

// ------------------------------------------------------------- deposit

const depositSchema = z
  .object({
    deposit_waived: z.boolean(),
    deposit_due: z.number({ error: "Enter the deposit" }).min(0, "Cannot be negative"),
    deposit_override_reason: z.string().trim().min(3, "Give the reason"),
  })
  .refine((v) => v.deposit_waived || Number.isFinite(v.deposit_due), { message: "Enter the deposit", path: ["deposit_due"] });

export function DepositOverrideDialog({ booking, open, onOpenChange }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Override deposit</DialogTitle>
          <DialogDescription>
            The deposit is the larger of the minimum-people rule and the percentage rule, capped at the total. Waiving it lets you confirm without money in.
          </DialogDescription>
        </DialogHeader>
        {open ? <DepositForm key={booking.updated_at} booking={booking} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DepositForm({ booking, onClose }: { booking: BookingDetail; onClose: () => void }) {
  const update = useUpdateBooking(booking.id);
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({
    schema: depositSchema,
    defaultValues: {
      deposit_waived: booking.deposit_waived,
      deposit_due: booking.deposit_due,
      deposit_override_reason: booking.deposit_override_reason ?? "",
    },
  });
  const waived = form.watch("deposit_waived");

  async function onSubmit(values: z.output<typeof depositSchema>) {
    setError(null);
    try {
      await update.mutateAsync(
        values.deposit_waived
          ? { deposit_waived: true, deposit_override_reason: values.deposit_override_reason }
          : { deposit_waived: false, deposit_due: values.deposit_due, deposit_overridden: true, deposit_override_reason: values.deposit_override_reason },
      );
      toast.success(values.deposit_waived ? "Deposit waived" : `Deposit set to ${formatMoney(values.deposit_due)}`);
      onClose();
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  async function clear() {
    setError(null);
    try {
      await update.mutateAsync({ deposit_overridden: false, deposit_waived: false, deposit_override_reason: null });
      toast.success("Deposit override removed — the standard rule applies again");
      onClose();
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  const busy = form.formState.isSubmitting || update.isPending;
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
        <FormError message={error} />
        <SwitchField control={form.control} name="deposit_waived" label="Waive the deposit" description="No deposit is required; the booking can be confirmed by hand." />
        <MoneyField control={form.control} name="deposit_due" label="Deposit due" disabled={waived} className="sm:max-w-xs" max={booking.finance.total_amount} />
        <TextareaField control={form.control} name="deposit_override_reason" label="Reason" rows={2} required placeholder="e.g. church pays on the day every year" />
        <DialogFooter className="sm:justify-between">
          {booking.deposit_overridden || booking.deposit_waived ? (
            <Button type="button" variant="ghost" onClick={clear} disabled={busy}>
              Remove override
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Save deposit
            </Button>
          </div>
        </DialogFooter>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------- hold

const holdSchema = z.object({
  hold_expires_on: z.string(),
});

export function HoldDialog({ booking, open, onOpenChange }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Hold expiry</DialogTitle>
          <DialogDescription>
            The day the provisional hold lapses if no deposit arrives. It moves with the visit date unless set here by hand.
          </DialogDescription>
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
