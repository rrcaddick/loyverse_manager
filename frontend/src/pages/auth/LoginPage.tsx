import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { z } from "zod";

import { FormError, TextField, applyApiErrors, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { isApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { homeFor, safeNext } from "@/lib/nav";
import { AuthLayout } from "@/layouts/AuthLayout";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email address").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export default function LoginPage() {
  useDocumentTitle("Sign in");
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const next = safeNext(new URLSearchParams(location.search).get("next"));
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useZodForm({ schema, defaultValues: { email: "", password: "" } });

  async function onSubmit(values: z.output<typeof schema>) {
    setError(null);
    try {
      const session = await login(values);
      if (session.user.must_change_password) {
        navigate(`/change-password${next ? `?next=${encodeURIComponent(next)}` : ""}`, { replace: true });
      } else {
        navigate(next ?? homeFor(session.user.role), { replace: true });
      }
    } catch (err) {
      if (isApiError(err) && err.code === "throttled") {
        setError("Too many sign-in attempts from this connection. Wait a few minutes and try again.");
      } else if (isApiError(err) && err.status === 401) {
        setError("That email and password do not match. Check both and try again.");
        form.setFocus("password");
      } else {
        setError(applyApiErrors(form, err));
      }
    }
  }

  return (
    <AuthLayout title="Sign in" description="Group bookings for The Farmyard Park">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
          <FormError message={error} />
          <TextField control={form.control} name="email" label="Email" type="email" autoComplete="username" autoFocus placeholder="you@farmyardpark.co.za" />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <InputGroup>
                  <FormControl>
                    <InputGroupInput {...field} type={showPassword ? "text" : "password"} autoComplete="current-password" />
                  </FormControl>
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="button"
                      size="icon-xs"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            Sign in
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Forgotten your password? Ask an administrator to reset it.
          </p>
        </form>
      </Form>
    </AuthLayout>
  );
}
