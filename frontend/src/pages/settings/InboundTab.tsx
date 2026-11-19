import { useState } from "react";
import { z } from "zod";

import { FieldRow, NumberField, SwitchField, TextField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { useUpdateSection } from "@/features/settings/api";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, count, dirtyKeys, pick, requiredText, runSave } from "./shared";

const schema = z.object({
  inbound: z.object({
    active_days_after_visit: count("Enter a number of days"),
    form_window_hours: count("Enter a number of hours").min(1, "At least 1"),
    sweep_interval_hours: count("Enter a number of hours").min(1, "At least 1"),
    skipped_days: count("Enter a number of days").min(1, "At least 1"),
    bounce_back_enabled: z.boolean(),
    labels_enabled: z.boolean(),
    label_bookings: requiredText("Give the label a name").max(80, "Keep it short"),
    label_enquiries: requiredText("Give the label a name").max(80, "Keep it short"),
    label_process: requiredText("Give the label a name").max(80, "Keep it short"),
  }),
});

export default function InboundTab({ data }: SettingsTabProps) {
  const save = useUpdateSection("inbound");
  const [error, setError] = useState<string | null>(null);
  const i = data.settings.inbound;
  const form = useZodForm({
    schema,
    defaultValues: {
      inbound: {
        active_days_after_visit: i.active_days_after_visit,
        form_window_hours: i.form_window_hours,
        sweep_interval_hours: i.sweep_interval_hours,
        skipped_days: i.skipped_days,
        bounce_back_enabled: i.bounce_back_enabled,
        labels_enabled: i.labels_enabled,
        label_bookings: i.label_bookings,
        label_enquiries: i.label_enquiries,
        label_process: i.label_process,
      },
    },
  });

  async function onSubmit(values: z.output<typeof schema>) {
    setError(
      await runSave(async () => {
        const keys = dirtyKeys(values.inbound, form.formState.dirtyFields.inbound);
        if (keys.length) await save.mutateAsync(pick(values.inbound, keys));
        form.reset(values);
      }),
    );
  }

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section title="Windows" description="How long a customer's mail still belongs to their booking, and how often mail nobody answered becomes an enquiry.">
        <FieldRow>
          <NumberField control={form.control} name="inbound.active_days_after_visit" label="After the visit" suffix="days" integer min={0} description="Mail from a customer still joins their booking this long after the visit day." />
          <NumberField control={form.control} name="inbound.sweep_interval_hours" label="Sweep every" suffix="hours" integer min={1} description="Unanswered mail that matches no booking becomes an enquiry on this cycle." />
        </FieldRow>
      </Section>

      <Section title="Booking form reply" description="A first-time sender can be pointed at the booking form straight away.">
        <SwitchField control={form.control} name="inbound.bounce_back_enabled" label="Send the form link to new senders" description="One reply with the link to the booking request form. The wording is on the Templates page." />
        <NumberField control={form.control} name="inbound.form_window_hours" label="At most once every" suffix="hours" integer min={1} className="sm:max-w-xs" description="The same sender is not sent the link again within this window." />
      </Section>

      <Section title="Gmail labels" description="The labels put on mail in the mailbox so the office can see from Gmail what the app has done with it.">
        <SwitchField control={form.control} name="inbound.labels_enabled" label="Label mail in Gmail" />
        <FieldRow>
          <TextField control={form.control} name="inbound.label_bookings" label="Mail on a booking" maxLength={80} />
          <TextField control={form.control} name="inbound.label_enquiries" label="Mail on an enquiry" maxLength={80} />
          <TextField control={form.control} name="inbound.label_process" label="Automated mail set aside" maxLength={80} />
        </FieldRow>
      </Section>

      <Section title="Automated mail" description="Newsletters, receipts and bounces are set aside instead of becoming enquiries. Today shows how many, and System lists them.">
        <NumberField control={form.control} name="inbound.skipped_days" label="Show the last" suffix="days" integer min={1} className="sm:max-w-xs" />
      </Section>
    </SettingsForm>
  );
}
