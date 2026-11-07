import { useLocation, useNavigate } from "react-router";

import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth";
import { homeFor, safeNext } from "@/lib/nav";
import { AuthLayout } from "@/layouts/AuthLayout";

import { ChangePasswordForm } from "./change-password-form";

export default function ChangePasswordPage() {
  useDocumentTitle("Change password");
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const next = safeNext(new URLSearchParams(location.search).get("next"));
  const forced = !!user?.must_change_password;

  return (
    <AuthLayout
      title={forced ? "Set a new password" : "Change password"}
      description={
        forced
          ? "Your account was set up with a temporary password. Choose your own before continuing."
          : "Choose a new password for your account."
      }
    >
      <ChangePasswordForm
        forced={forced}
        onSuccess={(session) => navigate(next ?? homeFor(session.user.role), { replace: true })}
        onCancel={() => navigate(-1)}
      />
    </AuthLayout>
  );
}
