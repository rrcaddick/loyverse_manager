/**
 * Typed field helpers for react-hook-form + zod forms. Each renders a
 * FormItem with label, control, optional description and the error message,
 * so pages stay declarative:
 *
 *   <TextField control={form.control} name="email" label="Email" type="email" />
 *   <NumberField control={form.control} name="percent" label="Deposit" suffix="%" />
 *   <MoneyField control={form.control} name="price" label="Price per person" />
 *   <SelectField control={form.control} name="role" label="Role" options={ROLE_OPTIONS} />
 *   <SwitchField control={form.control} name="enabled" label="Bounce-back" description="…" />
 *   <DateField control={form.control} name="start" label="Season start" />
 *   <WeekdayToggleField control={form.control} name="closed_weekdays" label="Closed on" />
 *
 * Number fields keep numbers in form state (zod `z.number()`); empty input
 * becomes NaN so `z.number({ error })` can report "Enter a number".
 */

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";

import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldContent } from "@/components/ui/field";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MONTHS, WEEKDAYS, formatDate, parseDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ shared

interface BaseFieldProps<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label?: ReactNode;
  description?: ReactNode;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

function LabelAndHelp({ label, hideLabel, required }: { label?: ReactNode; hideLabel?: boolean; required?: boolean }) {
  if (!label) return null;
  return (
    <FormLabel className={cn(hideLabel && "sr-only")}>
      {label}
      {required ? <span aria-hidden="true" className="text-muted-foreground">*</span> : null}
    </FormLabel>
  );
}

// -------------------------------------------------------------------- text

interface TextFieldProps<T extends FieldValues> extends BaseFieldProps<T> {
  type?: "text" | "email" | "password" | "tel" | "url" | "search";
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  inputClassName?: string;
  autoFocus?: boolean;
  /** Monospace for codes and references. */
  mono?: boolean;
  maxLength?: number;
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  hideLabel,
  disabled,
  className,
  type = "text",
  placeholder,
  autoComplete,
  required,
  prefix,
  suffix,
  inputClassName,
  autoFocus,
  mono,
  maxLength,
}: TextFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <LabelAndHelp label={label} hideLabel={hideLabel} required={required} />
          {prefix || suffix ? (
            <InputGroup>
              {prefix ? (
                <InputGroupAddon>
                  <InputGroupText>{prefix}</InputGroupText>
                </InputGroupAddon>
              ) : null}
              <FormControl>
                <InputGroupInput
                  {...field}
                  value={field.value ?? ""}
                  type={type}
                  placeholder={placeholder}
                  autoComplete={autoComplete}
                  disabled={disabled}
                  autoFocus={autoFocus}
                  maxLength={maxLength}
                  className={cn(mono && "font-mono", inputClassName)}
                />
              </FormControl>
              {suffix ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{suffix}</InputGroupText>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
          ) : (
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ""}
                type={type}
                placeholder={placeholder}
                autoComplete={autoComplete}
                disabled={disabled}
                autoFocus={autoFocus}
                maxLength={maxLength}
                className={cn(mono && "font-mono", inputClassName)}
              />
            </FormControl>
          )}
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ------------------------------------------------------------------ number

interface NumberFieldProps<T extends FieldValues> extends BaseFieldProps<T> {
  min?: number;
  max?: number;
  step?: number | "any";
  placeholder?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  required?: boolean;
  /** Extra classes for the <input> itself (use `className` on the item for width). */
  inputClassName?: string;
  /** Keep the value as an integer. */
  integer?: boolean;
}

function parseNumber(raw: string, integer?: boolean): number {
  if (raw.trim() === "") return Number.NaN;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return Number.NaN;
  return integer ? Math.trunc(n) : n;
}

