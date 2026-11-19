/**
 * Settings › Public › Booking form: the intro line, the limits, the group
 * types, and the one automatic email — the acknowledgement toggle (off by
 * default; spec §11). "Preview the public form" opens /request/visit in a
 * new tab.
 *
 * Group types are information. The one thing a type decides is whether the
 * children's rate applies on a term-time weekday (src/services/pricing.py).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, ListPlus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray } from "react-hook-form";
import { z } from "zod";

import { EmptyState } from "@/components/empty-state";
import { FieldRow, NumberField, SwitchField, TextField, TextareaField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import type { FormSettings, Settings, SettingsResponse } from "@/types/api";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, code, count, requiredText, runSave } from "./shared";

export interface FormSettingsV2 extends FormSettings {
  max_group_size: number;
  acknowledgement_enabled: boolean;
}

const schema = z
  .object({
    intro: z.string().trim().max(400, "Keep the introduction to a sentence or two"),
    min_group_size: count("Enter a group size").min(1, "At least 1"),
    max_group_size: count("Enter a group size").min(1, "At least 1"),
    max_questions: count("Enter a number").max(20, "Up to 20"),
    acknowledgement_enabled: z.boolean(),
    group_types: z.array(
      z.object({
        code,
        label: requiredText("Enter a label"),
        children: z.boolean(),
      }),
    ),
  })
  .superRefine((value, ctx) => {
    if (value.max_group_size < value.min_group_size) {
      ctx.addIssue({ code: "custom", path: ["max_group_size"], message: "Must be at least the minimum group size" });
    }
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
  return {
    intro: settings.intro ?? "",
    min_group_size: settings.min_group_size,
    max_group_size: settings.max_group_size ?? 900,
    max_questions: settings.max_questions,
    acknowledgement_enabled: !!settings.acknowledgement_enabled,
    group_types: settings.group_types.map((g) => ({ code: g.code, label: g.label, children: !!g.children })),
  };
}

function toSettings(values: z.output<typeof schema>): FormSettingsV2 {
  return {
    intro: values.intro,
    min_group_size: values.min_group_size,
    max_group_size: values.max_group_size,
    max_questions: values.max_questions,
    acknowledgement_enabled: values.acknowledgement_enabled,
    group_types: values.group_types,
  };
}

export default function FormTab({ data }: SettingsTabProps) {
  const save = useSaveFormSettings();
  const [error, setError] = useState<string | null>(null);
  const original = data.settings.form as FormSettingsV2;
  const form = useZodForm({ schema, defaultValues: toValues(original) });
  const groupTypes = useFieldArray({ control: form.control, name: "group_types" });

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
        title="Group types"
        description="The options in the form's 'Kind of group' question. A children's group gets the children's rate on a term-time weekday; every other rate follows the date and the group's size."
        flush
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => groupTypes.append({ code: "", label: "", children: false })}>
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
                <li key={field.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-x-3 px-5 py-3">
                  <div className="flex gap-0.5 pt-1">
                    <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => groupTypes.move(index, index - 1)} aria-label={`Move ${label} up`}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" disabled={index === groupTypes.fields.length - 1} onClick={() => groupTypes.move(index, index + 1)} aria-label={`Move ${label} down`}>
                      <ArrowDown />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                    <TextField control={form.control} name={`group_types.${index}.code`} label={`Code for ${label}`} hideLabel mono placeholder="school" />
                    <TextField control={form.control} name={`group_types.${index}.label`} label={`Label for ${label}`} hideLabel placeholder="School" />
                  </div>
                  <SwitchField control={form.control} name={`group_types.${index}.children`} label="Children's group" boxed={false} className="h-9 items-center whitespace-nowrap" />
                  <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => groupTypes.remove(index)} aria-label={`Remove ${label}`}>
                    <Trash2 />
                  </Button>
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
