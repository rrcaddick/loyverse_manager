import { ArrowDown, ArrowUp, Plus, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray } from "react-hook-form";
import { z } from "zod";

import { EmptyState } from "@/components/empty-state";
import { FieldRow, MoneyField, NumberField, SelectField, SwitchField, TextField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { depositFor, useReplacePriceTiers, useUpdateSection } from "@/features/settings/api";
import { formatMoney, formatNumber, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, code, count, dirtyKeys, money, pick, requiredText, runSave } from "./shared";

const DAY_TYPE_OPTIONS = [
  { value: "weekday", label: "Weekday" },
  { value: "weekend", label: "Weekend & holidays" },
];

const schema = z
  .object({
    pricing: z.object({
      public_weekend_price: money,
      peak_price: money,
      vat_rate: z.number({ error: "Enter the VAT rate" }).min(0).max(100, "A percentage between 0 and 100"),
    }),
    deposit: z.object({
      min_people: count("Enter a number of people"),
      percent: z.number({ error: "Enter a percentage" }).int("Whole percent").min(0).max(100, "A percentage between 0 and 100"),
    }),
    price_tiers: z.array(
      z.object({
        code,
        label: requiredText("Enter a label"),
        day_type: z.enum(["weekday", "weekend"]),
        price: money,
        min_group_size: count("Enter a group size"),
        notes: z.string().trim().max(255, "Keep notes short"),
        is_active: z.boolean(),
        isNew: z.boolean(),
      }),
    ),
  })
  .superRefine((value, ctx) => {
    const seen = new Map<string, number>();
    value.price_tiers.forEach((tier, index) => {
      const first = seen.get(tier.code);
      if (first !== undefined) {
        ctx.addIssue({ code: "custom", path: ["price_tiers", index, "code"], message: `Duplicate of row ${first + 1}` });
      } else {
        seen.set(tier.code, index);
      }
    });
  });

type FormValues = z.input<typeof schema>;

export default function PricingTab({ data }: SettingsTabProps) {
  const savePricing = useUpdateSection("pricing");
  const saveDeposit = useUpdateSection("deposit");
  const saveTiers = useReplacePriceTiers();
  const [error, setError] = useState<string | null>(null);

  const form = useZodForm({
    schema,
    defaultValues: {
      pricing: data.settings.pricing,
      deposit: data.settings.deposit,
      price_tiers: data.price_tiers.map((t) => ({
        code: t.code,
        label: t.label,
        day_type: t.day_type,
        price: Number(t.price),
        min_group_size: t.min_group_size ?? 0,
        notes: t.notes ?? "",
        is_active: !!t.is_active,
        isNew: false,
      })),
    },
  });
  const tiers = useFieldArray({ control: form.control, name: "price_tiers" });
  const deposit = form.watch("deposit");

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
          values.price_tiers = saved.price_tiers.map((t) => ({
            code: t.code,
            label: t.label,
            day_type: t.day_type,
            price: Number(t.price),
            min_group_size: t.min_group_size ?? 0,
            notes: t.notes ?? "",
            is_active: !!t.is_active,
            isNew: false,
          }));
        }
        form.reset(values as FormValues);
      }),
    );
  }

  const saving = savePricing.isPending || saveDeposit.isPending || saveTiers.isPending;

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={saving} error={error}>
      <Section title="Public prices" description="What a visitor pays at the gate. Groups fall back to these when no tier applies.">
        <div className="grid gap-5 sm:grid-cols-3">
          <MoneyField control={form.control} name="pricing.public_weekend_price" label="Public weekend" description="Per person, incl. VAT" />
          <MoneyField control={form.control} name="pricing.peak_price" label="Peak day" description="Christmas, New Year and other peak days" />
          <NumberField control={form.control} name="pricing.vat_rate" label="VAT rate" suffix="%" min={0} max={100} description="Shown on proformas and invoices" />
        </div>
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

      <Section
        title="Price tiers"
        description="Per-person prices by group type and day. Tiers are matched by code; a tier that bookings refer to should be deactivated, not deleted."
        flush
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => tiers.append({ code: "", label: "", day_type: "weekday", price: Number.NaN, min_group_size: 0, notes: "", is_active: true, isNew: true })}
          >
            <Plus data-icon="inline-start" />
            Add tier
          </Button>
        }
      >
        {tiers.fields.length === 0 ? (
          <EmptyState compact icon={Tags} title="No price tiers" description="Add the group tiers from the price policy." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[76rem] table-fixed text-sm">
              <thead className="text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <tr className="border-b border-border">
                  <th scope="col" className="w-16 px-3 py-2 pl-5">Order</th>
                  <th scope="col" className="w-56 px-3 py-2">Code</th>
                  <th scope="col" className="px-3 py-2">Label</th>
                  <th scope="col" className="w-40 px-3 py-2">Day type</th>
                  <th scope="col" className="w-28 px-3 py-2">Price</th>
                  <th scope="col" className="w-24 px-3 py-2">Min size</th>
                  <th scope="col" className="w-48 px-3 py-2">Notes</th>
                  <th scope="col" className="w-16 px-3 py-2">Active</th>
                  <th scope="col" className="w-12 px-2 py-2 pr-5">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tiers.fields.map((field, index) => {
                  const isNew = form.watch(`price_tiers.${index}.isNew`);
                  const active = form.watch(`price_tiers.${index}.is_active`);
                  const label = form.watch(`price_tiers.${index}.label`) || `row ${index + 1}`;
                  return (
                    <tr key={field.id} className={cn("align-top", !active && "bg-muted/30 text-muted-foreground")}>
                      <td className="px-3 py-2 pl-5">
                        <div className="flex gap-0.5">
                          <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => tiers.move(index, index - 1)} aria-label={`Move ${label} up`}>
                            <ArrowUp />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-xs" disabled={index === tiers.fields.length - 1} onClick={() => tiers.move(index, index + 1)} aria-label={`Move ${label} down`}>
                            <ArrowDown />
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <TextField control={form.control} name={`price_tiers.${index}.code`} label={`Code for ${label}`} hideLabel mono disabled={!isNew} placeholder="school_weekday" />
                      </td>
                      <td className="px-3 py-2">
                        <TextField control={form.control} name={`price_tiers.${index}.label`} label={`Label for ${label}`} hideLabel placeholder="Schools & children's groups" />
                      </td>
                      <td className="px-3 py-2">
                        <SelectField control={form.control} name={`price_tiers.${index}.day_type`} label={`Day type for ${label}`} hideLabel options={DAY_TYPE_OPTIONS} />
                      </td>
                      <td className="px-3 py-2">
                        <MoneyField control={form.control} name={`price_tiers.${index}.price`} label={`Price for ${label}`} hideLabel />
                      </td>
                      <td className="px-3 py-2">
                        <NumberField control={form.control} name={`price_tiers.${index}.min_group_size`} label={`Minimum group size for ${label}`} hideLabel integer min={0} />
                      </td>
                      <td className="px-3 py-2">
                        <TextField control={form.control} name={`price_tiers.${index}.notes`} label={`Notes for ${label}`} hideLabel placeholder="incl. teachers" />
                      </td>
                      <td className="px-3 py-2">
                        <SwitchField control={form.control} name={`price_tiers.${index}.is_active`} label={<span className="sr-only">Active for {label}</span>} boxed={false} className="h-8 items-center" />
                      </td>
                      <td className="px-3 py-2 pr-5">
                        {isNew ? (
                          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => tiers.remove(index)} aria-label={`Remove ${label}`}>
                            <Trash2 />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
