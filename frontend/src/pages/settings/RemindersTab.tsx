import { addDays, subDays } from "date-fns";
import { useState } from "react";
import { z } from "zod";

import { NumberField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { useUpdateSection } from "@/features/settings/api";
import { formatDate, formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, count, dirtyKeys, pick, runSave } from "./shared";

const days = count("Enter a number of days").max(120, "Keep it under 120 days");

const schema = z.object({
  reminders: z.object({
    still_interested_days: days,
    deposit_reminder_days_before: days,
    final_details_days_before: days,
    lapse_days_before: days,
  }),
});

type FormValues = z.input<typeof schema>;

export default function RemindersTab({ data }: SettingsTabProps) {
  const save = useUpdateSection("reminders");
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: { reminders: data.settings.reminders } });
  const values = form.watch("reminders");

  async function onSubmit(parsed: z.output<typeof schema>) {
    const keys = dirtyKeys(parsed.reminders, form.formState.dirtyFields.reminders);
    setError(
      await runSave(async () => {
        if (keys.length) await save.mutateAsync(pick(parsed.reminders, keys));
        form.reset(parsed as FormValues);
      }),
    );
  }

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section
        title="When reminders fall due"
        description="Reminders appear in the queue on their due date. Nothing is sent until someone clicks Send on the booking."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
          <div className="flex flex-col gap-6">
            <ReminderField
              control={form}
              name="reminders.still_interested_days"
              label="Still interested?"
              unit="days after the proforma"
              help="A proforma that has gone unanswered this long gets a friendly follow-up asking whether the group still wants the date."
            />
            <ReminderField
              control={form}
              name="reminders.deposit_reminder_days_before"
              label="Deposit reminder"
              unit="days before the visit"
              help="If the deposit has not arrived by this point, remind the contact that the date is not yet secured."
            />
            <ReminderField
              control={form}
              name="reminders.lapse_days_before"
              label="Hold lapses"
              unit="days before the visit"
              help="An unpaid booking's hold expires here. The queue suggests marking it lapsed so the date can be offered to another group. Also sets the default hold date on new bookings."
            />
            <ReminderField
              control={form}
              name="reminders.final_details_days_before"
              label="Final details"
              unit="days before the visit"
              help="For confirmed groups: arrival time, vehicle ticket, head-count check. Goes out with the ticket if it has not been emailed yet."
            />
          </div>
          <Timeline values={values} />
        </div>
      </Section>
    </SettingsForm>
  );
}

type FormApi = ReturnType<typeof useZodForm<typeof schema>>;

function ReminderField({ control, name, label, unit, help }: { control: FormApi; name: `reminders.${keyof FormValues["reminders"]}`; label: string; unit: string; help: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-start">
      <NumberField control={control.control} name={name} label={label} suffix={unit} integer min={0} max={120} />
      <p className="text-sm text-muted-foreground sm:pt-7">{help}</p>
    </div>
  );
}

/** A sample booking plotted against the current settings. */
function Timeline({ values }: { values: FormValues["reminders"] }) {
  const visit = addDays(new Date(), 45);
  const proforma = subDays(visit, 40);
  const events = [
    { label: "Proforma sent", date: proforma, muted: true },
    { label: "Still interested?", date: addDays(proforma, Number(values.still_interested_days) || 0) },
    { label: "Deposit reminder", date: subDays(visit, Number(values.deposit_reminder_days_before) || 0) },
    { label: "Hold lapses", date: subDays(visit, Number(values.lapse_days_before) || 0) },
    { label: "Final details", date: subDays(visit, Number(values.final_details_days_before) || 0) },
    { label: "Visit day", date: visit, muted: true },
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <aside className="rounded-lg border border-border bg-muted/40 p-4 text-sm" aria-live="polite">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Example</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        A proforma sent {formatDate(proforma)} for a visit on {formatDate(visit)}:
      </p>
      <ol className="mt-3 space-y-2 border-l border-border pl-4">
        {events.map((event, index) => (
          <li key={`${event.label}-${index}`} className="relative flex items-baseline justify-between gap-3">
            <span aria-hidden="true" className={cn("absolute -left-[1.3rem] top-1.5 size-2 rounded-full", event.muted ? "bg-border-strong" : "bg-primary")} />
            <span className={cn(event.muted ? "text-muted-foreground" : "text-foreground")}>{event.label}</span>
            <span className="shrink-0 text-muted-foreground tabular">{formatDateShort(event.date)}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
