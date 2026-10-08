/**
 * "Create booking from this email": POST /inbox/messages/:id/extract fills a
 * booking form (the same fields as the public request form); saving POSTs
 * /bookings with source "email", attaches the thread and opens the booking.
 */

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import { DateField, FieldRow, FormError, NumberField, SelectField, TextField, TextareaField, applyApiErrors, useZodForm } from "@/components/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { useFormConfig } from "@/features/public/api";
import { useCreateBooking } from "@/features/queue/bookings";
import { errorMessage, isApiError } from "@/lib/api";

import { useAttachMessage, useExtractMessage } from "./api";
import type { ExtractedFields, FullMessage } from "./types";

interface CreateBookingDialogProps {
  message: FullMessage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const count = z.number({ error: "Enter a whole number" }).int("Enter a whole number").min(0, "Cannot be negative");

const schema = z
  .object({
    group_name: z.string().trim().min(1, "Enter the group name"),
    group_type: z.string().min(1, "Choose a group type"),
    area: z.string().trim(),
    contact_name: z.string().trim().min(1, "Enter the contact name"),
    contact_email: z.string().trim().email("Enter a valid email address").or(z.literal("")),
    contact_mobile: z.string().trim(),
    visit_date: isoDate,
    alternative_date: isoDate.or(z.literal("")),
    arrival_time: z.string().trim().max(20, "Keep it short, e.g. 10:00"),
    adults: count,
    children: count,
    vehicles: count,
    gazebos: count,
    questions: z.string(),
    customer_notes: z.string().trim(),
    internal_notes: z.string().trim(),
  })
  .refine((v) => v.adults + v.children >= 1, { path: ["adults"], message: "Enter how many people are coming" });

type FormValues = z.input<typeof schema>;

function defaultsFrom(fields: Partial<ExtractedFields> | null, message: FullMessage): FormValues {
  const adults = fields?.adults ?? (fields?.people_booked && !fields?.children ? fields.people_booked : 0);
  return {
    group_name: fields?.group_name ?? "",
    group_type: fields?.group_type ?? "",
    area: fields?.area ?? "",
    contact_name: fields?.contact_name ?? message.from_name ?? "",
    contact_email: fields?.contact_email ?? message.from_email ?? "",
    contact_mobile: fields?.contact_mobile ?? "",
    visit_date: fields?.visit_date ?? "",
    alternative_date: fields?.alternative_date ?? "",
    arrival_time: fields?.arrival_time ?? "",
    adults: adults ?? 0,
    children: fields?.children ?? 0,
    vehicles: fields?.vehicles ?? 0,
    gazebos: fields?.gazebos ?? 0,
    questions: (fields?.questions ?? []).join("\n"),
    customer_notes: fields?.notes ?? "",
    internal_notes: "",
  };
}

export function CreateBookingDialog({ message, open, onOpenChange }: CreateBookingDialogProps) {
  const extract = useExtractMessage();
  const [seed, setSeed] = useState<{ messageId: number; fields: Partial<ExtractedFields> | null; notice: string | null } | null>(null);
  const startedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !message) return;
    if (startedFor.current === message.id) return;
    startedFor.current = message.id;
    setSeed(null);
    extract
      .mutateAsync(message.id)
      .then((result) => setSeed({ messageId: message.id, fields: result.fields, notice: null }))
      .catch((error: unknown) => {
        const notice =
          isApiError(error) && error.code === "not_configured"
            ? "Automatic extraction is not configured on this server; the form is prefilled from the sender only."
            : `Could not read the email automatically (${errorMessage(error)}); the form is prefilled from the sender only.`;
        setSeed({ messageId: message.id, fields: null, notice });
      });
  }, [open, message, extract]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      startedFor.current = null;
      setSeed(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a booking from this email</DialogTitle>
          <DialogDescription>Check the details pulled from the email, then save. The whole thread is attached to the new booking.</DialogDescription>
        </DialogHeader>
        {message && seed && seed.messageId === message.id ? (
          <CreateBookingForm key={message.id} message={message} seed={seed} onDone={() => handleOpenChange(false)} />
        ) : (
          <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground" role="status" aria-live="polite">
            <Spinner />
            Reading the email…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateBookingForm({
  message,
  seed,
  onDone,
}: {
  message: FullMessage;
  seed: { fields: Partial<ExtractedFields> | null; notice: string | null };
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const config = useFormConfig();
  const create = useCreateBooking();
  const attach = useAttachMessage();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: defaultsFrom(seed.fields, message) });

  const groupTypes = (config.data?.group_types ?? []).map((g) => ({ value: g.code, label: g.label }));

  async function onSubmit(values: z.output<typeof schema>) {
    setError(null);
    const questions = values.questions
      .split(/\n+/)
      .map((q) => q.trim())
      .filter(Boolean);
    const payload: Record<string, unknown> = {
      source: "email",
      group_name: values.group_name,
      group_type: values.group_type,
      area: values.area || null,
      contact_name: values.contact_name,
      contact_email: values.contact_email || null,
      contact_mobile: values.contact_mobile || null,
      visit_date: values.visit_date,
      alternative_date: values.alternative_date || null,
      arrival_time: values.arrival_time || null,
      adults: values.adults,
      children: values.children,
      vehicles: values.vehicles,
      gazebos: values.gazebos,
      customer_notes: values.customer_notes || null,
      internal_notes: values.internal_notes || null,
      questions,
    };
    try {
      const booking = await create.mutateAsync(payload);
      try {
        await attach.mutateAsync({ id: message.id, booking_id: booking.id, whole_thread: true });
      } catch {
        // The booking exists; attaching can be redone from the thread.
      }
      toast.success(`${booking.reference} created for ${booking.group_name}`);
      onDone();
      navigate(`/bookings/${booking.id}`);
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        {seed.notice ? (
          <Alert>
            <Sparkles />
            <AlertTitle>Prefilled from the sender</AlertTitle>
            <AlertDescription>{seed.notice}</AlertDescription>
          </Alert>
        ) : null}
        <FormError message={error} />
        <FieldRow>
          <TextField control={form.control} name="group_name" label="Group name" required autoComplete="off" />
          <SelectField control={form.control} name="group_type" label="Group type" required options={groupTypes} placeholder={config.isPending ? "Loading…" : "Choose a type"} />
        </FieldRow>
        <FieldRow>
          <TextField control={form.control} name="contact_name" label="Contact name" required autoComplete="off" />
          <TextField control={form.control} name="area" label="Area or town" autoComplete="off" />
        </FieldRow>
        <FieldRow>
          <TextField control={form.control} name="contact_email" label="Email" type="email" autoComplete="off" />
          <TextField control={form.control} name="contact_mobile" label="Mobile" type="tel" autoComplete="off" placeholder="082 123 4567" />
        </FieldRow>
        <FieldRow>
          <DateField control={form.control} name="visit_date" label="Visit date" required />
          <DateField control={form.control} name="alternative_date" label="Alternative date" clearable />
        </FieldRow>
        <FieldRow className="sm:grid-cols-4">
          <NumberField control={form.control} name="adults" label="Adults" integer min={0} />
          <NumberField control={form.control} name="children" label="Children" integer min={0} />
          <NumberField control={form.control} name="vehicles" label="Vehicles" integer min={0} />
          <NumberField control={form.control} name="gazebos" label="Gazebos" integer min={0} />
        </FieldRow>
        <TextField control={form.control} name="arrival_time" label="Arrival time" placeholder="10:00" autoComplete="off" className="sm:max-w-xs" />
        <TextareaField control={form.control} name="questions" label="Questions from the customer" rows={3} description="One per line. They can be answered from the booking." />
        <TextareaField control={form.control} name="customer_notes" label="Customer notes" rows={3} />
        <TextareaField control={form.control} name="internal_notes" label="Internal notes" rows={2} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            Create booking
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
