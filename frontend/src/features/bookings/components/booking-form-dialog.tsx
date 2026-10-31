/**
 * Create / edit a booking. The same dialog serves the calendar ("Add booking"
 * with the day prefilled), the bookings list and the record's Edit (E).
 * Creation POSTs /bookings; editing PATCHes only the fields that changed.
 *
 * Visitors only (no adults / children). Billing address and VAT number sit
 * under "Invoice details". Pricing is the rate the rules give for the date,
 * the kind of group and the visitors (GET /bookings/quote, live as the form
 * changes) and, when a lower price was agreed, that price with its reason:
 * the server records the gap as a discount below the rate.
 */

import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import {
  DateField,
  FieldRow,
  FormError,
  MoneyField,
  NumberField,
  RadioField,
  SelectField,
  TextField,
  TextareaField,
  applyApiErrors,
  useZodForm,
} from "@/components/form";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { depositFor, useSettings } from "@/features/settings/api";
import { formatMoney, formatNumber, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useCreateBooking, useQuote, useUpdateBooking } from "../api";
import type { BookingDetail, BookingInput, RateQuote } from "../types";

export type EditFocus = "contact" | "pricing" | null;

const optionalText = z.string().trim().optional();

const schema = z
  .object({
    group_name: z.string().trim().min(2, "Enter the group's name"),
    group_type: z.string().min(1, "Choose the kind of group"),
    area: optionalText,
    contact_name: z.string().trim().min(2, "Enter the contact's name"),
    contact_email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address")]),
    contact_mobile: optionalText,
    visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the visit date"),
    alternative_date: z.string().optional(),
    visitors: z.number({ error: "Enter the number of visitors" }).int("Whole numbers only").min(1, "Enter at least one visitor"),
    billing_address: z.string().trim().max(500, "At most 500 characters").optional(),
    customer_vat_number: z.string().trim().max(32, "At most 32 characters").optional(),
    customer_notes: optionalText,
    internal_notes: optionalText,
    // pricing: the agreed price per visitor (empty = the rate) and why it is below the rate
    price_per_person: z.number().min(0, "Cannot be negative").optional(),
    discount_reason: optionalText,
    deposit_mode: z.enum(["auto", "custom", "waived"]),
    deposit_due: z.number().min(0, "Cannot be negative").optional(),
    deposit_override_reason: optionalText,
  })
  .superRefine((v, ctx) => {
    if (v.deposit_mode === "custom" && (v.deposit_due === undefined || Number.isNaN(v.deposit_due))) {
      ctx.addIssue({ code: "custom", path: ["deposit_due"], message: "Enter the deposit" });
    }
    if (v.deposit_mode !== "auto" && !v.deposit_override_reason) {
      ctx.addIssue({ code: "custom", path: ["deposit_override_reason"], message: "Give the reason" });
    }
  });

type FormValues = z.input<typeof schema>;
type ParsedValues = z.output<typeof schema>;

const nullable = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

function stripUndefined<T extends object>(values: T | undefined): Partial<T> {
  if (!values) return {};
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}
const isNumber = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);

function toInput(values: ParsedValues, booking: BookingDetail | null): BookingInput {
  const input: BookingInput = {
    group_name: values.group_name,
    group_type: values.group_type,
    area: nullable(values.area),
    contact_name: values.contact_name,
    contact_email: nullable(values.contact_email),
    contact_mobile: nullable(values.contact_mobile),
    visit_date: values.visit_date,
    alternative_date: nullable(values.alternative_date),
    people_booked: values.visitors,
    billing_address: nullable(values.billing_address),
    customer_vat_number: nullable(values.customer_vat_number),
    customer_notes: nullable(values.customer_notes),
    internal_notes: nullable(values.internal_notes),
  };
  if (isNumber(values.price_per_person)) {
    input.price_per_person = values.price_per_person;
    input.discount_reason = nullable(values.discount_reason);
  } else if (booking && booking.discount_per_person > 0) {
    input.discount_per_person = 0; // the agreed price was cleared: back to the rate
  }
  if (values.deposit_mode === "waived") {
    input.deposit_waived = true;
    input.deposit_overridden = false;
    input.deposit_override_reason = values.deposit_override_reason ?? null;
  } else if (values.deposit_mode === "custom") {
    input.deposit_waived = false;
    input.deposit_due = values.deposit_due;
    input.deposit_overridden = true;
    input.deposit_override_reason = values.deposit_override_reason ?? null;
  } else if (booking) {
    input.deposit_waived = false;
    input.deposit_overridden = false;
    input.deposit_override_reason = null;
  }
  return input;
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
    visitors: booking?.people_booked ?? Number.NaN,
    billing_address: booking?.billing_address ?? "",
    customer_vat_number: booking?.customer_vat_number ?? "",
    customer_notes: booking?.customer_notes ?? "",
    internal_notes: booking?.internal_notes ?? "",
    price_per_person: booking && booking.discount_per_person > 0 ? booking.price_per_person : undefined,
    discount_reason: booking?.discount_reason ?? "",
    deposit_mode: booking?.deposit_waived ? "waived" : booking?.deposit_overridden ? "custom" : "auto",
    deposit_due: booking?.deposit_due ?? undefined,
    deposit_override_reason: booking?.deposit_override_reason ?? "",
  };
}

