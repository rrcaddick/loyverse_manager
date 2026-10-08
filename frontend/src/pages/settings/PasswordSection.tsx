/** Settings › Personal › Password: the change-password form in a card. */

import { toast } from "sonner";

import { Section } from "@/components/section";
import { ChangePasswordForm } from "@/pages/auth/change-password-form";

export default function PasswordSection() {
  return (
    <Section title="Password" description="Use at least ten characters. You stay signed in on this device after changing it.">
      <ChangePasswordForm embedded autoFocus={false} onSuccess={() => toast.success("Password changed")} />
    </Section>
  );
}
