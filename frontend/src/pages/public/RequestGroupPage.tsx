/**
 * /request/group — Step 2 of 3, "Tell us about your group": group name,
 * kind of group, area, vehicles, gazebos, questions, anything else.
 */

import { Plus, X } from "lucide-react";
import { useMemo } from "react";
import { useWatch } from "react-hook-form";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { ConfigGate } from "@/features/public/config-gate";
import { focusField } from "@/features/public/a11y";
import { Field, RadioCards, TextInput, TextareaInput } from "@/features/public/fields";
import { groupSchema } from "@/features/public/schema";
import { StepShell } from "@/features/public/step-shell";
import { useStepForm } from "@/features/public/use-step-form";
import type { FormConfig } from "@/features/public/types";

const FIELDS = ["group_name", "group_type", "area", "vehicles", "gazebos", "questions", "customer_notes"] as const;

export default function RequestGroupPage() {
  return <ConfigGate>{(config) => <GroupStep config={config} />}</ConfigGate>;
}

function GroupStep({ config }: { config: FormConfig }) {
  const navigate = useNavigate();
  const schema = useMemo(() => groupSchema(config), [config]);
  const { form, summaryRef, headingRef, summaryErrors, focusSummary } = useStepForm({ schema, fields: [...FIELDS] });
  const {
    register,
    control,
    formState: { errors },
  } = form;
  const questions = useWatch({ control, name: "questions" }) ?? [""];
  const onSubmit = form.handleSubmit(() => navigate("/request/contact"), focusSummary);

  function addQuestion() {
    const next = [...form.getValues("questions"), ""];
    form.setValue("questions", next, { shouldDirty: true });
    window.setTimeout(() => focusField(`questions-${next.length - 1}`), 0);
  }

  function removeQuestion(index: number) {
    const current = form.getValues("questions");
    const next = current.filter((_, i) => i !== index);
    form.setValue("questions", next.length ? next : [""], { shouldDirty: true });
    window.setTimeout(() => focusField(`questions-${Math.max(0, index - 1)}`), 0);
  }

  const questionErrors = errors.questions as unknown as ({ message?: string } | undefined)[] | { message?: string } | undefined;
  const questionError = (index: number): string | undefined => {
    if (!questionErrors) return undefined;
    if (Array.isArray(questionErrors)) return questionErrors[index]?.message;
    return index === 0 ? questionErrors.message : undefined;
  };

  return (
    <StepShell step={2} title="Tell us about your group" backTo="/request/visit" errors={summaryErrors} summaryRef={summaryRef} headingRef={headingRef} onSubmit={onSubmit}>
      <Field id="group_name" label="Group name" hint="Goes on your proforma and vehicle ticket, for example Sunshine Primary Grade 3." error={errors.group_name?.message}>
        {(a11y) => <TextInput {...a11y} autoComplete="organization" maxLength={255} {...register("group_name")} />}
      </Field>

      <Field id="group_type" label="Kind of group" error={errors.group_type?.message} group>
        <RadioCards idBase="group_type" options={config.group_types.map((g) => ({ value: g.code, label: g.label }))} aria-describedby={errors.group_type ? "group_type-error" : undefined} {...register("group_type")} />
      </Field>

      <Field id="area" label="Area or town" optional error={errors.area?.message}>
        {(a11y) => <TextInput {...a11y} autoComplete="address-level2" maxLength={255} {...register("area")} />}
      </Field>

      <Field id="vehicles" label="Vehicles" optional hint="Buses, taxis and cars; the count goes on your vehicle ticket." error={errors.vehicles?.message}>
        {(a11y) => <TextInput {...a11y} inputMode="numeric" autoComplete="off" className="max-w-[8rem] tabular" {...register("vehicles")} />}
      </Field>

      <Field id="gazebos" label="Gazebos to hire" optional hint={`Shaded spots. We have ${config.max_gazebos}, first come first served.`} error={errors.gazebos?.message}>
        {(a11y) => <TextInput {...a11y} inputMode="numeric" autoComplete="off" className="max-w-[8rem] tabular" {...register("gazebos")} />}
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-[1rem] leading-6 font-medium text-foreground">
          Questions for us<span className="font-normal text-muted-foreground"> (optional)</span>
        </legend>
        <p id="questions-hint" className="text-sm text-muted-foreground">
          We answer these in our reply, in writing.
        </p>
        {questions.map((_, index) => (
          <Field key={index} id={`questions-${index}`} label={`Question ${index + 1}`} error={questionError(index)} className="gap-1">
            {(a11y) => (
              <div className="flex items-center gap-2">
                <TextInput {...a11y} aria-describedby={[a11y["aria-describedby"], "questions-hint"].filter(Boolean).join(" ")} maxLength={500} {...register(`questions.${index}` as const)} />
                {questions.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon-lg" className="h-11 w-11 shrink-0 text-muted-foreground" aria-label={`Remove question ${index + 1}`} onClick={() => removeQuestion(index)}>
                    <X aria-hidden="true" className="size-5" />
                  </Button>
                ) : null}
              </div>
            )}
          </Field>
        ))}
        {questions.length < config.max_questions ? (
          <Button type="button" variant="outline" className="h-11 self-start text-[1rem]" onClick={addQuestion}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add another question
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">That is the most we can take here; anything else can go in the box below.</p>
        )}
      </fieldset>

      <Field id="customer_notes" label="Anything else we should know?" optional hint="Celebrations, special needs, catering plans, buses that need parking." error={errors.customer_notes?.message}>
        {(a11y) => <TextareaInput {...a11y} rows={4} maxLength={2000} {...register("customer_notes")} />}
      </Field>
    </StepShell>
  );
}
