/**
 * The change-password form, shared by /change-password (forced or chosen)
 * and Settings › Personal › Password.
 *
 *   <ChangePasswordForm forced={false} onSuccess={(session) => …} onCancel={…} />
 */

import { Check, Circle } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { FormError, TextField, applyApiErrors, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/api";

const MIN_LENGTH = 10;
const OBVIOUS = new Set(["password", "farmyard", "farmyardpark"]);

const schema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
    new_password: z
      .string()
      .min(MIN_LENGTH, `Use at least ${MIN_LENGTH} characters`)
      .refine((v) => !OBVIOUS.has(v.toLowerCase()), "Choose a less obvious password"),
    confirm_password: z.string().min(1, "Repeat the new password"),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ["confirm_password"],
    message: "The two passwords do not match",
  })
  .refine((v) => v.new_password !== v.current_password, {
    path: ["new_password"],
    message: "The new password must differ from the current one",
  });

interface Hint {
  label: string;
  met: boolean;
  required: boolean;
}

function hintsFor(password: string): Hint[] {
  return [
    { label: `At least ${MIN_LENGTH} characters`, met: password.length >= MIN_LENGTH, required: true },
    { label: "Not an obvious word", met: password.length > 0 && !OBVIOUS.has(password.toLowerCase()), required: true },
    { label: "Mixes letters and numbers or symbols", met: /[a-zA-Z]/.test(password) && /[^a-zA-Z]/.test(password), required: false },
    { label: "12 or more characters is stronger still", met: password.length >= 12, required: false },
  ];
}

interface ChangePasswordFormProps {
  /** The account was set up with a temporary password. */
  forced?: boolean;
  onSuccess: (session: Session) => void;
  onCancel?: () => void;
  /** Narrower layout inside a settings card. */
  embedded?: boolean;
  autoFocus?: boolean;
}

export function ChangePasswordForm({ forced = false, onSuccess, onCancel, embedded = false, autoFocus = true }: ChangePasswordFormProps) {
  const { changePassword } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const form = useZodForm({
    schema,
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
    mode: "onChange",
  });
  const newPassword = form.watch("new_password");
  const hints = hintsFor(newPassword ?? "");

  async function onSubmit(values: z.output<typeof schema>) {
    setError(null);
    try {
      const session = await changePassword({ current_password: values.current_password, new_password: values.new_password });
      form.reset();
      onSuccess(session);
    } catch (err) {
      const message = applyApiErrors(form, err);
      if (message?.toLowerCase().includes("current password")) {
        form.setError("current_password", { type: "server", message });
        form.setFocus("current_password");
      } else {
        setError(message);
      }
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className={cn("flex flex-col gap-5", embedded && "max-w-md")} noValidate>
        <FormError message={error} />
        <TextField
          control={form.control}
          name="current_password"
          label={forced ? "Temporary password" : "Current password"}
          type="password"
          autoComplete="current-password"
          autoFocus={autoFocus}
        />
        <TextField control={form.control} name="new_password" label="New password" type="password" autoComplete="new-password" />
        <ul className="-mt-2 grid gap-1 text-sm" aria-label="Password requirements">
          {hints.map((hint) => (
            <li key={hint.label} className={cn("flex items-center gap-2", hint.met ? "text-green-text" : "text-muted-foreground")}>
              {hint.met ? <Check aria-hidden="true" className="size-4" /> : <Circle aria-hidden="true" className="size-4 opacity-50" />}
              <span>
                {hint.label}
                {hint.required ? null : <span className="text-muted-foreground"> (recommended)</span>}
              </span>
            </li>
          ))}
        </ul>
        <TextField control={form.control} name="confirm_password" label="Repeat new password" type="password" autoComplete="new-password" />
        <div className={cn("flex gap-2", embedded ? "flex-row-reverse justify-end" : "flex-col")}>
          <Button type="submit" size={embedded ? "default" : "lg"} className={cn(!embedded && "w-full")} disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            {forced ? "Set password and continue" : "Change password"}
          </Button>
          {onCancel && !forced ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Form>
  );
}
