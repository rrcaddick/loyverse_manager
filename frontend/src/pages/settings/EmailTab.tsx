import { useState } from "react";
import { z } from "zod";

import { FieldRow, NumberField, SwitchField, TextField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { useUpdateSection } from "@/features/settings/api";
import { formatPhone } from "@/lib/format";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, count, dirtyKeys, pick, requiredText, runSave } from "./shared";

const schema = z.object({
  email: z.object({
    sender_name: requiredText("Enter the sender name"),
    signature_name: requiredText("Enter the name to sign off with"),
    signature_title: z.string().trim(),
    signature_company: requiredText("Enter the company for the signature"),
    phone: requiredText("Enter a phone number"),
    website: z.string().trim(),
    bounce_back_enabled: z.boolean(),
    review_window_days: count("Enter a number of days").max(365, "Keep it within a year"),
  }),
});

type FormValues = z.input<typeof schema>;

export default function EmailTab({ data }: SettingsTabProps) {
  const save = useUpdateSection("email");
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: { email: data.settings.email } });
  const email = form.watch("email");

  async function onSubmit(values: z.output<typeof schema>) {
    const keys = dirtyKeys(values.email, form.formState.dirtyFields.email);
    setError(
      await runSave(async () => {
        if (keys.length) await save.mutateAsync(pick(values.email, keys));
        form.reset(values as FormValues);
      }),
    );
  }

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section title="Sender" description="The name customers see in their inbox. The address is the bookings mailbox and is set on the server.">
        <TextField control={form.control} name="email.sender_name" label="From name" className="sm:max-w-sm" />
      </Section>

      <Section title="Signature" description="Closes every outbound email.">
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,20rem)]">
          <div className="flex flex-col gap-5">
            <FieldRow>
              <TextField control={form.control} name="email.signature_name" label="Name" />
              <TextField control={form.control} name="email.signature_title" label="Title" placeholder="Director" />
            </FieldRow>
            <TextField control={form.control} name="email.signature_company" label="Company" />
            <FieldRow>
              <TextField control={form.control} name="email.phone" label="Phone" type="tel" />
              <TextField control={form.control} name="email.website" label="Website" placeholder="www.farmyardpark.co.za" />
            </FieldRow>
          </div>
          <aside className="rounded-lg border border-border bg-muted/40 p-4 text-sm" aria-label="Signature preview">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Preview</h3>
            <p className="mt-3 text-muted-foreground">Kind regards,</p>
            <p className="mt-3 font-medium text-foreground">{email.signature_name || " "}</p>
            <p className="text-muted-foreground">
              {[email.signature_title, email.signature_company].filter(Boolean).join(", ") || " "}
            </p>
            <p className="mt-2 text-muted-foreground tabular">
              {formatPhone(email.phone)}
              {email.website ? ` · ${email.website}` : ""}
            </p>
          </aside>
        </div>
      </Section>

      <Section
        title="Unknown senders"
        description="Mail that cannot be matched to a booking waits in the inbox for review. A bounce-back can point the sender at the booking form in the meantime."
      >
        <div className="flex flex-col gap-5">
          <SwitchField
            control={form.control}
            name="email.bounce_back_enabled"
            label="Offer a bounce-back reply"
            description="Adds a one-click reply on unmatched messages that sends the sender a link to the booking form. Each sender gets at most one."
          />
          <NumberField
            control={form.control}
            name="email.review_window_days"
            label="Review window"
            suffix="days"
            integer
            min={0}
            max={365}
            className="sm:max-w-xs"
            description="Unmatched messages older than this drop out of the review list (they remain searchable)."
          />
        </div>
      </Section>
    </SettingsForm>
  );
}
