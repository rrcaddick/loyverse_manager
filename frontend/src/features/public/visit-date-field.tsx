/**
 * The public form's date picker: closed weekdays and closed days are
 * unselectable, peak days carry a marker, and the chosen day is described in
 * words beneath the field.
 */

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";

import { Calendar } from "@/components/ui/calendar";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, parseDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { dayNote } from "./schema";
import type { FormConfig } from "./types";

interface VisitDateFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  config: FormConfig;
  required?: boolean;
  description?: string;
  clearable?: boolean;
  className?: string;
}

/** Python weekday numbers → JS getDay() numbers (Sunday = 0). */
function toJsDays(days: number[]): number[] {
  return days.map((d) => (d + 1) % 7);
}

export function VisitDateField<T extends FieldValues>({ control, name, label, config, required, description, clearable, className }: VisitDateFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const min = parseDate(config.min_date) ?? new Date();
  const max = config.max_date ? parseDate(config.max_date) : null;
  const closedDays = config.closed_days.map((d) => parseDate(d)).filter((d): d is Date => d !== null);
  const peakDays = config.peak_days.map((d) => parseDate(d)).filter((d): d is Date => d !== null);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = (field.value as string | undefined) ?? "";
        const selected = parseDate(value) ?? undefined;
        const note = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayNote(value, config) : null;
        return (
          <FormItem className={className}>
            <FormLabel>
              {label}
              {required ? <span aria-hidden="true" className="text-muted-foreground">*</span> : null}
            </FormLabel>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <FormControl>
                  <button
                    type="button"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    className={cn(
                      "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 text-left text-base tabular transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 sm:h-9 sm:text-sm dark:bg-input/30",
                      !selected && "text-muted-foreground",
                    )}
                  >
                    {selected ? formatDate(selected) : "Pick a date"}
                    <CalendarIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </FormControl>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selected}
                  defaultMonth={selected ?? min}
                  startMonth={min}
                  endMonth={max ?? undefined}
                  weekStartsOn={1}
                  captionLayout="dropdown"
                  disabled={[{ before: min }, ...(max ? [{ after: max }] : []), { dayOfWeek: toJsDays(config.closed_weekdays) }, ...closedDays]}
                  modifiers={{ peak: peakDays }}
                  modifiersClassNames={{
                    peak: "relative after:pointer-events-none after:absolute after:bottom-0.5 after:left-1/2 after:z-20 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-warning after:content-['']",
                  }}
                  onSelect={(day) => {
                    field.onChange(day ? format(day, "yyyy-MM-dd") : "");
                    setOpen(false);
                  }}
                />
                <div className="flex flex-col gap-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Closed on {config.closed_weekdays.map((d) => ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][d]).join(" and ")}
                    {config.closed_days.length > 0 ? " and a few holidays" : ""}.
                  </span>
                  {peakDays.length > 0 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" /> Peak day, peak rates apply
                    </span>
                  ) : null}
                  {clearable && selected ? (
                    <button
                      type="button"
                      className="self-start rounded-md text-xs underline underline-offset-4 hover:text-foreground"
                      onClick={() => {
                        field.onChange("");
                        setOpen(false);
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
            {note ? (
              <FormDescription className={cn(config.peak_days.includes(value) && "text-warning-foreground dark:text-warning")}>{note}</FormDescription>
            ) : description ? (
              <FormDescription>{description}</FormDescription>
            ) : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

