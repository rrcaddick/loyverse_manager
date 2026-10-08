/**
 * Create / edit a booking. The same dialog serves the calendar ("Add booking"
 * with the day prefilled), the bookings list and the record's Edit (E).
 * Creation POSTs /bookings; editing PATCHes only the fields that changed.
 *
 * Visitors only (no adults / children). Billing address and VAT number sit
 * under "Invoice details"; price and deposit overrides, each with a reason,
 * under "Pricing". The price line is live: the estimate follows the date,
 * the kind of group and the visitors, and the server recalculates on save.
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
  SwitchField,
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
import { useSettings } from "@/features/settings/api";
import { formatMoney, formatNumber, parseDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SettingsResponse } from "@/types/api";

import { useCreateBooking, useUpdateBooking } from "../api";
import type { BookingDetail, BookingInput } from "../types";

export type EditFocus = "contact" | "pricing" | null;

const optionalText = z.string().trim().optional();
const int = (label: string) => z.number({ error: `Enter ${label}` }).int("Whole numbers only").min(0, "Cannot be negative");

const schema = z
  .object({
    group_name: z.string().trim().min(2, "Enter the group's name"),
    group_type: z.string().min(1, "Choose the kind of group"),
    area: optionalText,
    arrival_time: optionalText,
    contact_name: z.string().trim().min(2, "Enter the contact's name"),
    contact_email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address")]),
    contact_mobile: optionalText,
    visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the visit date"),
    alternative_date: z.string().optional(),
    visitors: z.number({ error: "Enter the number of visitors" }).int("Whole numbers only").min(1, "Enter at least one visitor"),
    vehicles: int("the number of vehicles"),
    gazebos: int("the number of gazebos").max(7, "The park has 7 gazebos"),
    billing_address: z.string().trim().max(500, "At most 500 characters").optional(),
    customer_vat_number: z.string().trim().max(32, "At most 32 characters").optional(),
    customer_notes: optionalText,
    internal_notes: optionalText,
    // pricing
    price_override: z.boolean(),
    price_per_person: z.number().min(0, "Cannot be negative").optional(),
    price_override_reason: optionalText,
    deposit_mode: z.enum(["auto", "custom", "waived"]),
    deposit_due: z.number().min(0, "Cannot be negative").optional(),
    deposit_override_reason: optionalText,
  })
  .superRefine((v, ctx) => {
    if (v.price_override) {
      if (v.price_per_person === undefined || Number.isNaN(v.price_per_person)) ctx.addIssue({ code: "custom", path: ["price_per_person"], message: "Enter the price per visitor" });
      if (!v.price_override_reason) ctx.addIssue({ code: "custom", path: ["price_override_reason"], message: "Give the reason for the special price" });
    }
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

function toInput(values: ParsedValues, editing: boolean): BookingInput {
  const input: BookingInput = {
    group_name: values.group_name,
    group_type: values.group_type,
    area: nullable(values.area),
    arrival_time: nullable(values.arrival_time),
    contact_name: values.contact_name,
    contact_email: nullable(values.contact_email),
    contact_mobile: nullable(values.contact_mobile),
    visit_date: values.visit_date,
    alternative_date: nullable(values.alternative_date),
    people_booked: values.visitors,
    vehicles: values.vehicles,
    gazebos: values.gazebos,
    billing_address: nullable(values.billing_address),
    customer_vat_number: nullable(values.customer_vat_number),
    customer_notes: nullable(values.customer_notes),
    internal_notes: nullable(values.internal_notes),
  };
  if (values.price_override) {
    input.price_per_person = values.price_per_person;
    input.price_overridden = true;
    input.price_override_reason = values.price_override_reason ?? null;
  } else if (editing) {
    input.price_overridden = false;
    input.price_override_reason = null;
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
  } else if (editing) {
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
    arrival_time: booking?.arrival_time ?? "",
    contact_name: booking?.contact_name ?? "",
    contact_email: booking?.contact_email ?? "",
    contact_mobile: booking?.contact_mobile ?? "",
    visit_date: booking?.visit_date ?? defaultDate ?? "",
    alternative_date: booking?.alternative_date ?? "",
    visitors: booking?.people_booked ?? Number.NaN,
    vehicles: booking?.vehicles ?? 0,
    gazebos: booking?.gazebos ?? 0,
    billing_address: booking?.billing_address ?? "",
    customer_vat_number: booking?.customer_vat_number ?? "",
    customer_notes: booking?.customer_notes ?? "",
    internal_notes: booking?.internal_notes ?? "",
    price_override: booking?.price_overridden ?? false,
    price_per_person: booking?.price_per_person ?? undefined,
    price_override_reason: booking?.price_override_reason ?? "",
    deposit_mode: booking?.deposit_waived ? "waived" : booking?.deposit_overridden ? "custom" : "auto",
    deposit_due: booking?.deposit_due ?? undefined,
    deposit_override_reason: booking?.deposit_override_reason ?? "",
  };
}

// ---------------------------------------------------------------- estimate

interface Estimate {
  price: number;
  total: number;
  deposit: number;
  tierLabel: string;
  /** True when the estimate is computed here rather than taken from the server. */
  estimated: boolean;
}