// ------------------------------------------------------------------ dialog

/** Create mode: values to start the form with (an enquiry's extraction, a calendar day). */
export type BookingFormPrefill = Partial<Pick<FormValues, "group_name" | "group_type" | "area" | "contact_name" | "contact_email" | "contact_mobile" | "visit_date" | "alternative_date" | "visitors" | "customer_notes" | "internal_notes">>;

export interface BookingFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present → edit mode. */
  booking?: BookingDetail | null;
  /** Create mode: prefill the visit date (from the calendar). */
  defaultDate?: string;
  /** Create mode: more starting values (an enquiry's details). */
  prefill?: BookingFormPrefill;
  /** Create mode: fields sent with the form's own (questions from an enquiry). */
  extraInput?: Partial<BookingInput>;
  /** Create mode: create through another endpoint (an enquiry's Create request). */
  onCreate?: (input: BookingInput) => Promise<BookingDetail>;
  /** Create mode: called with the new booking; defaults to navigating to it. */
  onCreated?: (booking: BookingDetail) => void;
  /** Edit mode: open on the contact fields or with Pricing expanded. */
  focus?: EditFocus;
  /** Title, description and submit label when the dialog is not plainly "New booking". */
  copy?: { title: string; description: string; submit: string };
}

export function BookingFormDialog({ open, onOpenChange, booking = null, defaultDate, prefill, extraInput, onCreate, onCreated, focus = null, copy }: BookingFormDialogProps) {
  const editing = !!booking;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-section">{editing ? `Edit ${booking.reference}` : (copy?.title ?? "New booking")}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changing the date, kind of group or visitors recalculates the rate and deposit. An agreed price below the rate stays as a discount."
              : (copy?.description ?? "A group that booked by phone or in person. The rate follows the date, kind of group and visitors; the reference is assigned on save.")}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <BookingForm
            key={booking?.id ?? `new-${defaultDate ?? ""}`}
            booking={booking}
            defaultDate={defaultDate}
            prefill={prefill}
            extraInput={extraInput}
            onCreate={onCreate}
            submitLabel={copy?.submit}
            focus={focus}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const RATE_DAY_LABEL: Record<RateQuote["rate_day"], string> = {
  peak: "peak day",
  public_holiday: "public holiday",
  weekend: "weekend",
  school_holiday: "school holidays",
  weekday: "term-time weekday",
};

