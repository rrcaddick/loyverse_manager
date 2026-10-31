/**
 * Settings › Day kinds: the ordered list that colours the calendar. Highest
 * priority first; when a day matches several, the first one wins. Built-in
 * kinds follow their rule (peak days, public holidays, Ramadan from the
 * Islamic calendar, weekends, school holidays, closed weekdays); a kind added
 * here applies to the dates listed on it.
 */

import { ArrowDown, ArrowUp, CalendarRange, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useWatch, type Control } from "react-hook-form";
import { z } from "zod";

import { DateField, FieldRow, MonthDayField, SwitchField, TextField, TextareaField, useZodForm } from "@/components/form";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUpdateSection } from "@/features/settings/api";
import { cn } from "@/lib/utils";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, monthDay, runSave } from "./shared";

const BUILT_IN = new Set(["peak", "public_holiday", "ramadan_eve", "eid", "weekend", "school_holiday", "closed"]);

const RULES: Record<string, string> = {
  peak: "The peak days below, every year",
  public_holiday: "South African public holidays",
  ramadan_eve: "The day before Ramadan starts",
  eid: "The day after Ramadan ends",
  weekend: "Saturdays and Sundays",
  school_holiday: "The school holidays on the Season page",
  closed: "The closed weekdays on the Season page. Groups can still book.",
};

/** The 2014 Material swatches at 600, plus grey. */
const SWATCHES = ["#E53935", "#D81B60", "#8E24AA", "#5E35B1", "#3949AB", "#1E88E5", "#039BE5", "#00ACC1", "#00897B", "#43A047", "#7CB342", "#C0CA33", "#FDD835", "#FFB300", "#FB8C00", "#F4511E", "#6D4C41", "#9E9E9E", "#546E7A"];

const schema = z
  .object({
    kinds: z.array(
      z.object({
        code: z.string().min(1),
        label: z.string().trim().min(1, "Give it a name").max(40, "Keep it short"),
        colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Pick a colour"),
        on: z.boolean(),
        dates: z.string(),
      }),
    ),
    peak_days: z.array(z.object({ value: monthDay })),
    ramadan: z.object({ start: z.string(), end: z.string() }),
  })
  .superRefine((value, ctx) => {
    value.kinds.forEach((k, index) => {
      if (BUILT_IN.has(k.code)) return;
      const bad = splitDates(k.dates).find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
      if (bad) ctx.addIssue({ code: "custom", path: ["kinds", index, "dates"], message: `"${bad}" is not a date (use YYYY-MM-DD)` });
    });
    for (const key of ["start", "end"] as const) {
      const v = value.ramadan[key];
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) ctx.addIssue({ code: "custom", path: ["ramadan", key], message: "Pick a date" });
    }
    if (value.ramadan.start && value.ramadan.end && value.ramadan.end < value.ramadan.start) {
      ctx.addIssue({ code: "custom", path: ["ramadan", "end"], message: "Ends before it starts" });
    }
  });

type FormValues = z.input<typeof schema>;

