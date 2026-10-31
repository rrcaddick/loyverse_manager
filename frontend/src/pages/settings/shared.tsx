/**
 * Shared plumbing for the settings tabs: form shell with SaveBar and the
 * unsaved-changes guard, dirty-key extraction, and zod helpers.
 */

import type { ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { FormError } from "@/components/form";
import { SaveBar } from "@/components/save-bar";
import { Form } from "@/components/ui/form";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { errorMessage } from "@/lib/api";

interface SettingsFormProps<TFieldValues extends FieldValues, TOutput> {
  form: UseFormReturn<TFieldValues, unknown, TOutput>;
  onSubmit: (values: TOutput) => Promise<void>;
  saving: boolean;
  error?: string | null;
  children: ReactNode;
}

/** Wraps a tab's fields: <Form>, <form>, inline error, SaveBar and nav guard. */
export function SettingsForm<TFieldValues extends FieldValues, TOutput>({ form, onSubmit, saving, error, children }: SettingsFormProps<TFieldValues, TOutput>) {
  const guard = useUnsavedChanges(form.formState.isDirty && !saving);
  const hasErrors = Object.keys(form.formState.errors).length > 0;
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
        <FormError message={error} />
        {children}
        <SaveBar
          dirty={form.formState.isDirty}
          saving={saving}
          disabled={hasErrors}
          onReset={() => form.reset()}
          message={hasErrors ? "Fix the highlighted fields to save" : "You have unsaved changes"}
        />
      </form>
      {guard}
    </Form>
  );
}

/** Keys of `values` whose dirty flag (from formState.dirtyFields) is set. */
export function dirtyKeys<T extends object>(values: T, dirty: unknown): (keyof T)[] {
  if (!dirty || typeof dirty !== "object") return [];
  const flags = dirty as Record<string, unknown>;
  return (Object.keys(values) as (keyof T)[]).filter((key) => isDirty(flags[key as string]));
}

function isDirty(flag: unknown): boolean {
  if (flag === true) return true;
  if (Array.isArray(flag)) return flag.some(isDirty);
  if (flag && typeof flag === "object") return Object.values(flag).some(isDirty);
  return false;
}

/** Subset of `values` limited to `keys`. */
export function pick<T extends object, K extends keyof T>(values: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = values[key];
  return out;
}

/** Runs the save and reports the outcome; returns the error message if any. */
export async function runSave(work: () => Promise<void>, successMessage = "Settings saved"): Promise<string | null> {
  try {
    await work();
    toast.success(successMessage);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

// ----------------------------------------------------------------- schemas

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
export const monthDay = z.string().regex(/^\d{2}-\d{2}$/, "Pick a month and day");
export const money = z.number({ error: "Enter an amount" }).min(0, "Cannot be negative");
export const count = (label = "Enter a whole number") => z.number({ error: label }).int(label).min(0, "Cannot be negative");
export const requiredText = (label: string) => z.string().trim().min(1, label);
export const code = z
  .string()
  .trim()
  .min(1, "Enter a code")
  .regex(/^[a-z0-9_]+$/, "Lowercase letters, digits and underscores only");
