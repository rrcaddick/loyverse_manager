import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray } from "react-hook-form";
import { z } from "zod";

import { DateField, FieldRow, MonthDayField, NumberField, SelectField, TextField, WeekdayToggleField, useZodForm } from "@/components/form";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { useReplaceSeasonDays, useUpdateSection } from "@/features/settings/api";
import { WEEKDAYS, formatDate, formatMonthDay, formatWeekday, todayIso } from "@/lib/format";
import type { SeasonDay } from "@/types/api";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, count, dirtyKeys, isoDate, monthDay, pick, runSave } from "./shared";

const KIND_OPTIONS = [
  { value: "closed", label: "Closed", description: "No bookings on this day" },
  { value: "peak", label: "Peak", description: "Peak price applies, no group discounts" },
  { value: "open", label: "Open", description: "Open even if the weekday is normally closed" },
];

const schema = z
  .object({
    season: z.object({
      start: isoDate,
      end: isoDate,
      closed_weekdays: z.array(z.number().int().min(0).max(6)),
      avoid_weekdays: z.array(z.number().int().min(0).max(6)),
      no_discount_start: monthDay,
      no_discount_end: monthDay,
    }),
    capacity: z.object({
      daily_warning_people: count("Enter the number of people"),
    }),
    season_days: z.array(
      z.object({
        day: isoDate,
        kind: z.enum(["closed", "peak", "open"]),
        label: z.string().trim().max(80, "Keep labels short"),
      }),
    ),
  })
  .superRefine((value, ctx) => {
    if (value.season.end <= value.season.start) {
      ctx.addIssue({ code: "custom", path: ["season", "end"], message: "The season must end after it starts" });
    }
    const overlap = value.season.avoid_weekdays.filter((d) => value.season.closed_weekdays.includes(d));
    if (overlap.length) {
      ctx.addIssue({
        code: "custom",
        path: ["season", "avoid_weekdays"],
        message: `${overlap.map((d) => WEEKDAYS[d]?.label).join(", ")} is already closed`,
      });
    }
    const seen = new Map<string, number>();
    value.season_days.forEach((d, index) => {
      const first = seen.get(d.day);
      if (first !== undefined) {
        ctx.addIssue({ code: "custom", path: ["season_days", index, "day"], message: `Already listed (row ${first + 1})` });
      } else {
        seen.set(d.day, index);
      }
    });
  });

type FormValues = z.input<typeof schema>;

