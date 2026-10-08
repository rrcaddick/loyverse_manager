/**
 * Settings › Public › Booking form: the intro line, the limits, the
 * arrival-time slots, the group types with their price tiers, and the one
 * automatic email — the acknowledgement toggle (off by default; spec §11).
 * "Preview the public form" opens /request/visit in a new tab.
 *
 * The form section's v2 keys (max_group_size, arrival_slots,
 * acknowledgement_enabled) are not yet in types/api.ts; FormSettingsV2
 * below is the local view until the shared type catches up.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Clock, ExternalLink, ListPlus, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useFieldArray } from "react-hook-form";
import { z } from "zod";

import { EmptyState } from "@/components/empty-state";
import { FieldRow, NumberField, SelectField, SwitchField, TextField, TextareaField, useZodForm, type SelectOption } from "@/components/form";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import type { FormSettings, Settings, SettingsResponse } from "@/types/api";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, code, count, requiredText, runSave } from "./shared";

export interface FormSettingsV2 extends FormSettings {
  max_group_size: number;
  arrival_slots: string[];
  acknowledgement_enabled: boolean;
}

/** The literal the public form offers beside the times (public_form.DEFAULT_ARRIVAL_SLOTS). */
const NOT_SURE = "Not sure yet";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_TIMES = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00"];

const schema = z
  .object({
    intro: z.string().trim().max(400, "Keep the introduction to a sentence or two"),
    min_group_size: count("Enter a group size").min(1, "At least 1"),
    max_group_size: count("Enter a group size").min(1, "At least 1"),
    max_questions: count("Enter a number").max(20, "Up to 20"),
    arrival_times: z.array(z.object({ time: z.string().trim().regex(TIME, "Enter a time as HH:MM, for example 09:30") })),
    offer_not_sure: z.boolean(),
    acknowledgement_enabled: z.boolean(),
    group_types: z.array(
      z.object({
        code,
        label: requiredText("Enter a label"),
        weekday_tier: requiredText("Choose a weekday tier"),
        weekend_tier: requiredText("Choose a weekend tier"),
      }),
    ),
  })
  .superRefine((value, ctx) => {
    if (value.max_group_size < value.min_group_size) {
      ctx.addIssue({ code: "custom", path: ["max_group_size"], message: "Must be at least the minimum group size" });
    }
    const seenTimes = new Map<string, number>();
    value.arrival_times.forEach((slot, index) => {
      const first = seenTimes.get(slot.time);
      if (first !== undefined) ctx.addIssue({ code: "custom", path: ["arrival_times", index, "time"], message: `Already listed (row ${first + 1})` });
      else seenTimes.set(slot.time, index);
    });
    const seen = new Map<string, number>();
    value.group_types.forEach((g, index) => {
      const first = seen.get(g.code);
      if (first !== undefined) ctx.addIssue({ code: "custom", path: ["group_types", index, "code"], message: `Duplicate of row ${first + 1}` });
      else seen.set(g.code, index);
    });
  });

type FormValues = z.input<typeof schema>;

function useSaveFormSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<FormSettingsV2>) => api.put<{ settings: Settings }>("/settings/form", data),
    meta: { silent: true },
    onSuccess: ({ settings }) => {
      queryClient.setQueryData<SettingsResponse>(queryKeys.settings, (current) => (current ? { ...current, settings } : current));
    },
  });
}

function toValues(settings: FormSettingsV2): FormValues {
  const slots = Array.isArray(settings.arrival_slots) ? settings.arrival_slots : [];
  const times = slots.filter((s) => s !== NOT_SURE);
  return {
    intro: settings.intro ?? "",
    min_group_size: settings.min_group_size,
    max_group_size: settings.max_group_size ?? 900,
    max_questions: settings.max_questions,
    arrival_times: times.map((time) => ({ time })),
    offer_not_sure: slots.includes(NOT_SURE) || slots.length === 0,
    acknowledgement_enabled: !!settings.acknowledgement_enabled,
    group_types: settings.group_types,
  };
}