function splitDates(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export default function DayKindsTab({ data }: SettingsTabProps) {
  const save = useUpdateSection("day_kinds");
  const [error, setError] = useState<string | null>(null);
  const settings = data.settings.day_kinds;
  const form = useZodForm({
    schema,
    defaultValues: {
      kinds: settings.kinds.map((k) => ({ code: k.code, label: k.label, colour: k.colour, on: k.on !== false, dates: (k.dates ?? []).join("\n") })),
      peak_days: settings.peak_days.map((value) => ({ value })),
      ramadan: { start: settings.ramadan?.start ?? "", end: settings.ramadan?.end ?? "" },
    },
  });
  const kinds = useFieldArray({ control: form.control, name: "kinds" });
  const peaks = useFieldArray({ control: form.control, name: "peak_days" });

  async function onSubmit(values: z.output<typeof schema>) {
    setError(
      await runSave(async () => {
        await save.mutateAsync({
          kinds: values.kinds.map((k) => ({
            code: k.code,
            label: k.label,
            colour: k.colour.toUpperCase(),
            on: k.on,
            ...(BUILT_IN.has(k.code) ? {} : { dates: [...new Set(splitDates(k.dates))].sort() }),
          })),
          peak_days: [...new Set(values.peak_days.map((p) => p.value))].sort(),
          ramadan: { start: values.ramadan.start || null, end: values.ramadan.end || null },
        });
        form.reset(values as FormValues);
      }),
    );
  }

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section
        title="Day kinds"
        description="What colours a day on the calendar. The list is in order: when a day is more than one kind, the one higher up wins."
        flush
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => kinds.append({ code: `custom-${Date.now().toString(36)}`, label: "", colour: "#546E7A", on: true, dates: "" })}>
            <Plus data-icon="inline-start" />
            Add kind
          </Button>
        }
      >
        <ul className="divide-y divide-border">
          {kinds.fields.map((field, index) => (
            <KindRow
              key={field.id}
              control={form.control}
              index={index}
              code={field.code}
              count={kinds.fields.length}
              onMove={(delta) => kinds.move(index, index + delta)}
              onRemove={() => kinds.remove(index)}
            />
          ))}
        </ul>
      </Section>

      <Section
        title="Peak days"
        description="The same days every year. Groups and the public pay the peak rate."
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => peaks.append({ value: "12-26" })}>
            <Plus data-icon="inline-start" />
            Add day
          </Button>
        }
      >
        {peaks.fields.length === 0 ? (
          <EmptyState compact icon={CalendarRange} title="No peak days" description="Add 26 December, 1 January and 2 January, or whichever days the park charges the peak rate." />
        ) : (
          <ul className="flex flex-wrap gap-3">
            {peaks.fields.map((field, index) => (
              <li key={field.id} className="flex items-end gap-1">
                <MonthDayField control={form.control} name={`peak_days.${index}.value`} label={`Peak day ${index + 1}`} hideLabel />
                <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => peaks.remove(index)} aria-label={`Remove peak day ${index + 1}`}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Ramadan" description="Worked out from the Islamic calendar, right to a day. Once the moon has been sighted, set the first and last day here.">
        <FieldRow>
          <DateField control={form.control} name="ramadan.start" label="First day of Ramadan" />
          <DateField control={form.control} name="ramadan.end" label="Last day of Ramadan" />
        </FieldRow>
      </Section>
    </SettingsForm>
  );
}

function KindRow({ control, index, code, count, onMove, onRemove }: { control: Control<FormValues>; index: number; code: string; count: number; onMove: (delta: 1 | -1) => void; onRemove: () => void }) {
  const builtIn = BUILT_IN.has(code);
  const colour = useWatch({ control, name: `kinds.${index}.colour` });
  const on = useWatch({ control, name: `kinds.${index}.on` });
  return (
    <li className={cn("grid gap-x-3 gap-y-2 px-5 py-3 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] sm:items-center", !on && "opacity-60")}>
      <div className="flex items-center">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
          <ArrowDown />
        </Button>
      </div>
      <ColourSwatch control={control} name={`kinds.${index}.colour`} value={colour} />
      <div className="min-w-0 space-y-1">
        <TextField control={control} name={`kinds.${index}.label`} label={`Name of kind ${index + 1}`} hideLabel placeholder="Name" maxLength={40} />
        {builtIn ? (
          <p className="text-xs text-muted-foreground">{RULES[code]}</p>
        ) : (
          <TextareaField control={control} name={`kinds.${index}.dates`} label="Dates" hideLabel placeholder="Dates, one per line (2027-02-14)" rows={2} className="text-sm" />
        )}
      </div>
      <SwitchField control={control} name={`kinds.${index}.on`} label="On" hideLabel />
      <Button type="button" variant="ghost" size="icon-sm" className={cn("text-muted-foreground hover:text-destructive", builtIn && "invisible")} onClick={onRemove} aria-label="Remove this kind" disabled={builtIn}>
        <Trash2 />
      </Button>
    </li>
  );
}

function ColourSwatch({ control, name, value }: { control: Control<FormValues>; name: `kinds.${number}.colour`; value: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Colour ${value}`} className="size-7 rounded-full border-2 border-card shadow-xs ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-selection-ring" style={{ backgroundColor: value }} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <ColourGrid control={control} name={name} value={value} onPick={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function ColourGrid({ control, name, value, onPick }: { control: Control<FormValues>; name: `kinds.${number}.colour`; value: string; onPick: () => void }) {
  // A bare controller keeps the swatch grid outside the Field chrome.
  return (
    <div className="grid grid-cols-7 gap-1.5" role="radiogroup" aria-label="Colour">
      {SWATCHES.map((hex) => (
        <ControlledSwatch key={hex} control={control} name={name} hex={hex} selected={hex.toUpperCase() === value.toUpperCase()} onPick={onPick} />
      ))}
    </div>
  );
}

import { Controller } from "react-hook-form";

function ControlledSwatch({ control, name, hex, selected, onPick }: { control: Control<FormValues>; name: `kinds.${number}.colour`; hex: string; selected: boolean; onPick: () => void }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={hex}
          className={cn("size-6 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-selection-ring", selected && "ring-2 ring-foreground ring-offset-2 ring-offset-popover")}
          style={{ backgroundColor: hex }}
          onClick={() => {
            field.onChange(hex);
            onPick();
          }}
        />
      )}
    />
  );
}