export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  hideLabel,
  disabled,
  className,
  min,
  max,
  step,
  placeholder,
  prefix,
  suffix,
  required,
  inputClassName,
  integer,
}: NumberFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const display =
          field.value === undefined || field.value === null || Number.isNaN(field.value) ? "" : String(field.value);
        const input = (
          <FormControl>
            <InputGroupInput
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={display}
              onChange={(event) => field.onChange(parseNumber(event.target.value, integer))}
              type="number"
              inputMode={integer ? "numeric" : "decimal"}
              min={min}
              max={max}
              step={step ?? (integer ? 1 : "any")}
              placeholder={placeholder}
              disabled={disabled}
              className={cn("tabular", inputClassName)}
            />
          </FormControl>
        );
        return (
          <FormItem className={className}>
            <LabelAndHelp label={label} hideLabel={hideLabel} required={required} />
            <InputGroup>
              {prefix ? (
                <InputGroupAddon>
                  <InputGroupText>{prefix}</InputGroupText>
                </InputGroupAddon>
              ) : null}
              {input}
              {suffix ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{suffix}</InputGroupText>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

/** Rand amount with 2dp. */
export function MoneyField<T extends FieldValues>(props: Omit<NumberFieldProps<T>, "prefix" | "step">) {
  return <NumberField {...props} prefix="R" step={0.01} min={props.min ?? 0} />;
}

// ---------------------------------------------------------------- textarea

interface TextareaFieldProps<T extends FieldValues> extends BaseFieldProps<T> {
  placeholder?: string;
  rows?: number;
  required?: boolean;
  maxLength?: number;
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  hideLabel,
  disabled,
  className,
  placeholder,
  rows = 4,
  required,
  maxLength,
}: TextareaFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <LabelAndHelp label={label} hideLabel={hideLabel} required={required} />
          <FormControl>
            <Textarea
              {...field}
              value={field.value ?? ""}
              placeholder={placeholder}
              rows={rows}
              disabled={disabled}
              maxLength={maxLength}
              className="min-h-0 resize-y"
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ------------------------------------------------------------------ select

export interface SelectOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

interface SelectFieldProps<T extends FieldValues> extends BaseFieldProps<T> {
  options: SelectOption[];
  placeholder?: string;
  required?: boolean;
  triggerClassName?: string;
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  hideLabel,
  disabled,
  className,
  options,
  placeholder = "Select…",
  required,
  triggerClassName,
}: SelectFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <LabelAndHelp label={label} hideLabel={hideLabel} required={required} />
          <Select value={field.value ?? ""} onValueChange={field.onChange} disabled={disabled} name={field.name}>
            <FormControl>
              <SelectTrigger className={cn("w-full", triggerClassName)} onBlur={field.onBlur} ref={field.ref}>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ------------------------------------------------------------------- radio

export function RadioField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  hideLabel,
  disabled,
  className,
  options,
}: BaseFieldProps<T> & { options: SelectOption[] }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <LabelAndHelp label={label} hideLabel={hideLabel} />
          <FormControl>
            <RadioGroup value={field.value ?? ""} onValueChange={field.onChange} disabled={disabled} className="gap-2">
              {options.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-data-checked:border-primary/40 has-data-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring/50"
                >
                  <RadioGroupItem value={option.value} disabled={option.disabled} className="mt-0.5" />
                  <span className="grid gap-0.5">
                    <span className="font-medium">{option.label}</span>
                    {option.description ? <span className="text-muted-foreground">{option.description}</span> : null}
                  </span>
                </label>
              ))}
            </RadioGroup>
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ---------------------------------------------------------- switch/checkbox

interface ToggleFieldProps<T extends FieldValues> extends BaseFieldProps<T> {
  /** Render the control inside a bordered row. Default true. */
  boxed?: boolean;
}

export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
  boxed = true,
}: ToggleFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem
          orientation="horizontal"
          className={cn(boxed && "rounded-lg border border-border px-4 py-3", "items-center justify-between", className)}
        >
          <FieldContent>
            <FormLabel>{label}</FormLabel>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FieldContent>
          <FormControl>
            <Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} name={field.name} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

export function CheckboxField<T extends FieldValues>({ control, name, label, description, disabled, className }: ToggleFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem orientation="horizontal" className={cn("items-start", className)}>
          <FormControl>
            <Checkbox checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} name={field.name} className="mt-0.5" />
          </FormControl>
          <FieldContent>
            <FormLabel className="font-normal">{label}</FormLabel>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FieldContent>
        </FormItem>
      )}
    />
  );
}

// -------------------------------------------------------------------- date

interface DateFieldProps<T extends FieldValues> extends BaseFieldProps<T> {
  placeholder?: string;
  required?: boolean;
  /** Earliest / latest selectable day (ISO). */
  min?: string;
  max?: string;
  /** Allow clearing the value. */
  clearable?: boolean;
}

