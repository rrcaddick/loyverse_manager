/**
 * Settings › Pricing: the rates, the group minimum, VAT and the deposit rule.
 *
 * There are three group rates and the public and peak prices
 * (src/services/pricing.py). Which one a booking gets follows the date, the
 * kind of group and the headcount; the prices themselves are set here.
 */

import { useState } from "react";
import { useFieldArray } from "react-hook-form";
import { z } from "zod";

import { FieldRow, MoneyField, NumberField, SwitchField, TextField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { depositFor, useReplacePriceTiers, useUpdateSection } from "@/features/settings/api";
import { formatMoney, formatNumber, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, count, dirtyKeys, money, pick, runSave } from "./shared";

/** What each rate is for, in the office's words; the label is editable, this is not. */
const RATE_RULES: Record<string, string> = {
  children_weekday: "Schools, crèches, aftercare and youth clubs on a weekday in term time.",
  group_weekday: "Any other group on a weekday in term time; parents joining a school group pay this too.",
  group_weekend: "Groups on a weekend or a school-holiday weekday.",
  public_weekend: "The gate and online price: public holidays, and any group under the minimum.",
  peak: "The public price on the peak days marked on the Season tab.",
};

const schema = z.object({
  pricing: z.object({
    vat_rate: z.number({ error: "Enter the VAT rate" }).min(0).max(100, "A percentage between 0 and 100"),
    group_minimum: count("Enter a number of people").min(1, "At least 1"),
  }),
  deposit: z.object({
    min_people: count("Enter a number of people"),
    percent: z.number({ error: "Enter a percentage" }).int("Whole percent").min(0).max(100, "A percentage between 0 and 100"),
  }),
  price_tiers: z.array(
    z.object({
      code: z.string(),
      label: z.string().trim().min(1, "Enter a label"),
      day_type: z.enum(["weekday", "weekend"]),
      price: money,
      min_group_size: z.number(),
      notes: z.string().trim().max(255, "Keep notes short"),
      is_active: z.boolean(),
    }),
  ),
});

type FormValues = z.input<typeof schema>;

export default function PricingTab({ data }: SettingsTabProps) {
  const savePricing = useUpdateSection("pricing");
  const saveDeposit = useUpdateSection("deposit");
  const saveTiers = useReplacePriceTiers();
  const [error, setError] = useState<string | null>(null);

  const toTierValues = (tiers: SettingsTabProps["data"]["price_tiers"]) =>
    tiers.map((t) => ({
      code: t.code,
      label: t.label,
      day_type: t.day_type,
      price: Number(t.price),
      min_group_size: t.min_group_size ?? 0,
      notes: t.notes ?? "",
      is_active: !!t.is_active,
    }));

  const form = useZodForm({
    schema,
    defaultValues: {
      pricing: { vat_rate: data.settings.pricing.vat_rate, group_minimum: data.settings.pricing.group_minimum ?? 40 },
      deposit: data.settings.deposit,
      price_tiers: toTierValues(data.price_tiers),
    },
  });
  const tiers = useFieldArray({ control: form.control, name: "price_tiers" });
  const deposit = form.watch("deposit");
  const minimum = form.watch("pricing.group_minimum");

  async function onSubmit(values: z.output<typeof schema>) {
    const dirty = form.formState.dirtyFields;
    setError(
      await runSave(async () => {
        const pricingKeys = dirtyKeys(values.pricing, dirty.pricing);
        if (pricingKeys.length) await savePricing.mutateAsync(pick(values.pricing, pricingKeys));
        const depositKeys = dirtyKeys(values.deposit, dirty.deposit);
        if (depositKeys.length) await saveDeposit.mutateAsync(pick(values.deposit, depositKeys));
        if (dirty.price_tiers) {
          const saved = await saveTiers.mutateAsync(
            values.price_tiers.map((t, index) => ({
              code: t.code,
              label: t.label,
              day_type: t.day_type,
              price: t.price,
              min_group_size: t.min_group_size,
              notes: t.notes || null,
              sort_order: index * 10,
              is_active: t.is_active,
            })),
          );
          values.price_tiers = toTierValues(saved.price_tiers);
        }
        form.reset(values as FormValues);
      }),
    );
  }

  const saving = savePricing.isPending || saveDeposit.isPending || saveTiers.isPending;

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={saving} error={error}>
      <Section title="Rates" description="Per visitor, VAT included. A booking's rate follows the date, the kind of group and the headcount; an agreed price below it is recorded as a discount." flush>
        <ul className="divide-y divide-border">
          {tiers.fields.map((field, index) => {
            const active = form.watch(`price_tiers.${index}.is_active`);
            const label = form.watch(`price_tiers.${index}.label`) || field.code;
            return (
              <li key={field.id} className={cn("grid gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_6.5rem_auto]", !active && "text-muted-foreground")}>
                <div className="min-w-0">
                  <TextField control={form.control} name={`price_tiers.${index}.label`} label={`Label for ${label}`} hideLabel />
                  <p className="mt-1.5 text-sm text-muted-foreground">{RATE_RULES[field.code] ?? field.code}</p>
                </div>
                <MoneyField control={form.control} name={`price_tiers.${index}.price`} label={`Price for ${label}`} hideLabel />
                <SwitchField control={form.control} name={`price_tiers.${index}.is_active`} label={<span className="sr-only">Active for {label}</span>} boxed={false} className="h-9 items-center" />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Group minimum and VAT" description="Fewer people than the minimum is not a group booking: the public rate applies. On a term-time weekday the minimum is waived when another group has already booked that day, since the park opens for them anyway.">
        <FieldRow>
          <NumberField control={form.control} name="pricing.group_minimum" label="Group minimum" suffix="people" integer min={1} description={`Under ${formatNumber(Number(minimum) || 0)} people pays the public rate.`} />
          <NumberField control={form.control} name="pricing.vat_rate" label="VAT rate" suffix="%" min={0} max={100} description="Shown on proformas and invoices." />
        </FieldRow>
      </Section>

      <Section title="Deposit" description="The deposit secures the date. It is the larger of a minimum head count and a percentage of the group, never more than the total.">
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
          <FieldRow>
            <NumberField control={form.control} name="deposit.min_people" label="Minimum people" suffix="people" integer min={0} description="Charged even for smaller groups" />
            <NumberField control={form.control} name="deposit.percent" label="Percentage of the group" suffix="%" integer min={0} max={100} description="Rounded to whole people before pricing" />
          </FieldRow>
          <DepositExample minPeople={Number(deposit.min_people) || 0} percent={Number(deposit.percent) || 0} />
        </div>
      </Section>
    </SettingsForm>
  );
}

/** Interactive worked example so the two deposit numbers are never abstract. */
function DepositExample({ minPeople, percent }: { minPeople: number; percent: number }) {
  const [people, setPeople] = useState(80);
  const [price, setPrice] = useState(95);
  const byMin = minPeople * price;
  const percentPeople = Math.round((people * percent) / 100);
  const byPercent = percentPeople * price;
  const total = people * price;
  const result = depositFor(people, price, minPeople, percent);
  const rule = result === total && total < Math.max(byMin, byPercent) ? "total" : byMin >= byPercent ? "min" : "percent";

  return (
    <aside className="rounded-lg border border-border bg-muted/40 p-4 text-sm" aria-live="polite">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Worked example</h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="example-people" className="text-xs">People</Label>
          <Input id="example-people" type="number" inputMode="numeric" min={1} value={people} onChange={(e) => setPeople(Math.max(0, Number(e.target.value)))} className="h-7 tabular" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="example-price" className="text-xs">Price per person</Label>
          <Input id="example-price" type="number" inputMode="decimal" min={0} step={1} value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))} className="h-7 tabular" />
        </div>
      </div>
      <p className="mt-4 text-base font-semibold tabular">
        {pluralise(people, "person", "people")} at {formatMoney(price, { compact: true })} → deposit {formatMoney(result, { compact: true })}
      </p>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground tabular">
        <li className={cn(rule === "min" && "text-foreground")}>
          Minimum: {formatNumber(minPeople)} × {formatMoney(price, { compact: true })} = {formatMoney(byMin, { compact: true })}
        </li>
        <li className={cn(rule === "percent" && "text-foreground")}>
          {percent}% of {formatNumber(people)} = {formatNumber(percentPeople)} people × {formatMoney(price, { compact: true })} = {formatMoney(byPercent, { compact: true })}
        </li>
        <li className={cn(rule === "total" && "text-foreground")}>Never more than the total of {formatMoney(total, { compact: true })}</li>
      </ul>
    </aside>
  );
}