function mmdd(iso: string): string {
  return iso.slice(5);
}

function inWindow(iso: string, start: string, end: string): boolean {
  const d = mmdd(iso);
  if (!start || !end) return false;
  return start <= end ? d >= start && d <= end : d >= start || d <= end;
}

function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

/** The server's pricing rules (src/services/pricing.py), approximated for a live line. */
function estimate(settings: SettingsResponse | undefined, values: Pick<FormValues, "visit_date" | "group_type" | "visitors" | "price_override" | "price_per_person" | "deposit_mode" | "deposit_due">, booking: BookingDetail | null): Estimate | null {
  if (!settings) return null;
  const visitors = Number.isFinite(values.visitors) ? Number(values.visitors) : 0;
  const { pricing, deposit, season, form } = settings.settings;
  const unchanged = !!booking && booking.visit_date === values.visit_date && (booking.group_type ?? "") === values.group_type;
  let price: number;
  let tierLabel: string;
  if (values.price_override && values.price_per_person !== undefined && Number.isFinite(values.price_per_person)) {
    price = Number(values.price_per_person);
    tierLabel = "special price";
  } else if (unchanged && !booking.price_overridden) {
    price = booking.price_per_person;
    tierLabel = settings.price_tiers.find((t) => t.code === booking.price_tier_code)?.label ?? booking.price_tier_code ?? "public";
  } else {
    const date = parseDate(values.visit_date);
    const weekend = date ? [0, 6].includes(date.getDay()) : false;
    const gt = form.group_types.find((t) => t.code === values.group_type);
    const tierCode = gt ? (weekend ? gt.weekend_tier : gt.weekday_tier) : null;
    const tier = settings.price_tiers.find((t) => t.code === tierCode);
    const peak = settings.season_days.some((d) => d.day === values.visit_date && d.kind === "peak");
    const window = values.visit_date ? inWindow(values.visit_date, season.no_discount_start, season.no_discount_end) : false;
    if (peak) {
      price = pricing.peak_price;
      tierLabel = "peak";
    } else if (window && tierCode && !tierCode.startsWith("public") && tierCode !== "peak") {
      price = pricing.public_weekend_price;
      tierLabel = "public rate (no-discount window)";
    } else if (tier) {
      price = tier.price;
      tierLabel = tier.label;
    } else {
      price = pricing.public_weekend_price;
      tierLabel = "public rate";
    }
  }
  const total = visitors * price;
  let dep: number;
  if (values.deposit_mode === "waived") dep = 0;
  else if (values.deposit_mode === "custom" && values.deposit_due !== undefined && Number.isFinite(values.deposit_due)) dep = Number(values.deposit_due);
  else dep = Math.min(total, Math.max(deposit.min_people * price, roundHalfUp((visitors * deposit.percent) / 100) * price));
  return { price, total, deposit: dep, tierLabel, estimated: !unchanged || booking.price_overridden !== values.price_override };
}

// ------------------------------------------------------------------ dialog

export interface BookingFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present → edit mode. */
  booking?: BookingDetail | null;
  /** Create mode: prefill the visit date (from the calendar). */
  defaultDate?: string;
  /** Create mode: called with the new booking; defaults to navigating to it. */
  onCreated?: (booking: BookingDetail) => void;
  /** Edit mode: open on the contact fields or with Pricing expanded. */
  focus?: EditFocus;
}

