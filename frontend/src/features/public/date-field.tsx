/**
 * The public form's date question: a dd/mm/yyyy text box (the
 * no-JavaScript path, numeric keypad) plus a calendar button that opens a
 * bottom sheet on phones and a popover on desktop. The calendar opens on the
 * first bookable month, mutes closed days under a "Closed" legend, marks
 * peak days with a dot, and explains a tapped closed day ("We are closed on
 * Mondays and Tuesdays. The next open day is Wednesday 4 November.") instead
 * of silently ignoring it. The chosen day is read back in words under the box.
 */

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useId, useState, type ReactNode, type Ref } from "react";
import type { Modifiers } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { parseDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { closedWeekdayNames, dateProblem, firstBookableMonth, formatDmy, parseDmy, readBack } from "./dates";
import { Field, TextInput } from "./fields";
import type { FormConfig } from "./types";

interface DateFieldProps {
  id: string;
  label: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  config: FormConfig;
  autoComplete?: string;
}

/** Python weekday numbers → JS getDay() numbers (Sunday = 0). */
function toJsDays(days: number[]): number[] {
  return days.map((d) => (d + 1) % 7);
}

export function DateField({ id, label, optional, hint, error, value, onChange, onBlur, inputRef, config, autoComplete = "off" }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const iso = parseDmy(value);
  const note = iso && !dateProblem(iso, config) ? readBack(iso, config) : null;
  const selected = iso ? (parseDate(iso) ?? undefined) : undefined;

  const panel = (
    <DatePanel
      config={config}
      selected={selected}
      onPick={(picked) => {
        onChange(formatDmy(picked));
        setOpen(false);
      }}
    />
  );

  const trigger = (
    <Button type="button" variant="outline" size="icon-lg" aria-label={`Choose ${typeof label === "string" ? label.toLowerCase() : "a date"} from the calendar`} aria-expanded={open} className="h-11 w-11 shrink-0 bg-card">
      <CalendarIcon aria-hidden="true" className="size-5" />
    </Button>
  );

  return (
    <Field id={id} label={label} optional={optional} hint={hint} error={error} note={note}>
      {(a11y) => (
        <div className="flex items-center gap-2">
          <TextInput
            {...a11y}
            ref={inputRef}
            name={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            inputMode="numeric"
            autoComplete={autoComplete}
            placeholder="dd/mm/yyyy"
            className="max-w-[11rem] tabular"
          />
          {isMobile ? (
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>{trigger}</SheetTrigger>
              <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl px-4 pt-4 pb-[max(env(safe-area-inset-bottom,0px),1rem)]">
                <SheetTitle className="text-section pr-10">Choose a date</SheetTitle>
                <SheetDescription className="sr-only">Pick a day from the calendar. Closed days cannot be chosen.</SheetDescription>
                <div className="mt-2 flex justify-center">{panel}</div>
              </SheetContent>
            </Sheet>
          ) : (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>{trigger}</PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-2">
                {panel}
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </Field>
  );
}

interface DatePanelProps {
  config: FormConfig;
  selected: Date | undefined;
  onPick: (iso: string) => void;
}

/** The calendar with its legend and the closed-day explanation; shared by the sheet and the popover. */
function DatePanel({ config, selected, onPick }: DatePanelProps) {
  const [message, setMessage] = useState<string | null>(null);
  const statusId = useId();
  const min = parseDate(config.min_date) ?? new Date();
  const max = config.max_date ? parseDate(config.max_date) : null;
  const closedDates = config.closed_days.map((d) => parseDate(d)).filter((d): d is Date => d !== null);
  const peakDates = config.peak_days.map((d) => parseDate(d)).filter((d): d is Date => d !== null);
  const closedNames = closedWeekdayNames(config);

  function handleSelect(_day: Date | undefined, trigger: Date, modifiers: Modifiers) {
    if (modifiers.disabled) return;
    const iso = format(trigger, "yyyy-MM-dd");
    if (modifiers.closed) {
      setMessage(dateProblem(iso, config) ?? `We are closed on ${closedNames}.`);
      return;
    }
    setMessage(null);
    onPick(iso);
  }

  return (
    <div className="flex w-full max-w-[22rem] flex-col gap-2">
      <Calendar
        mode="single"
        selected={selected}
        onSelect={handleSelect}
        defaultMonth={selected ?? firstBookableMonth(config)}
        startMonth={min}
        endMonth={max ?? undefined}
        weekStartsOn={1}
        showOutsideDays={false}
        className="w-full bg-transparent p-0 [--cell-size:2.75rem] md:[--cell-size:2.5rem]"
        classNames={{
          month: "flex w-full flex-col gap-3",
          weekday: "flex-1 text-sm font-medium text-muted-foreground",
          week: "mt-1 flex w-full",
          caption_label: "text-[1rem] font-medium",
          // "Today" is never bookable here; a highlight would only draw the eye to a greyed cell.
          today: "rounded-(--cell-radius)",
        }}
        disabled={[{ before: min }, ...(max ? [{ after: max }] : [])]}
        modifiers={{
          closed: [{ dayOfWeek: toJsDays(config.closed_weekdays) }, ...closedDates],
          peak: peakDates,
        }}
        modifiersClassNames={{
          closed: "hatched rounded-lg text-faint-foreground [&>button]:text-faint-foreground [&>button]:hover:bg-transparent",
          peak: "relative after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:z-20 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-amber-solid after:content-['']",
        }}
      />
      <div className="flex flex-col gap-1.5 border-t border-border pt-2 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="hatched inline-block size-4 rounded border border-border" />
            Closed{closedNames ? ` (${closedNames})` : ""}
          </span>
          {peakDates.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-2 rounded-full bg-amber-solid" />
              Peak rates
            </span>
          ) : null}
        </div>
        <p id={statusId} role="status" aria-live="polite" className={cn("min-h-5 text-foreground", !message && "sr-only")}>
          {message ?? ""}
        </p>
      </div>
    </div>
  );
}
