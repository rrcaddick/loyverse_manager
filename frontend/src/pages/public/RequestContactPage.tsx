/**
 * /request/contact — Step 3 of 3, "How do we reach you?": name, email (the
 * proforma and reference go here), mobile (the vehicle ticket is WhatsApped).
 */

import { useMemo } from "react";
import { useNavigate } from "react-router";

import { ConfigGate } from "@/features/public/config-gate";
import { Field, TextInput } from "@/features/public/fields";
import { contactSchema } from "@/features/public/schema";
import { StepShell } from "@/features/public/step-shell";
import { useStepForm } from "@/features/public/use-step-form";

const FIELDS = ["contact_name", "contact_email", "contact_mobile"] as const;

export default function RequestContactPage() {
  return <ConfigGate>{() => <ContactStep />}</ConfigGate>;
}

function ContactStep() {
  const navigate = useNavigate();
  const schema = useMemo(() => contactSchema(), []);
  const { form, summaryRef, headingRef, summaryErrors, focusSummary } = useStepForm({ schema, fields: [...FIELDS] });
  const {
    register,
    formState: { errors },
  } = form;
  const onSubmit = form.handleSubmit(() => navigate("/request/check"), focusSummary);

  return (
    <StepShell step={3} title="How do we reach you?" backTo="/request/group" errors={summaryErrors} summaryRef={summaryRef} headingRef={headingRef} onSubmit={onSubmit}>
      <Field id="contact_name" label="Your name" error={errors.contact_name?.message}>
        {(a11y) => <TextInput {...a11y} autoComplete="name" maxLength={255} {...register("contact_name")} />}
      </Field>
      <Field id="contact_email" label="Email" hint="We send the proforma and your reference here." error={errors.contact_email?.message}>
        {(a11y) => <TextInput {...a11y} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={255} {...register("contact_email")} />}
      </Field>
      <Field id="contact_mobile" label="Mobile" hint="We WhatsApp your vehicle ticket to this number." error={errors.contact_mobile?.message}>
        {(a11y) => <TextInput {...a11y} type="tel" inputMode="tel" autoComplete="tel" maxLength={40} className="max-w-[16rem] tabular" {...register("contact_mobile")} />}
      </Field>
    </StepShell>
  );
}
