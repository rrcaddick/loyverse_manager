/**
 * `useStepForm` wires a screen's react-hook-form instance to the
 * sessionStorage draft (every keystroke is saved), replays the server's 422
 * messages for the screen's fields, moves focus to the heading on arrival
 * (or to the field a "Change" link asked for) and to the error summary when
 * Continue fails.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, type FieldErrors, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { useLocation } from "react-router";
import type { z } from "zod";

import { focusField } from "./a11y";
import { clearServerError, loadDraft, loadServerErrors, saveDraft, type Draft } from "./draft";
import type { SummaryError } from "./fields";


interface UseStepFormOptions<TSchema extends z.ZodType> {
  schema: TSchema;
  /** The draft keys this screen owns, in display order (drives the summary order). */
  fields: (keyof Draft)[];
}

export function useStepForm<TSchema extends z.ZodType<FieldValues, FieldValues>>({ schema, fields }: UseStepFormOptions<TSchema>) {
  type Input = z.input<TSchema>;
  type Output = z.output<TSchema>;
  const location = useLocation();
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const defaults = useMemo(() => {
    const draft = loadDraft();
    const out: Record<string, unknown> = {};
    for (const key of fields) out[key] = draft[key];
    return out as Input;
    // The draft is read once per mount on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const form = useForm<Input, unknown, Output>({
    resolver: zodResolver(schema as never) as never,
    defaultValues: defaults as never,
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: false,
  });

  // Every keystroke lands in sessionStorage; editing a field clears the
  // server's message for it (stored and on screen — react-hook-form only
  // re-validates after a submit, so a manual error would otherwise stay).
  useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      saveDraft(values as Partial<Draft>);
      if (!name) return;
      const field = String(name).split(".")[0] ?? "";
      clearServerError(field);
      if (form.getFieldState(name).error?.type === "server") form.clearErrors(name);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // Replay the server's 422 messages for this screen's fields.
  useEffect(() => {
    const errors = loadServerErrors();
    for (const [field, message] of Object.entries(errors)) {
      if ((fields as string[]).includes(field)) form.setError(field as Path<Input>, { type: "server", message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus: a field when the Check screen's "Change" link asked for one,
  // otherwise the heading (and scroll to the top of the screen).
  useEffect(() => {
    const requested = (location.state as { focus?: string } | null)?.focus;
    const timer = window.setTimeout(() => {
      if (requested) focusField(requested);
      else {
        window.scrollTo({ top: 0 });
        headingRef.current?.focus({ preventScroll: true });
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summaryErrors = useMemo(() => collectErrors(form.formState.errors as FieldErrors, fields as string[]), [form.formState.errors, fields]);

  // Focus the summary after the errors have been committed to the DOM.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus();
  }, [focusRequest]);

  function focusSummary() {
    setFocusRequest((n) => n + 1);
  }

  return { form: form as UseFormReturn<Input, unknown, Output>, summaryRef, headingRef, summaryErrors, focusSummary };
}

/** Flatten react-hook-form errors into summary rows, in field order. */
export function collectErrors(errors: FieldErrors, order: string[]): SummaryError[] {
  const out: SummaryError[] = [];
  for (const field of order) {
    const entry = errors[field] as unknown;
    if (!entry) continue;
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => {
        const message = (item as { message?: string } | undefined)?.message;
        if (message) out.push({ field: `${field}-${index}`, message });
      });
      const rootMessage = (entry as unknown as { root?: { message?: string } }).root?.message;
      if (rootMessage) out.push({ field: `${field}-0`, message: rootMessage });
      continue;
    }
    const message = (entry as { message?: string }).message;
    if (message) out.push({ field, message });
  }
  return out;
}