export function BookingFormDialog({ open, onOpenChange, booking = null, defaultDate, onCreated, focus = null }: BookingFormDialogProps) {
  const editing = !!booking;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-section">{editing ? `Edit ${booking.reference}` : "New booking"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changing the date, kind of group or visitors recalculates the price and deposit unless they are overridden."
              : "A group that booked by phone or in person. The price and deposit follow the date and kind of group; the reference is assigned on save."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <BookingForm key={booking?.id ?? `new-${defaultDate ?? ""}`} booking={booking} defaultDate={defaultDate} focus={focus} onClose={() => onOpenChange(false)} onCreated={onCreated} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BookingForm({ booking, defaultDate, focus, onClose, onCreated }: { booking: BookingDetail | null; defaultDate?: string; focus: EditFocus; onClose: () => void; onCreated?: (booking: BookingDetail) => void }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const create = useCreateBooking();
  const update = useUpdateBooking(booking?.id ?? 0);
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: defaultsFor(booking, defaultDate) });
  const [invoiceOpen, setInvoiceOpen] = useState(!!(booking?.billing_address || booking?.customer_vat_number));
  const [pricingOpen, setPricingOpen] = useState(focus === "pricing" || !!(booking?.price_overridden || booking?.deposit_overridden || booking?.deposit_waived));

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

  const watched = form.watch(["visit_date", "group_type", "visitors", "price_override", "price_per_person", "deposit_mode", "deposit_due"]);
  const [visit_date, group_type, visitors, price_override, price_per_person, deposit_mode, deposit_due] = watched;
  const est = useMemo(
    () => estimate(settings.data, { visit_date, group_type, visitors, price_override, price_per_person, deposit_mode, deposit_due }, booking),
    [settings.data, visit_date, group_type, visitors, price_override, price_per_person, deposit_mode, deposit_due, booking],
  );

  async function onSubmit(values: ParsedValues) {
    setError(null);
    const input = toInput(values, !!booking);
    try {
      if (booking) {
        const changes: BookingInput = {};
        for (const key of Object.keys(input) as (keyof BookingInput)[]) {
          const next = input[key];
          const prev = (booking as unknown as Record<string, unknown>)[key] ?? null;
          if (JSON.stringify(next ?? null) !== JSON.stringify(prev)) (changes as Record<string, unknown>)[key] = next;
        }
        // An override needs its flag and reason together even when only one changed.
        if ("price_per_person" in changes || "price_override_reason" in changes) {
          changes.price_overridden = input.price_overridden;
          changes.price_override_reason = input.price_override_reason;
          if (input.price_overridden) changes.price_per_person = input.price_per_person;
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
  const visitorsNum = Number.isFinite(visitors) ? Number(visitors) : 0;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
        <FormError message={error} />

        <Group label="Visit">
          <FieldRow>
            <DateField control={form.control} name="visit_date" label="Visit date" required min={booking ? undefined : todayIso()} />
            <DateField control={form.control} name="alternative_date" label="Alternative date" clearable />
          </FieldRow>
          <div className="grid gap-4 sm:grid-cols-4">
            <NumberField control={form.control} name="visitors" label="Visitors" integer min={1} required />
            <TextField control={form.control} name="arrival_time" label="Arrival time" placeholder="09:30" />
            <NumberField control={form.control} name="vehicles" label="Vehicles" integer min={0} />
            <NumberField control={form.control} name="gazebos" label="Gazebos" integer min={0} max={7} />
          </div>
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
            <TextField control={form.control} name="contact_email" label="Email" type="email" autoComplete="off" placeholder="jane@example.com" description="Needed for the proforma, statement, tax invoice and ticket." />
            <TextField control={form.control} name="contact_mobile" label="Mobile" type="tel" autoComplete="off" placeholder="082 123 4567" description="Needed to WhatsApp the ticket." />
          </FieldRow>
          <Disclosure open={invoiceOpen} onOpenChange={setInvoiceOpen} label="Invoice details" hint="Billing address and VAT number, when the customer needs them on the documents">
            <TextareaField control={form.control} name="billing_address" label="Billing address" rows={3} placeholder={"Hillside Community Church\n12 Main Road\nMitchells Plain 7785"} description="One line per address line. Printed under “Bill to” on every document." />
            <TextField control={form.control} name="customer_vat_number" label="Customer VAT number" placeholder="4123456789" className="sm:max-w-xs" mono />
          </Disclosure>
        </Group>

        <Group label="Pricing">
          <p className="text-body tabular text-foreground" aria-live="polite">
            {est && visitorsNum > 0 ? (
              <>
                {formatNumber(visitorsNum)} × {formatMoney(est.price, { compact: true })} = <span className="font-semibold">{formatMoney(est.total, { compact: true })}</span> · deposit{" "}
                <span className="font-medium">{deposit_mode === "waived" ? "waived" : formatMoney(est.deposit, { compact: true })}</span>
                <span className="text-sm text-muted-foreground"> · {est.tierLabel}{est.estimated ? " · recalculated on save" : ""}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Enter the date, kind of group and visitors to see the price.</span>
            )}
          </p>
          <Disclosure open={pricingOpen} onOpenChange={setPricingOpen} label="Price and deposit overrides" hint="A special price or deposit stays put when the date or numbers change; the reason shows on the booking">
            <SwitchField control={form.control} name="price_override" label="Special price per visitor" description="Instead of the tier price." />
            {price_override ? (
              <FieldRow>
                <MoneyField control={form.control} name="price_per_person" label="Price per visitor" required />
                <TextField control={form.control} name="price_override_reason" label="Reason" required placeholder="e.g. returning school, last year's rate" />
              </FieldRow>
            ) : null}
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
                <MoneyField control={form.control} name="deposit_due" label="Deposit due" required max={est?.total} />
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
            {booking ? "Save changes" : "Create booking"}
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
