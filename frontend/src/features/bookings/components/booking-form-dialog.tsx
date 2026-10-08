/**
 * Create / edit a booking. The same dialog serves the calendar ("Add booking"
 * with the day prefilled), the bookings list and the detail page's Edit.
 * Creation POSTs /bookings; editing PATCHes only the fields that changed.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import {
  DateField,
  FieldRow,
  FormError,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
  applyApiErrors,
  useZodForm,
} from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { useSettings } from "@/features/settings/api";
import { formatNumber, todayIso } from "@/lib/format";

import { useCreateBooking, useUpdateBooking } from "../api";
import type { BookingDetail, BookingInput } from "../types";

const optionalText = z.string().trim().optional();

const schema = z
  .object({
    group_name: z.string().trim().min(2, "Enter the group's name"),
    group_type: z.string().min(1, "Choose a group type"),
    area: optionalText,
    contact_name: z.string().trim().min(2, "Enter the contact's name"),
    contact_email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address")]),
    contact_mobile: optionalText,
    visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the visit date"),
    alternative_date: z.string().optional(),
    arrival_time: optionalText,
    adults: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Cannot be negative"),
    children: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Cannot be negative"),
    vehicles: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Cannot be negative"),
    gazebos: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Cannot be negative").max(7, "The park has 7 gazebos"),
    customer_notes: optionalText,
    internal_notes: optionalText,
  })
  .refine((v) => v.adults + v.children >= 1, { message: "Enter at least one person", path: ["adults"] });

type FormValues = z.input<typeof schema>;
type ParsedValues = z.output<typeof schema>;

function toInput(values: ParsedValues): BookingInput {
  const nullable = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    group_name: values.group_name,
    group_type: values.group_type,
    area: nullable(values.area),
    contact_name: values.contact_name,
    contact_email: nullable(values.contact_email),
    contact_mobile: nullable(values.contact_mobile),
    visit_date: values.visit_date,
    alternative_date: nullable(values.alternative_date),
    arrival_time: nullable(values.arrival_time),
    adults: values.adults,
    children: values.children,
    people_booked: values.adults + values.children,
    vehicles: values.vehicles,
    gazebos: values.gazebos,
    customer_notes: nullable(values.customer_notes),
    internal_notes: nullable(values.internal_notes),
  };
}

function defaultsFor(booking: BookingDetail | null, defaultDate?: string): FormValues {
  return {
    group_name: booking?.group_name ?? "",
    group_type: booking?.group_type ?? "",
    area: booking?.area ?? "",
    contact_name: booking?.contact_name ?? "",
    contact_email: booking?.contact_email ?? "",
    contact_mobile: booking?.contact_mobile ?? "",
    visit_date: booking?.visit_date ?? defaultDate ?? "",
    alternative_date: booking?.alternative_date ?? "",
    arrival_time: booking?.arrival_time ?? "",
    adults: booking?.adults ?? 0,
    children: booking?.children ?? 0,
    vehicles: booking?.vehicles ?? 0,
    gazebos: booking?.gazebos ?? 0,
    customer_notes: booking?.customer_notes ?? "",
    internal_notes: booking?.internal_notes ?? "",
  };
}

export interface BookingFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present → edit mode. */
  booking?: BookingDetail | null;
  /** Create mode: prefill the visit date (from the calendar). */
  defaultDate?: string;
  /** Create mode: called with the new booking; defaults to navigating to it. */
  onCreated?: (booking: BookingDetail) => void;
}

