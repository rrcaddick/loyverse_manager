/**
 * /request/visit — Step 1 of 3, "When would you like to come?": preferred
 * date, alternative date, how many visitors, arrival time
 * (docs/redesign-spec.md §11, docs/research/06).
 */

import { useMemo } from "react";
import { Controller } from "react-hook-form";
import { useNavigate } from "react-router";

import { ConfigGate } from "@/features/public/config-gate";
import { DateField } from "@/features/public/date-field";
import { openingSentence } from "@/features/public/dates";
import { Field, SelectInput, TextInput } from "@/features/public/fields";
import { visitSchema } from "@/features/public/schema";
import { INTRO_LINE, StepShell } from "@/features/public/step-shell";
import { useStepForm } from "@/features/public/use-step-form";
import type { FormConfig } from "@/features/public/types";

const FIELDS = ["visit_date", "alternative_date", "visitors", "arrival_time"] as const;

export default function RequestVisitPage() {
  return <ConfigGate>{(config) => <VisitStep config={config} />}</ConfigGate>;
}

function VisitStep({ config }: { config: FormConfig }) {
  const navigate = useNavigate();
  const schema = useMemo(() => visitSchema(config), [config]);
  const { form, summaryRef, headingRef, summaryErrors, focusSummary } = useStepForm({ schema, fields: [...FIELDS] });
  const {
    register,
    control,
    formState: { errors },
  } = form;
  const onSubmit = form.handleSubmit(() => navigate("/request/group"), focusSummary);

  return (
    <StepShell step={1} title="When would you like to come?" intro={INTRO_LINE} errors={summaryErrors} summaryRef={summaryRef} headingRef={headingRef} onSubmit={onSubmit}>
      <Controller
        name="visit_date"
        control={control}
        render={({ field }) => (
          <DateField
            id="visit_date"
            label="Preferred date"
            hint={`We are open ${openingSentence(config)}. Type the date as dd/mm/yyyy or choose it from the calendar.`}
            error={errors.visit_date?.message}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            config={config}
          />
        )}
      />
      <Controller
        name="alternative_date"
        control={control}
        render={({ field }) => (
          <DateField
            id="alternative_date"
            label="Alternative date"
            optional
            hint="If your first choice is full we will offer this one instead."
            error={errors.alternative_date?.message}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            config={config}
          />
        )}
      />
      <Field id="visitors" label="How many visitors?" hint="Adults and children together. A rough number is fine; we count on the day." error={errors.visitors?.message}>
        {(a11y) => <TextInput {...a11y} inputMode="numeric" autoComplete="off" className="max-w-[8rem] tabular" {...register("visitors")} />}
      </Field>
      <Field id="arrival_time" label="Arrival time" optional hint="The gates open at 09:00. You can change this later." error={errors.arrival_time?.message}>
        {(a11y) => (
          <SelectInput {...a11y} className="max-w-[16rem]" {...register("arrival_time")}>
            <option value="">Choose a time</option>
            {config.arrival_slots.map((slot) => (
              <option key={slot} value={slot}>
                {slot}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
    </StepShell>
  );
}