function toSettings(values: z.output<typeof schema>): FormSettingsV2 {
  return {
    intro: values.intro,
    min_group_size: values.min_group_size,
    max_group_size: values.max_group_size,
    max_questions: values.max_questions,
    arrival_slots: [...values.arrival_times.map((t) => t.time), ...(values.offer_not_sure ? [NOT_SURE] : [])],
    acknowledgement_enabled: values.acknowledgement_enabled,
    group_types: values.group_types,
  };
}

/** Half an hour after the last slot (09:00 when the list is empty), capped at 23:30. */
function nextTime(existing: { time: string }[]): string {
  const last = existing.map((t) => t.time).filter((t) => TIME.test(t)).sort().at(-1);
  if (!last) return DEFAULT_TIMES[0]!;
  const [h = 9, m = 0] = last.split(":").map(Number);
  const minutes = Math.min(h * 60 + m + 30, 23 * 60 + 30);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export default function FormTab({ data }: SettingsTabProps) {
  const save = useSaveFormSettings();
  const [error, setError] = useState<string | null>(null);
  const original = data.settings.form as FormSettingsV2;
  const form = useZodForm({ schema, defaultValues: toValues(original) });
  const groupTypes = useFieldArray({ control: form.control, name: "group_types" });
  const times = useFieldArray({ control: form.control, name: "arrival_times" });

  const priceTiers = data.price_tiers;
  const tierOptions = useMemo(() => {
    const toOption = (t: (typeof priceTiers)[number]): SelectOption => ({
      value: t.code,
      label: (
        <span className="flex items-baseline gap-2">
          <span>{t.label}</span>
          <span className="text-xs text-muted-foreground tabular">{formatMoney(t.price, { compact: true })}</span>
        </span>
      ),
      disabled: !t.is_active,
    });
    return {
      weekday: priceTiers.filter((t) => t.day_type === "weekday").map(toOption),
      weekend: priceTiers.filter((t) => t.day_type === "weekend").map(toOption),
    };
  }, [priceTiers]);

  async function onSubmit(values: z.output<typeof schema>) {
    const next = toSettings(values);
    const payload: Partial<FormSettingsV2> = {};
    for (const key of Object.keys(next) as (keyof FormSettingsV2)[]) {
      if (JSON.stringify(next[key]) !== JSON.stringify(original[key])) (payload as Record<string, unknown>)[key] = next[key];
    }
    setError(
      await runSave(async () => {
        if (Object.keys(payload).length) {
          const { settings } = await save.mutateAsync(payload);
          form.reset(toValues(settings.form as FormSettingsV2));
        } else {
          form.reset(values as FormValues);
        }
      }),
    );
  }

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section
        title="Introduction"
        description="The sentence under the first question on the public form. Keep it to what happens next: a proforma by email, nothing paid now."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href="/request/visit" target="_blank" rel="noopener">
              <ExternalLink data-icon="inline-start" aria-hidden="true" />
              Preview the public form
            </a>
          </Button>
        }
      >
        <TextareaField control={form.control} name="intro" label="Intro text" hideLabel rows={3} maxLength={400} />
      </Section>

      <Section title="Limits" description="What the public form accepts. Smaller parties are pointed to day tickets on Quicket; larger ones are asked to phone.">
        <div className="flex flex-col gap-5">
          <FieldRow>
            <NumberField control={form.control} name="min_group_size" label="Minimum group size" suffix="people" integer min={1} />
            <NumberField control={form.control} name="max_group_size" label="Maximum group size" suffix="people" integer min={1} description="Above this the form asks the group to phone us." />
          </FieldRow>
          <NumberField control={form.control} name="max_questions" label="Questions per request" suffix="questions" integer min={0} max={20} description="Free-text questions the group can ask up front; we answer them in writing." className="sm:max-w-xs" />
        </div>
      </Section>

      <Section
        title="Arrival times"
        description="The choices in the form's 'Arrival time' list, in this order. 'Not sure yet' is offered last so nobody has to guess."
        flush
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => times.append({ time: nextTime(form.getValues("arrival_times")) })}>
            <Plus data-icon="inline-start" />
            Add a time
          </Button>
        }
      >
        {times.fields.length === 0 ? (
          <EmptyState compact icon={Clock} title="No times listed" description="Add the half-hour slots the gate can take; the form will still offer 'Not sure yet'." />
        ) : (
          <ul className="divide-y divide-border">
            {times.fields.map((field, index) => (
              <li key={field.id} className="flex items-start gap-3 px-5 py-2.5">
                <div className="flex gap-0.5 pt-1">
                  <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => times.move(index, index - 1)} aria-label={`Move time ${index + 1} up`}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={index === times.fields.length - 1} onClick={() => times.move(index, index + 1)} aria-label={`Move time ${index + 1} down`}>
                    <ArrowDown />
                  </Button>
                </div>
                <FormField
                  control={form.control}
                  name={`arrival_times.${index}.time`}
                  render={({ field: f }) => (
                    <FormItem className="w-36">
                      <FormLabel className="sr-only">Time {index + 1}</FormLabel>
                      <FormControl>
                        <Input {...f} type="time" step={1800} className="tabular" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="button" variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => times.remove(index)} aria-label={`Remove time ${index + 1}`}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border px-5 py-4">
          <SwitchField control={form.control} name="offer_not_sure" label={`Offer "${NOT_SURE}"`} description="Listed after the times. Most groups pick it; the arrival time is confirmed with the final details." boxed={false} />
        </div>
      </Section>

      <Section
        title="Group types"
        description="The options in the form's 'Kind of group' question, and the price tier each one starts on. The day type is decided from the visit date."
        flush
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => groupTypes.append({ code: "", label: "", weekday_tier: "", weekend_tier: "" })}>
            <Plus data-icon="inline-start" />
            Add group type
          </Button>
        }
      >
        {groupTypes.fields.length === 0 ? (
          <EmptyState compact icon={ListPlus} title="No group types" description="Add at least one so the form has something to offer." />
        ) : (
          <ul className="divide-y divide-border">
            {groupTypes.fields.map((field, index) => {
              const label = form.watch(`group_types.${index}.label`) || `row ${index + 1}`;
              return (
                <li key={field.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-3 px-5 py-4">
                  <div className="flex gap-0.5 pt-1">
                    <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => groupTypes.move(index, index - 1)} aria-label={`Move ${label} up`}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" disabled={index === groupTypes.fields.length - 1} onClick={() => groupTypes.move(index, index + 1)} aria-label={`Move ${label} down`}>
                      <ArrowDown />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
                    <TextField control={form.control} name={`group_types.${index}.code`} label={`Code for ${label}`} hideLabel mono placeholder="school" />
                    <TextField control={form.control} name={`group_types.${index}.label`} label={`Label for ${label}`} hideLabel placeholder="School" />
                  </div>
                  <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => groupTypes.remove(index)} aria-label={`Remove ${label}`}>
                    <Trash2 />
                  </Button>
                  <div className="col-start-2 grid gap-3 sm:grid-cols-2">
                    <SelectField control={form.control} name={`group_types.${index}.weekday_tier`} label="Weekday tier" options={tierOptions.weekday} placeholder="Choose a tier" />
                    <SelectField control={form.control} name={`group_types.${index}.weekend_tier`} label="Weekend tier" options={tierOptions.weekend} placeholder="Choose a tier" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Acknowledgement" description="The one email that can go out without anyone pressing a button. Everything else — proforma, reminders, tickets — is sent from the booking by hand.">
        <SwitchField
          control={form.control}
          name="acknowledgement_enabled"
          label="Email an acknowledgement when a request arrives"
          description="When on, every new request gets an immediate email with its reference and a copy of the answers, and the confirmation page says so. When off (the default), nothing is sent until you act on the request in Work."
        />
      </Section>
    </SettingsForm>
  );
}
