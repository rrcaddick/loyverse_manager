/**
 * Record a payment against a booking (POST /bookings/:id/payments).
 * Managers may only record cash and card (gate payments); admins any kind.
 */

import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { DateField, FieldRow, FormError, MoneyField, RadioField, TextField, TextareaField, applyApiErrors, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth";
import { formatMoney, todayIso } from "@/lib/format";

import { useRecordPayment } from "../api";
import { PAYMENT_KIND_LABELS, type BookingFinance, type PaymentKind } from "../types";

const schema = z.object({
  kind: z.enum(["eft", "cash", "card", "other"], { error: "Choose how it was paid" }),
  amount: z.number({ error: "Enter the amount" }).positive("Enter an amount above zero"),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the payment date"),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: { id: number; reference: string; group_name: string; finance?: BookingFinance | null };
  /** "gate" limits the kinds to cash and card and words the dialog for the gate. */
  mode?: "office" | "gate";
}

export function RecordPaymentDialog({ open, onOpenChange, booking, mode = "office" }: RecordPaymentDialogProps) {
  const { isAdmin } = useAuth();
  const gate = mode === "gate" || !isAdmin;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{gate ? "Record gate payment" : "Record payment"}</DialogTitle>
          <DialogDescription>
            {booking.reference} · {booking.group_name}
            {booking.finance ? (
              <>
                {" "}
                · balance due <span className="tabular text-foreground">{formatMoney(booking.finance.balance_due)}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {open ? <PaymentForm key={booking.id} booking={booking} gate={gate} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({ booking, gate, onClose }: { booking: RecordPaymentDialogProps["booking"]; gate: boolean; onClose: () => void }) {
  const record = useRecordPayment(booking.id);
  const [error, setError] = useState<string | null>(null);
  const kinds: PaymentKind[] = gate ? ["cash", "card"] : ["eft", "cash", "card", "other"];
  const form = useZodForm({
    schema,
    defaultValues: {
      kind: gate ? "cash" : "eft",
      amount: booking.finance && booking.finance.balance_due > 0 ? Number(booking.finance.balance_due.toFixed(2)) : Number.NaN,
      paid_on: todayIso(),
      reference: "",
      note: "",
    },
  });

  async function onSubmit(values: z.output<typeof schema>) {
    setError(null);
    try {
      const detail = await record.mutateAsync({
        kind: values.kind,
        amount: values.amount,
        paid_on: values.paid_on,
        reference: values.reference || undefined,
        note: values.note || undefined,
      });
      const confirmedNow = detail.status === "confirmed" && booking.finance && !booking.finance.deposit_covered;
      toast.success(`${formatMoney(values.amount)} ${PAYMENT_KIND_LABELS[values.kind].toLowerCase()} payment recorded`, {
        description: confirmedNow ? `${booking.reference} is now confirmed.` : undefined,
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
        <RadioField
          control={form.control}
          name="kind"
          label="Paid by"
          options={kinds.map((k) => ({ value: k, label: PAYMENT_KIND_LABELS[k] }))}
        />
        <FieldRow>
          <MoneyField control={form.control} name="amount" label="Amount" required />
          <DateField control={form.control} name="paid_on" label="Paid on" required max={todayIso()} />
        </FieldRow>
        {!gate ? <TextField control={form.control} name="reference" label="Reference" placeholder="Bank reference or receipt number" /> : null}
        <TextareaField control={form.control} name="note" label="Note" rows={2} placeholder={gate ? "e.g. paid at the gate by the driver" : undefined} />
        {booking.finance && !booking.finance.deposit_covered ? (
          <p className="text-xs text-muted-foreground">
            Deposit outstanding: <span className="tabular text-foreground">{formatMoney(booking.finance.deposit_outstanding)}</span>. Covering it confirms the booking automatically.
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Record payment
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
