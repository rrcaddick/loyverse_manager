/**
 * Field primitives for the public request form. Native inputs, 44 px tall
 * with 16 px text (no iOS zoom), visible labels with "(optional)", hints
 * under the label, inline errors in the same words as the error summary,
 * and `aria-describedby` / `aria-invalid` wired by id (docs/research/06).
 *
 *   <Field id="group_name" label="Group name" hint="…" error={errors.group_name?.message}>
 *     {(a11y) => <TextInput {...a11y} {...register("group_name")} />}
 *   </Field>
 */

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

import { errorId, focusField, hintId } from "./a11y";

export interface FieldA11y {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean;
}

interface FieldProps {
  id: string;
  label: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** A read-back line under the control (e.g. the chosen date in words). */
  note?: ReactNode;
  /** Render the label as a fieldset legend (radio groups). */
  group?: boolean;
  className?: string;
  children: ReactNode | ((a11y: FieldA11y) => ReactNode);
}

/** Label + hint + control + error, in that order; the error is announced inline. */
export function Field({ id, label, optional, hint, error, note, group, className, children }: FieldProps) {
  const describedBy = [hint ? hintId(id) : null, error ? errorId(id) : null].filter(Boolean).join(" ") || undefined;
  const a11y: FieldA11y = { id, "aria-describedby": describedBy, "aria-invalid": !!error };
  const labelNode = (
    <>
      {label}
      {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
    </>
  );
  const body = (
    <>
      {group ? <legend className="text-[1rem] leading-6 font-medium text-foreground">{labelNode}</legend> : <label htmlFor={id} className="block text-[1rem] leading-6 font-medium text-foreground">{labelNode}</label>}
      {hint ? (
        <p id={hintId(id)} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId(id)} className="text-sm font-medium text-red-text">
          <span className="sr-only">Error: </span>
          {error}
        </p>
      ) : null}
      <div className="mt-1">{typeof children === "function" ? children(a11y) : children}</div>
      {note ? <p className="text-sm text-foreground">{note}</p> : null}
    </>
  );
  const classes = cn("flex flex-col gap-1.5", error && "border-l-[3px] border-red-solid pl-3", className);
  return group ? (
    <fieldset className={classes} aria-describedby={describedBy} aria-invalid={!!error || undefined}>
      {body}
    </fieldset>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export const inputClasses =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-[1rem] text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-red-solid aria-invalid:ring-3 aria-invalid:ring-red-solid/20 dark:bg-input/30";

export function TextInput({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(inputClasses, className)} {...props} />;
}

export function TextareaInput({ className, rows = 4, ...props }: React.ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(inputClasses, "h-auto min-h-28 resize-y py-2.5 leading-6", className)} {...props} />;
}

export function SelectInput({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(inputClasses, "appearance-none pr-10")} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

interface RadioOption {
  value: string;
  label: ReactNode;
}

interface RadioCardsProps extends Omit<React.ComponentProps<"input">, "type" | "value" | "id"> {
  idBase: string;
  options: RadioOption[];
}

/** Native radios in 44 px rows; the whole row is the target. */
export function RadioCards({ idBase, options, className, ...props }: RadioCardsProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {options.map((option) => {
        const id = `${idBase}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-3 py-2 text-[1rem] text-foreground has-checked:border-primary has-checked:ring-1 has-checked:ring-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50 dark:bg-input/30"
          >
            <input id={id} type="radio" value={option.value} className="size-5 shrink-0 accent-primary" {...props} />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ error summary

export interface SummaryError {
  /** The field's id (same screen) — the link focuses it. */
  field: string;
  message: string;
  /** Another screen: the link navigates there and focuses the field. */
  to?: string;
}

interface ErrorSummaryProps {
  errors: SummaryError[];
  /** Replaces the list with one sentence (429, Turnstile). */
  message?: string | null;
  ref?: React.Ref<HTMLDivElement>;
}

/** GOV.UK-style "There is a problem": focused on submit, each item links to its field. */
export function ErrorSummary({ errors, message, ref }: ErrorSummaryProps) {
  if (errors.length === 0 && !message) return null;
  return (
    <div ref={ref} role="alert" tabIndex={-1} aria-labelledby="error-summary-title" className="rounded-xl border-2 border-red-solid bg-card p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <h2 id="error-summary-title" className="text-section text-foreground">
        There is a problem
      </h2>
      {message ? <p className="mt-2 text-[1rem] text-foreground">{message}</p> : null}
      {errors.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {errors.map((item) => (
            <li key={`${item.to ?? ""}${item.field}`}>
              {item.to ? (
                <Link to={item.to} state={{ focus: item.field }} className="text-[1rem] font-medium text-red-text underline underline-offset-4">
                  {item.message}
                </Link>
              ) : (
                <a
                  href={`#${item.field}`}
                  className="text-[1rem] font-medium text-red-text underline underline-offset-4"
                  onClick={(event) => {
                    event.preventDefault();
                    focusField(item.field);
                  }}
                >
                  {item.message}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