/** Date picker storing "YYYY-MM-DD" strings (the API's shape). */
export function DateField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  hideLabel,
  disabled,
  className,
  placeholder = "Pick a date",
  required,
  min,
  max,
  clearable,
}: DateFieldProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const selected = parseDate(field.value as string | undefined) ?? undefined;
        return (
          <FormItem className={className}>
            <LabelAndHelp label={label} hideLabel={hideLabel} required={required} />
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <FormControl>
                  <button
                    type="button"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    disabled={disabled}
                    className={cn(
                      "flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm tabular transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30",
                      !selected && "text-muted-foreground",
                    )}
                  >
                    {selected ? formatDate(selected) : placeholder}
                    <CalendarIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </FormControl>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selected}
                  defaultMonth={selected}
                  captionLayout="dropdown"
                  startMonth={min ? parseDate(min) ?? undefined : new Date(2020, 0)}
                  endMonth={max ? parseDate(max) ?? undefined : new Date(2035, 11)}
                  disabled={[
                    ...(min ? [{ before: parseDate(min)! }] : []),
                    ...(max ? [{ after: parseDate(max)! }] : []),
                  ]}
                  onSelect={(day) => {
                    field.onChange(day ? format(day, "yyyy-MM-dd") : "");
                    setOpen(false);
                  }}
                  weekStartsOn={1}
                />
                {clearable && selected ? (
                  <div className="border-t border-border p-2">
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        field.onChange("");
                        setOpen(false);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
              </PopoverContent>
            </Popover>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

// -------------------------------------------------------------- month-day

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "MM-DD" recurring date (no year), e.g. the no-discount window bounds. */
export function MonthDayField<T extends FieldValues>({ control, name, label, description, hideLabel, disabled, className }: BaseFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const [mm = "", dd = ""] = String(field.value ?? "").split("-");
        const month = Number(mm) || 0;
        const day = Number(dd) || 0;
        const update = (nextMonth: number, nextDay: number) => {
          const maxDay = DAYS_IN_MONTH[nextMonth - 1] ?? 31;
          const safeDay = Math.min(Math.max(nextDay || 1, 1), maxDay);
          field.onChange(`${String(nextMonth).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`);
        };
        return (
          <FormItem className={className}>
            <LabelAndHelp label={label} hideLabel={hideLabel} />
            <div className="flex gap-2">
              <FormControl>
                <Select value={month ? String(month) : ""} onValueChange={(v) => update(Number(v), day)} disabled={disabled}>
                  <SelectTrigger className="flex-1" aria-label="Month" onBlur={field.onBlur} ref={field.ref}>
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <Select value={day ? String(day) : ""} onValueChange={(v) => update(month || 1, Number(v))} disabled={disabled || !month}>
                <SelectTrigger className="w-20 tabular" aria-label="Day">
                  <SelectValue placeholder="Day" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: DAYS_IN_MONTH[(month || 1) - 1] ?? 31 }, (_, i) => i + 1).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

// ---------------------------------------------------------------- weekdays

/** Multi-select of weekdays as Python weekday numbers (0 = Monday). */
export function WeekdayToggleField<T extends FieldValues>({ control, name, label, description, hideLabel, disabled, className }: BaseFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value: number[] = Array.isArray(field.value) ? field.value : [];
        return (
          <FormItem className={className}>
            <LabelAndHelp label={label} hideLabel={hideLabel} />
            <FormControl>
              <ToggleGroup
                type="multiple"
                variant="outline"
                value={value.map(String)}
                onValueChange={(next) => field.onChange(next.map(Number).sort((a, b) => a - b))}
                disabled={disabled}
                className="flex-wrap justify-start"
                aria-label={typeof label === "string" ? label : undefined}
              >
                {WEEKDAYS.map((d) => (
                  <ToggleGroupItem key={d.value} value={String(d.value)} aria-label={d.label} className="min-w-12 px-3">
                    {d.short}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FormControl>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

// ------------------------------------------------------------ form helpers

/** Two-column grid for fields on wider screens. */
export function FieldRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-5 sm:grid-cols-2", className)} {...props} />;
}

/** Inline (non-toast) form error, for login and dialogs. */
export function FormError({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive",
        className,
      )}
    >
      {message}
    </div>
  );
}
