/**
 * /request/group — Step 3 of 3, "Tell us about your group": group name,
 * kind of group, area, questions, anything else.
 *
 * The group name knows our records (3 Nov 2026): with the address or number
 * from step 1 the screen opens with "Did you mean" and the groups that person
 * booked for before, and as they type three letters it offers organisations
 * whose name starts that way. A pick fills the name (and the area) and travels
 * as `group_id`; "None of these" travels as `group_choice: none`. Families
 * never appear and nothing but names and areas comes back. The name stays
 * editable: it is what goes on their proforma.
 */

import { Check, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useWatch } from "react-hook-form";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { useGroupSuggestions } from "@/features/public/api";
import { ConfigGate } from "@/features/public/config-gate";
import { loadDraft } from "@/features/public/draft";
import { focusField } from "@/features/public/a11y";
import { Field, RadioCards, TextInput, TextareaInput } from "@/features/public/fields";
import { groupSchema } from "@/features/public/schema";
import { StepShell } from "@/features/public/step-shell";
import { useStepForm } from "@/features/public/use-step-form";
import type { FormConfig, GroupSuggestion } from "@/features/public/types";
import { cn } from "@/lib/utils";

const FIELDS = ["group_name", "group_type", "area", "group_id", "group_choice", "questions", "customer_notes"] as const;

export default function RequestGroupPage() {
  return <ConfigGate>{(config) => <GroupStep config={config} />}</ConfigGate>;
}

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return out;
}

function GroupStep({ config }: { config: FormConfig }) {
  const navigate = useNavigate();
  const schema = useMemo(() => groupSchema(config), [config]);
  const { form, summaryRef, headingRef, summaryErrors, focusSummary } = useStepForm({ schema, fields: [...FIELDS] });
  const {
    register,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = form;
  const questions = useWatch({ control, name: "questions" }) ?? [""];
  const groupName = useWatch({ control, name: "group_name" }) ?? "";
  const groupId = useWatch({ control, name: "group_id" }) ?? "";
  const groupChoice = useWatch({ control, name: "group_choice" }) ?? "";
  const onSubmit = form.handleSubmit(() => navigate("/request/check"), focusSummary);

  // The address and number from step 1 (read once: they do not change here).
  const contact = useMemo(() => {
    const d = loadDraft();
    return { email: d.contact_email ?? "", mobile: d.contact_mobile ?? "" };
  }, []);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const typed = useDebounced(groupName, 250);
  const suggestions = useGroupSuggestions(pickedName === groupName ? "" : typed, contact.email, contact.mobile);
  const mine = suggestions.data?.mine ?? [];
  const matches = (suggestions.data?.matches ?? []).filter((g) => !mine.some((m) => m.id === g.id));
  const [listOpen, setListOpen] = useState(false);

  // Editing the name after a pick lets the pick go: the text is theirs again.
  function onNameChange(value: string) {
    setListOpen(true);
    if (getValues("group_id") && pickedName !== null && value !== pickedName) {
      setValue("group_id", "", { shouldDirty: true });
      setValue("group_choice", "", { shouldDirty: true });
      setPickedName(null);
    }
  }

  function pick(g: GroupSuggestion) {
    setPickedName(g.name);
    setValue("group_name", g.name, { shouldDirty: true, shouldValidate: true });
    setValue("group_id", String(g.id), { shouldDirty: true });
    setValue("group_choice", "picked", { shouldDirty: true });
    if (g.area && !getValues("area")) setValue("area", g.area, { shouldDirty: true });
    if (g.group_type && !getValues("group_type") && config.group_types.some((t) => t.code === g.group_type)) setValue("group_type", g.group_type, { shouldDirty: true });
    setListOpen(false);
    window.setTimeout(() => focusField(getValues("group_type") ? "area" : "group_type-0"), 0);
  }

  function noneOfThese() {
    setPickedName(null);
    setValue("group_id", "", { shouldDirty: true });
    setValue("group_choice", "none", { shouldDirty: true });
    window.setTimeout(() => focusField("group_name"), 0);
  }

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

  const showMine = mine.length > 0 && !groupId && groupChoice !== "none";
  const showMatches = listOpen && !groupId && typed.trim().length >= 3 && matches.length > 0;

  return (
    <StepShell step={3} title="Tell us about your group" backTo="/request/visit" errors={summaryErrors} summaryRef={summaryRef} headingRef={headingRef} onSubmit={onSubmit}>
      {showMine ? (
        <div className="flex flex-col gap-3 rounded-lg bg-nested p-4" role="group" aria-labelledby="did-you-mean">
          <p id="did-you-mean" className="text-[1rem] leading-6 font-medium text-foreground">
            Did you mean one of these?
          </p>
          <ul className="flex flex-col gap-2">
            {mine.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => pick(g)} className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-input bg-card px-3 text-left text-[1rem] text-foreground hover:border-ring focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">
                    {g.name}
                    {g.area ? <span className="text-muted-foreground"> · {g.area}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={noneOfThese} className="min-h-11 self-start text-[1rem] font-medium text-primary underline-offset-4 hover:underline">
            None of these, it is a different group
          </button>
        </div>
      ) : null}

      <Field
        id="group_name"
        label="Group name"
        hint="Goes on your proforma and vehicle ticket, for example Sunshine Primary Grade 3."
        error={errors.group_name?.message}
        note={groupId ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Check aria-hidden="true" className="size-4 text-primary" /> Matched to our records. You can still change the wording.</span> : null}
      >
        {(a11y) => (
          <div className="relative">
            <TextInput
              {...a11y}
              autoComplete="organization"
              maxLength={255}
              role="combobox"
              aria-expanded={showMatches}
              aria-controls="group-name-matches"
              aria-autocomplete="list"
              {...register("group_name", {
                onChange: (e) => onNameChange(String(e.target.value ?? "")),
                onBlur: () => window.setTimeout(() => setListOpen(false), 150),
              })}
              onFocus={() => setListOpen(true)}
            />
            {showMatches ? (
              <ul id="group-name-matches" role="listbox" aria-label="Groups we know" className={cn("absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-input bg-card py-1 shadow-md")}>
                {matches.map((g) => (
                  <li key={g.id} role="option" aria-selected={false}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(g)} className="flex min-h-11 w-full items-center px-3 text-left text-[1rem] text-foreground hover:bg-nested focus-visible:bg-nested focus-visible:outline-none">
                      <span className="min-w-0 flex-1 truncate">
                        {g.name}
                        {g.area ? <span className="text-muted-foreground"> · {g.area}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </Field>

      <Field id="group_type" label="Kind of group" error={errors.group_type?.message} group>
        <RadioCards idBase="group_type" options={config.group_types.map((g) => ({ value: g.code, label: g.label }))} aria-describedby={errors.group_type ? "group_type-error" : undefined} {...register("group_type")} />
      </Field>

      <Field id="area" label="Area or town" optional error={errors.area?.message}>
        {(a11y) => <TextInput {...a11y} autoComplete="address-level2" maxLength={255} {...register("area")} />}
      </Field>

      <input type="hidden" {...register("group_id")} />
      <input type="hidden" {...register("group_choice")} />

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
