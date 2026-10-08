import { ArrowDown, ArrowUp, ListPlus, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useFieldArray } from "react-hook-form";
import { z } from "zod";

import { EmptyState } from "@/components/empty-state";
import { FieldRow, NumberField, SelectField, TextField, TextareaField, useZodForm, type SelectOption } from "@/components/form";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { useUpdateSection } from "@/features/settings/api";
import { formatMoney } from "@/lib/format";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, code, count, dirtyKeys, pick, requiredText, runSave } from "./shared";

const schema = z
  .object({
    form: z.object({
      intro: z.string().trim().max(400, "Keep the introduction to a sentence or two"),
      min_group_size: count("Enter a group size").min(1, "At least 1"),
      max_questions: count("Enter a number").max(20, "Up to 20"),
      group_types: z.array(
        z.object({
          code,
          label: requiredText("Enter a label"),
          weekday_tier: requiredText("Choose a weekday tier"),
          weekend_tier: requiredText("Choose a weekend tier"),
        }),
      ),
    }),
  })
  .superRefine((value, ctx) => {
    const seen = new Map<string, number>();
    value.form.group_types.forEach((g, index) => {
      const first = seen.get(g.code);
      if (first !== undefined) {
        ctx.addIssue({ code: "custom", path: ["form", "group_types", index, "code"], message: `Duplicate of row ${first + 1}` });
      } else {
        seen.set(g.code, index);
      }
    });
  });

type FormValues = z.input<typeof schema>;

export default function FormTab({ data }: SettingsTabProps) {
  const save = useUpdateSection("form");
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: { form: data.settings.form } });
  const groupTypes = useFieldArray({ control: form.control, name: "form.group_types" });

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
    const keys = dirtyKeys(values.form, form.formState.dirtyFields.form);
    setError(
      await runSave(async () => {
        if (keys.length) await save.mutateAsync(pick(values.form, keys));
        form.reset(values as FormValues);
      }),
    );
  }

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section title="Introduction" description="The first thing a visitor reads on the public booking form.">
        <TextareaField control={form.control} name="form.intro" label="Intro text" hideLabel rows={3} maxLength={400} />
      </Section>

      <Section title="Limits" description="What the public form accepts.">
        <FieldRow>
          <NumberField control={form.control} name="form.min_group_size" label="Minimum group size" suffix="people" integer min={1} description="Smaller parties are pointed to normal day tickets." />
          <NumberField control={form.control} name="form.max_questions" label="Questions per request" suffix="questions" integer min={0} max={20} description="Free-text questions the group can ask up front." />
        </FieldRow>
      </Section>

      <Section
        title="Group types"
        description="The options in the form's 'What kind of group?' question, and the price tier each one starts on. The day type is decided from the visit date."
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] table-fixed text-sm">
              <thead className="text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <tr className="border-b border-border">
                  <th scope="col" className="w-16 px-3 py-2 pl-5">Order</th>
                  <th scope="col" className="w-40 px-3 py-2">Code</th>
                  <th scope="col" className="px-3 py-2">Label</th>
                  <th scope="col" className="w-56 px-3 py-2">Weekday tier</th>
                  <th scope="col" className="w-56 px-3 py-2">Weekend tier</th>
                  <th scope="col" className="w-12 px-3 py-2 pr-5">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groupTypes.fields.map((field, index) => {
                  const label = form.watch(`form.group_types.${index}.label`) || `row ${index + 1}`;
                  return (
                    <tr key={field.id} className="align-top">
                      <td className="px-3 py-2 pl-5">
                        <div className="flex gap-0.5">
                          <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => groupTypes.move(index, index - 1)} aria-label={`Move ${label} up`}>
                            <ArrowUp />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-xs" disabled={index === groupTypes.fields.length - 1} onClick={() => groupTypes.move(index, index + 1)} aria-label={`Move ${label} down`}>
                            <ArrowDown />
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <TextField control={form.control} name={`form.group_types.${index}.code`} label={`Code for ${label}`} hideLabel mono placeholder="school" />
                      </td>
                      <td className="px-3 py-2">
                        <TextField control={form.control} name={`form.group_types.${index}.label`} label={`Label for ${label}`} hideLabel placeholder="School" />
                      </td>
                      <td className="px-3 py-2">
                        <SelectField control={form.control} name={`form.group_types.${index}.weekday_tier`} label={`Weekday tier for ${label}`} hideLabel options={tierOptions.weekday} placeholder="Choose a tier" />
                      </td>
                      <td className="px-3 py-2">
                        <SelectField control={form.control} name={`form.group_types.${index}.weekend_tier`} label={`Weekend tier for ${label}`} hideLabel options={tierOptions.weekend} placeholder="Choose a tier" />
                      </td>
                      <td className="px-3 py-2 pr-5">
                        <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => groupTypes.remove(index)} aria-label={`Remove ${label}`}>
                          <Trash2 />
                        </Button>
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
