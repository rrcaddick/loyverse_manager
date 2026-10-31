import { useState } from "react";
import { z } from "zod";

import { FieldRow, NumberField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { useUpdateSection } from "@/features/settings/api";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, count, dirtyKeys, pick, runSave } from "./shared";

const schema = z
  .object({
    capacity: z.object({
      capacity: count("Enter the number of people").min(1, "At least 1"),
      over_threshold: count("Enter the number of people").min(1, "At least 1"),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.capacity.over_threshold > value.capacity.capacity) {
      ctx.addIssue({ code: "custom", path: ["capacity", "over_threshold"], message: "Cannot be above the capacity" });
    }
  });

export default function CapacityTab({ data }: SettingsTabProps) {
  const save = useUpdateSection("capacity");
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: { capacity: data.settings.capacity } });

  async function onSubmit(values: z.output<typeof schema>) {
    setError(
      await runSave(async () => {
        const keys = dirtyKeys(values.capacity, form.formState.dirtyFields.capacity);
        if (keys.length) await save.mutateAsync(pick(values.capacity, keys));
        form.reset(values);
      }),
    );
  }

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section title="Capacity" description="The bar in each calendar day shows the people booked against this number.">
        <FieldRow>
          <NumberField control={form.control} name="capacity.capacity" label="People a day" suffix="people" integer min={1} />
          <NumberField control={form.control} name="capacity.over_threshold" label="Show OVER from" suffix="people" integer min={1} description="A day with this many people booked is marked OVER on the calendar and on Today." />
        </FieldRow>
      </Section>
    </SettingsForm>
  );
}
