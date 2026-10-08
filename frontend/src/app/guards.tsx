import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { AppLoading } from "@/components/page-skeleton";
import { useAuth } from "@/lib/auth";
import { MANAGER_PATHS, homeFor, safeNext } from "@/lib/nav";
import type { Role } from "@/types/api";

function nextParam(pathname: string, search: string): string {
  const target = `${pathname}${search}`;
  return target && target !== "/" ? `?next=${encodeURIComponent(target)}` : "";
}

/**
 * Requires a session. Anonymous → /login?next=…; a session that must change
 * its password → /change-password (except when already there).
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading || user === undefined) return <AppLoading />;
  if (!user) return <Navigate to={`/login${nextParam(location.pathname, location.search)}`} replace />;
  if (user.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to={`/change-password${nextParam(location.pathname, location.search)}`} replace />;
  }
  return children ? <>{children}</> : <Outlet />;
}

/**
 * Restricts a subtree to roles. Managers are only ever allowed on the
 * calendar paths; anything else sends them to their home.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children?: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return null; // RequireAuth above handles this
  const allowed = roles.includes(user.role) && (user.role === "admin" || MANAGER_PATHS.some((re) => re.test(location.pathname)));
  if (!allowed) return <Navigate to={homeFor(user.role)} replace />;
  return children ? <>{children}</> : <Outlet />;
}

/** Sends a signed-in user away from /login to where they were going. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading || user === undefined) return <AppLoading />;
  if (user && !user.must_change_password) {
    const next = new URLSearchParams(location.search).get("next");
    return <Navigate to={safeNext(next) ?? homeFor(user.role)} replace />;
  }
  return <>{children}</>;
}
