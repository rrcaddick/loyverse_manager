import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldValues, type Path, type UseFormProps, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";

import { isApiError } from "@/lib/api";

/**
 * useForm pre-wired with a zod schema. The schema's *input* type is the form
 * shape; `handleSubmit` gives you the parsed output.
 *
 *   const form = useZodForm({ schema, defaultValues });
 */
export function useZodForm<TSchema extends z.ZodType<FieldValues, FieldValues>>({
  schema,
  ...props
}: Omit<UseFormProps<z.input<TSchema>, unknown, z.output<TSchema>>, "resolver"> & { schema: TSchema }) {
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    // zodResolver's generic expects the schema's own types; the cast only
    // relaxes the FieldValues constraint.
    resolver: zodResolver(schema as never) as never,
    mode: "onBlur",
    reValidateMode: "onChange",
    ...props,
  });
}

/**
 * Map an ApiError's `fields` onto form errors and return the general message.
 *
 *   catch (error) { setError(applyApiErrors(form, error)); }
 */
export function applyApiErrors<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>, error: unknown): string | null {
  if (!isApiError(error)) return error instanceof Error ? error.message : "Something went wrong";
  const entries = Object.entries(error.fields);
  for (const [name, message] of entries) {
    form.setError(name as Path<T>, { type: "server", message });
  }
  // When every error landed on a field, don't repeat the summary line.
  return entries.length > 0 && error.message === "Missing required fields" ? null : error.message;
}