export function BookingFormDialog({ open, onOpenChange, booking = null, defaultDate, onCreated }: BookingFormDialogProps) {
  const editing = !!booking;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${booking.reference}` : "New booking"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changing the date, group type or numbers recalculates the price and deposit unless they are overridden."
              : "Capture a group that booked by phone or in person. The price and deposit are worked out from the date and group type; the reference is assigned on save."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <BookingForm
            key={booking?.id ?? `new-${defaultDate ?? ""}`}
            booking={booking}
            defaultDate={defaultDate}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BookingForm({
  booking,
  defaultDate,
  onClose,
  onCreated,
}: {
  booking: BookingDetail | null;
  defaultDate?: string;
  onClose: () => void;
  onCreated?: (booking: BookingDetail) => void;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const create = useCreateBooking();
  const update = useUpdateBooking(booking?.id ?? 0);
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: defaultsFor(booking, defaultDate) });

  const groupTypeOptions = useMemo(
    () => (settings.data?.settings.form.group_types ?? []).map((t) => ({ value: t.code, label: t.label })),
    [settings.data],
  );
  // Imported rows can carry a type that is no longer configured; keep it selectable.
  const options = useMemo(() => {
    const current = booking?.group_type;
    if (current && !groupTypeOptions.some((o) => o.value === current)) {
      return [...groupTypeOptions, { value: current, label: current }];
    }
    return groupTypeOptions;
  }, [groupTypeOptions, booking?.group_type]);

  const adults = form.watch("adults");
  const children = form.watch("children");
  const people = (Number.isFinite(adults) ? adults : 0) + (Number.isFinite(children) ? children : 0);

  async function onSubmit(values: ParsedValues) {
    setError(null);
    const input = toInput(values);
    try {
      if (booking) {
        const changes: BookingInput = {};
        for (const key of Object.keys(input) as (keyof BookingInput)[]) {
          const next = input[key];
          const prev = (booking as unknown as Record<string, unknown>)[key] ?? null;
          if (JSON.stringify(next ?? null) !== JSON.stringify(prev)) {
            (changes as Record<string, unknown>)[key] = next;
          }
        }
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        await update.mutateAsync(changes);
        toast.success("Booking updated");
        onClose();
      } else {
        const created = await create.mutateAsync(input);
        toast.success(`${created.reference} created for ${created.group_name}`);
        onClose();
        if (onCreated) onCreated(created);
        else navigate(`/bookings/${created.id}`);
      }
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
        <FormError message={error} />

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Group</legend>
          <FieldRow>
            <TextField control={form.control} name="group_name" label="Group name" required autoFocus={!booking} placeholder="Hillside Community Church" />
            <SelectField
              control={form.control}
              name="group_type"
              label="Group type"
              required
              options={options}
              placeholder={settings.isPending ? "Loading…" : "Choose a type"}
              disabled={settings.isPending}
            />
          </FieldRow>
          <FieldRow>
            <TextField control={form.control} name="area" label="Area" placeholder="Mitchells Plain" />
            <TextField control={form.control} name="arrival_time" label="Arrival time" placeholder="09:30" />
          </FieldRow>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Contact</legend>
          <TextField control={form.control} name="contact_name" label="Contact name" required placeholder="Jane Dlamini" className="sm:max-w-sm" />
          <FieldRow>
            <TextField control={form.control} name="contact_email" label="Email" type="email" autoComplete="off" placeholder="jane@example.com" description="Needed for proformas, invoices and the ticket." />
            <TextField control={form.control} name="contact_mobile" label="Mobile" type="tel" autoComplete="off" placeholder="082 123 4567" description="Needed to WhatsApp the ticket." />
          </FieldRow>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Visit</legend>
          <FieldRow>
            <DateField control={form.control} name="visit_date" label="Visit date" required min={booking ? undefined : todayIso()} />
            <DateField control={form.control} name="alternative_date" label="Alternative date" clearable />
          </FieldRow>
          <div className="grid gap-5 sm:grid-cols-4">
            <NumberField control={form.control} name="adults" label="Adults" integer min={0} />
            <NumberField control={form.control} name="children" label="Children" integer min={0} />
            <NumberField control={form.control} name="vehicles" label="Vehicles" integer min={0} />
            <NumberField control={form.control} name="gazebos" label="Gazebos" integer min={0} max={7} />
          </div>
          <p className="-mt-1 text-sm text-muted-foreground tabular" aria-live="polite">
            {people > 0 ? `${formatNumber(people)} people in total` : "People in total: enter adults and children"}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Notes</legend>
          <TextareaField control={form.control} name="customer_notes" label="Notes from the customer" rows={2} />
          <TextareaField control={form.control} name="internal_notes" label="Internal notes" rows={2} description="Only visible to the office." />
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (!!booking && !form.formState.isDirty)}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {booking ? "Save changes" : "Create booking"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
