import { CalendarOff, Plus, School, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray } from "react-hook-form";
import { z } from "zod";

import { DateField, FieldRow, NumberField, SelectField, TextField, WeekdayToggleField, useZodForm } from "@/components/form";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { useReplaceSeasonDays, useUpdateSection } from "@/features/settings/api";
import { WEEKDAYS, formatDate, formatWeekday, todayIso } from "@/lib/format";
import type { SeasonDay } from "@/types/api";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, count, dirtyKeys, isoDate, pick, runSave } from "./shared";

const KIND_OPTIONS = [
  { value: "closed", label: "Closed", description: "No bookings on this day" },
  { value: "peak", label: "Peak", description: "The peak price for everyone" },
  { value: "open", label: "Open", description: "Open even if the weekday is normally closed" },
];

const schema = z
  .object({
    season: z.object({
      start: isoDate,
      end: isoDate,
      closed_weekdays: z.array(z.number().int().min(0).max(6)),
      avoid_weekdays: z.array(z.number().int().min(0).max(6)),
      school_holidays: z.array(
        z.object({
          from: isoDate,
          to: isoDate,
          label: z.string().trim().max(80, "Keep labels short"),
        }),
      ),
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
    value.season.school_holidays.forEach((r, index) => {
      if (r.to < r.from) ctx.addIssue({ code: "custom", path: ["season", "school_holidays", index, "to"], message: "Ends before it starts" });
    });
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
      season: {
        ...data.settings.season,
        school_holidays: (data.settings.season.school_holidays ?? []).map((r) => ({ from: r.from, to: r.to, label: r.label ?? "" })),
      },
      capacity: data.settings.capacity,
      season_days: data.season_days.map((d) => ({ day: d.day, kind: d.kind, label: d.label ?? "" })),
    },
  });
  const days = useFieldArray({ control: form.control, name: "season_days" });
  const holidays = useFieldArray({ control: form.control, name: "season.school_holidays" });
  const season = form.watch("season");

  async function onSubmit(values: z.output<typeof schema>) {
    const dirty = form.formState.dirtyFields;
    setError(
      await runSave(async () => {
        const seasonKeys = dirtyKeys(values.season, dirty.season);
        if (seasonKeys.length) {
          const payload = pick(values.season, seasonKeys) as Record<string, unknown>;
          if ("school_holidays" in payload) {
            payload.school_holidays = [...values.season.school_holidays].sort((a, b) => a.from.localeCompare(b.from)).map((r) => ({ from: r.from, to: r.to, label: r.label || null }));
          }
          await saveSeason.mutateAsync(payload);
        }
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
        title="School holidays"
        description="Weekdays in these ranges price as weekends: the group rate for groups, and no children's rate. Public holidays and peak days are handled on their own."
        flush
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => holidays.append({ from: todayIso(), to: todayIso(), label: "" })}>
            <Plus data-icon="inline-start" />
            Add a range
          </Button>
        }
      >
        {holidays.fields.length === 0 ? (
          <EmptyState compact icon={School} title="No school holidays listed" description="Add the term breaks for the season; the dates come from the provincial school calendar." />
        ) : (
          <ul className="divide-y divide-border">
            {holidays.fields.map((field, index) => (
              <li key={field.id} className="grid grid-cols-1 gap-3 px-5 py-3 sm:grid-cols-[11rem_11rem_minmax(0,1fr)_auto] sm:items-start">
                <DateField control={form.control} name={`season.school_holidays.${index}.from`} label="From" />
                <DateField control={form.control} name={`season.school_holidays.${index}.to`} label="To (inclusive)" />
                <TextField control={form.control} name={`season.school_holidays.${index}.label`} label="Label" placeholder="Summer holidays" />
                <Button type="button" variant="ghost" size="icon-sm" className="mt-6 text-muted-foreground hover:text-destructive" onClick={() => holidays.remove(index)} aria-label={`Remove range ${index + 1}`}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
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
