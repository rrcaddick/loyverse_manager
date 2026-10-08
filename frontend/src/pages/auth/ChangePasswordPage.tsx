import { Check, Circle } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { z } from "zod";

import { FormError, TextField, applyApiErrors, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth";
import { homeFor, safeNext } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { AuthLayout } from "@/layouts/AuthLayout";

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

export default function ChangePasswordPage() {
  useDocumentTitle("Change password");
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const next = safeNext(new URLSearchParams(location.search).get("next"));
  const [error, setError] = useState<string | null>(null);
  const forced = !!user?.must_change_password;

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
      navigate(next ?? homeFor(session.user.role), { replace: true });
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
    <AuthLayout
      title={forced ? "Set a new password" : "Change password"}
      description={
        forced
          ? "Your account was set up with a temporary password. Choose your own before continuing."
          : "Choose a new password for your account."
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
          <FormError message={error} />
          <TextField
            control={form.control}
            name="current_password"
            label={forced ? "Temporary password" : "Current password"}
            type="password"
            autoComplete="current-password"
            autoFocus
          />
          <TextField control={form.control} name="new_password" label="New password" type="password" autoComplete="new-password" />
          <ul className="-mt-2 grid gap-1 text-xs" aria-label="Password requirements">
            {hints.map((hint) => (
              <li key={hint.label} className={cn("flex items-center gap-2", hint.met ? "text-success" : "text-muted-foreground")}>
                {hint.met ? <Check aria-hidden="true" className="size-3.5" /> : <Circle aria-hidden="true" className="size-3.5 opacity-50" />}
                <span>
                  {hint.label}
                  {hint.required ? null : <span className="text-muted-foreground"> (recommended)</span>}
                </span>
              </li>
            ))}
          </ul>
          <TextField control={form.control} name="confirm_password" label="Repeat new password" type="password" autoComplete="new-password" />
          <div className="flex flex-col gap-2">
            <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Spinner data-icon="inline-start" /> : null}
              {forced ? "Set password and continue" : "Change password"}
            </Button>
            {!forced ? (
              <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </Form>
    </AuthLayout>
  );
}