export default function SeasonTab({ data }: SettingsTabProps) {
  const saveSeason = useUpdateSection("season");
  const saveCapacity = useUpdateSection("capacity");
  const saveDays = useReplaceSeasonDays();
  const [error, setError] = useState<string | null>(null);

  const form = useZodForm({
    schema,
    defaultValues: {
      season: data.settings.season,
      capacity: data.settings.capacity,
      season_days: data.season_days.map((d) => ({ day: d.day, kind: d.kind, label: d.label ?? "" })),
    },
  });
  const days = useFieldArray({ control: form.control, name: "season_days" });
  const season = form.watch("season");

  async function onSubmit(values: z.output<typeof schema>) {
    const dirty = form.formState.dirtyFields;
    setError(
      await runSave(async () => {
        const seasonKeys = dirtyKeys(values.season, dirty.season);
        if (seasonKeys.length) await saveSeason.mutateAsync(pick(values.season, seasonKeys));
        const capacityKeys = dirtyKeys(values.capacity, dirty.capacity);
        if (capacityKeys.length) await saveCapacity.mutateAsync(pick(values.capacity, capacityKeys));
        if (dirty.season_days) {
          const items: SeasonDay[] = [...values.season_days]
            .sort((a, b) => a.day.localeCompare(b.day))
            .map((d) => ({ day: d.day, kind: d.kind, label: d.label || null }));
          const saved = await saveDays.mutateAsync(items);
          values.season_days = saved.season_days.map((d) => ({ day: d.day, kind: d.kind, label: d.label ?? "" }));
        }
        form.reset(values as FormValues);
      }),
    );
  }

  const saving = saveSeason.isPending || saveCapacity.isPending || saveDays.isPending;

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={saving} error={error}>
      <Section title="Season dates" description="Group bookings are only offered between these dates. The calendar greys out everything else.">
        <FieldRow>
          <DateField control={form.control} name="season.start" label="Season opens" />
          <DateField control={form.control} name="season.end" label="Season closes" min={season.start} />
        </FieldRow>
      </Section>

      <Section title="Weekdays" description="Which days of the week the park takes groups.">
        <div className="flex flex-col gap-5">
          <WeekdayToggleField
            control={form.control}
            name="season.closed_weekdays"
            label="Closed"
            description="The park does not take group bookings on these days. The public form will not offer them."
          />
          <WeekdayToggleField
            control={form.control}
            name="season.avoid_weekdays"
            label="Avoid"
            description="Open, but discouraged: the calendar flags these days and the form suggests an alternative."
          />
        </div>
      </Section>

      <Section
        title="No-discount window"
        description="Over the festive period group tiers are unavailable and everyone pays the public weekend price (peak days pay the peak price)."
      >
        <FieldRow>
          <MonthDayField control={form.control} name="season.no_discount_start" label="From" />
          <MonthDayField control={form.control} name="season.no_discount_end" label="To (inclusive)" />
        </FieldRow>
        <p className="mt-3 text-sm text-muted-foreground">
          Currently {formatMonthDay(season.no_discount_start)} to {formatMonthDay(season.no_discount_end)}, every season. The window may run across New Year.
        </p>
      </Section>

      <Section
        title="Special days"
        description="Individual dates that override the weekday rules: public-holiday closures, peak-price days, or a normally closed weekday that is open."
        flush
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => days.append({ day: nextFreeDay(form.getValues("season_days")), kind: "closed", label: "" })}>
            <Plus data-icon="inline-start" />
            Add day
          </Button>
        }
      >
        {days.fields.length === 0 ? (
          <EmptyState compact icon={CalendarOff} title="No special days" description="Add public holidays the park closes on, and the peak days over Christmas and New Year." />
        ) : (
          <ul className="divide-y divide-border">
            {days.fields.map((field, index) => {
              const day = form.watch(`season_days.${index}.day`);
              return (
                <li key={field.id} className="grid gap-3 px-5 py-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,9rem)_1fr_auto] sm:items-start">
                  <div className="space-y-1">
                    <DateField control={form.control} name={`season_days.${index}.day`} label={`Date for row ${index + 1}`} hideLabel />
                    <p className="text-xs text-muted-foreground tabular">{day ? formatWeekday(day) : " "}</p>
                  </div>
                  <SelectField control={form.control} name={`season_days.${index}.kind`} label={`Kind for row ${index + 1}`} hideLabel options={KIND_OPTIONS} />
                  <TextField control={form.control} name={`season_days.${index}.label`} label={`Label for row ${index + 1}`} hideLabel placeholder="e.g. Christmas Day" maxLength={80} />
                  <Button type="button" variant="ghost" size="icon-sm" className="justify-self-end text-muted-foreground hover:text-destructive" onClick={() => days.remove(index)} aria-label={`Remove ${day ? formatDate(day) : `row ${index + 1}`}`}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Capacity" description="The calendar warns when the people booked for one day pass this number.">
        <NumberField control={form.control} name="capacity.daily_warning_people" label="Daily warning" suffix="people" integer min={0} className="sm:max-w-xs" />
      </Section>
    </SettingsForm>
  );
}

/** A date not already in the list: today, or the day after the latest entry. */
function nextFreeDay(existing: { day: string }[]): string {
  const today = todayIso();
  const taken = new Set(existing.map((d) => d.day));
  if (!taken.has(today)) return today;
  const latest = [...taken].sort().at(-1) ?? today;
  const next = new Date(`${latest}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}