function BookingForm({
  booking,
  defaultDate,
  prefill,
  extraInput,
  onCreate,
  submitLabel,
  focus,
  onClose,
  onCreated,
}: {
  booking: BookingDetail | null;
  defaultDate?: string;
  prefill?: BookingFormPrefill;
  extraInput?: Partial<BookingInput>;
  onCreate?: (input: BookingInput) => Promise<BookingDetail>;
  submitLabel?: string;
  focus: EditFocus;
  onClose: () => void;
  onCreated?: (booking: BookingDetail) => void;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const create = useCreateBooking();
  const update = useUpdateBooking(booking?.id ?? 0);
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: { ...defaultsFor(booking, defaultDate), ...(booking ? {} : stripUndefined(prefill)) } });
  const [invoiceOpen, setInvoiceOpen] = useState(!!(booking?.billing_address || booking?.customer_vat_number));
  const [pricingOpen, setPricingOpen] = useState(focus === "pricing" || !!booking && (booking.discount_per_person > 0 || booking.deposit_overridden || booking.deposit_waived));

  useEffect(() => {
    if (focus === "contact") {
      const timer = window.setTimeout(() => form.setFocus("contact_email"), 50);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [focus, form]);

  const groupTypeOptions = useMemo(() => (settings.data?.settings.form.group_types ?? []).map((t) => ({ value: t.code, label: t.label })), [settings.data]);
  // Imported rows can carry a kind that is no longer configured; keep it selectable.
  const options = useMemo(() => {
    const current = booking?.group_type;
    if (current && !groupTypeOptions.some((o) => o.value === current)) return [...groupTypeOptions, { value: current, label: current }];
    return groupTypeOptions;
  }, [groupTypeOptions, booking?.group_type]);

  const [visit_date, group_type, visitors, price_per_person, deposit_mode, deposit_due] = form.watch(["visit_date", "group_type", "visitors", "price_per_person", "deposit_mode", "deposit_due"]);
  const visitorsNum = Number.isFinite(visitors) ? Number(visitors) : 0;
  const quote = useQuote(visit_date && visitorsNum > 0 ? { group_type: group_type || null, visit_date, people: visitorsNum, exclude: booking?.id } : null);
  const rate = quote.data;
  const agreed = isNumber(price_per_person) ? Number(price_per_person) : null;
  const price = agreed ?? rate?.tier_price ?? null;
  const discount = rate && agreed !== null ? rate.tier_price - agreed : 0;
  const depositRule = settings.data?.settings.deposit;
  const deposit =
    deposit_mode === "waived"
      ? 0
      : deposit_mode === "custom" && isNumber(deposit_due)
        ? Number(deposit_due)
        : price !== null && depositRule
          ? depositFor(visitorsNum, price, depositRule.min_people, depositRule.percent)
          : (rate?.deposit_due ?? null);

  async function onSubmit(values: ParsedValues) {
    setError(null);
    if (isNumber(values.price_per_person) && rate) {
      if (values.price_per_person > rate.tier_price) {
        form.setError("price_per_person", { message: `The rate is ${formatMoney(rate.tier_price, { compact: true })}. A higher price means a different rate, not a discount.` });
        return;
      }
      if (values.price_per_person < rate.tier_price && !values.discount_reason) {
        form.setError("discount_reason", { message: "Say why the price is below the rate" });
        return;
      }
    }
    const input = toInput(values, booking);
    try {
      if (booking) {
        const changes: BookingInput = {};
        for (const key of Object.keys(input) as (keyof BookingInput)[]) {
          const next = input[key];
          const prev = (booking as unknown as Record<string, unknown>)[key] ?? null;
          if (JSON.stringify(next ?? null) !== JSON.stringify(prev)) (changes as Record<string, unknown>)[key] = next;
        }
        // The agreed price and its reason travel together.
        if ("price_per_person" in changes || "discount_reason" in changes) {
          if (isNumber(input.price_per_person)) {
            changes.price_per_person = input.price_per_person;
            changes.discount_reason = input.discount_reason ?? null;
          }
        }
        if ("deposit_due" in changes || "deposit_override_reason" in changes || "deposit_waived" in changes) {
          changes.deposit_waived = input.deposit_waived;
          changes.deposit_overridden = input.deposit_overridden;
          changes.deposit_override_reason = input.deposit_override_reason;
          if (input.deposit_overridden) changes.deposit_due = input.deposit_due;
        }
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        await update.mutateAsync(changes);
        toast.success("Booking updated");
        onClose();
      } else {
        const payload = { ...input, ...stripUndefined(extraInput) } as BookingInput;
        const created = onCreate ? await onCreate(payload) : await create.mutateAsync(payload);
        if (!onCreate) toast.success(`${created.reference} created for ${created.group_name}`);
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
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
        <FormError message={error} />

        <Group label="Visit">
          <FieldRow>
            <DateField control={form.control} name="visit_date" label="Visit date" required min={booking ? undefined : todayIso()} />
            <DateField control={form.control} name="alternative_date" label="Alternative date" clearable />
          </FieldRow>
          <NumberField control={form.control} name="visitors" label="Visitors" integer min={1} required className="sm:max-w-[12rem]" />
        </Group>

        <Group label="Group">
          <FieldRow>
            <TextField control={form.control} name="group_name" label="Group name" required autoFocus={!booking && focus === null} placeholder="Hillside Community Church" />
            <SelectField control={form.control} name="group_type" label="Kind of group" required options={options} placeholder={settings.isPending ? "Loading…" : "Choose a kind"} disabled={settings.isPending} />
          </FieldRow>
          <TextField control={form.control} name="area" label="Area" placeholder="Mitchells Plain" className="sm:max-w-sm" />
        </Group>

        <Group label="Contact">
          <TextField control={form.control} name="contact_name" label="Contact name" required placeholder="Jane Dlamini" className="sm:max-w-sm" />
          <FieldRow>
            <TextField control={form.control} name="contact_email" label="Email" type="email" autoComplete="off" placeholder="jane@example.com" description="Needed for the proforma, invoices and ticket." />
            <TextField control={form.control} name="contact_mobile" label="Mobile" type="tel" autoComplete="off" placeholder="082 123 4567" description="Needed to WhatsApp the ticket." />
          </FieldRow>
          <Disclosure open={invoiceOpen} onOpenChange={setInvoiceOpen} label="Invoice details" hint="Billing address and VAT number, when the customer needs them on the documents">
            <TextareaField control={form.control} name="billing_address" label="Billing address" rows={3} placeholder={"Hillside Community Church\n12 Main Road\nMitchells Plain 7785"} description="One line per address line. Printed under “Bill to” on every document." />
            <TextField control={form.control} name="customer_vat_number" label="Customer VAT number" placeholder="4123456789" className="sm:max-w-xs" mono />
          </Disclosure>
        </Group>

        <Group label="Pricing">
          <div className="flex flex-col gap-1 text-body tabular text-foreground" aria-live="polite">
            {rate && visitorsNum > 0 ? (
              <>
                <p>
                  <span className="font-medium">{rate.tier_label}</span>
                  <span className="text-muted-foreground"> · {RATE_DAY_LABEL[rate.rate_day]} · </span>
                  {formatMoney(rate.tier_price, { compact: true })} per visitor
                  {discount > 0 ? <span className="text-muted-foreground"> · less {formatMoney(discount, { compact: true })} discount</span> : null}
                </p>
                <p>
                  {formatNumber(visitorsNum)} × {formatMoney(price ?? rate.tier_price, { compact: true })} = <span className="font-semibold">{formatMoney(visitorsNum * (price ?? rate.tier_price), { compact: true })}</span>
                  {deposit !== null ? (
                    <>
                      {" "}
                      · deposit <span className="font-medium">{deposit_mode === "waived" ? "waived" : formatMoney(deposit, { compact: true })}</span>
                    </>
                  ) : null}
                </p>
                {rate.under_minimum ? (
                  <p className="text-sm text-muted-foreground">
                    {rate.minimum_waived
                      ? `Under the group minimum of ${rate.group_minimum}, but another group is booked that day, so the group rate applies.`
                      : `Under the group minimum of ${rate.group_minimum}: the public rate applies.`}
                  </p>
                ) : null}
              </>
            ) : quote.isFetching ? (
              <span className="text-muted-foreground">Working out the rate…</span>
            ) : (
              <span className="text-muted-foreground">Enter the date, kind of group and visitors to see the rate.</span>
            )}
          </div>
          <Disclosure open={pricingOpen} onOpenChange={setPricingOpen} label="Agreed price and deposit" hint="A price below the rate is recorded as a discount with its reason; a special deposit keeps its reason too">
            <FieldRow>
              <MoneyField control={form.control} name="price_per_person" label="Agreed price per visitor" description={rate ? `Leave empty for the rate, ${formatMoney(rate.tier_price, { compact: true })}.` : "Leave empty for the rate."} />
              <TextField control={form.control} name="discount_reason" label="Reason for the discount" placeholder="e.g. booked last season at last season's rate" />
            </FieldRow>
            <RadioField
              control={form.control}
              name="deposit_mode"
              label="Deposit"
              options={[
                { value: "auto", label: "Standard rule" },
                { value: "custom", label: "Custom amount" },
                { value: "waived", label: "Waived" },
              ]}
            />
            {deposit_mode === "custom" ? (
              <FieldRow>
                <MoneyField control={form.control} name="deposit_due" label="Deposit due" required max={price !== null ? visitorsNum * price : undefined} />
                <TextField control={form.control} name="deposit_override_reason" label="Reason" required placeholder="e.g. church pays half up front" />
              </FieldRow>
            ) : deposit_mode === "waived" ? (
              <TextField control={form.control} name="deposit_override_reason" label="Reason" required placeholder="e.g. pays on the day every year" className="sm:max-w-sm" />
            ) : null}
          </Disclosure>
        </Group>

        <Group label="Notes">
          <FieldRow>
            <TextareaField control={form.control} name="customer_notes" label="Notes from the customer" rows={2} />
            <TextareaField control={form.control} name="internal_notes" label="Internal note" rows={2} description="Only the office sees this." />
          </FieldRow>
        </Group>

        <DialogFooter className="sticky bottom-0 z-10 mt-2 border-border bg-popover">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (!!booking && !form.formState.isDirty)}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {booking ? "Save changes" : (submitLabel ?? "Create booking")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-label mb-3 text-muted-foreground uppercase">{label}</legend>
      {children}
    </fieldset>
  );
}

function Disclosure({ open, onOpenChange, label, hint, children }: { open: boolean; onOpenChange: (open: boolean) => void; label: string; hint: string; children: React.ReactNode }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-lg ring-1 ring-border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring">
          <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          <span className="min-w-0">
            <span className="block text-body font-medium text-foreground">{label}</span>
            <span className="block text-sm text-muted-foreground">{hint}</span>
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 border-t border-border px-3 pt-3 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
