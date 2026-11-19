/** Small route components used by the route table (kept apart for fast refresh). */

import { Navigate, useLocation, useParams } from "react-router";

import { useAuth } from "@/lib/auth";

type Params = Record<string, string | undefined>;

/** Redirect that keeps the query string and hash, optionally mapping params. */
export function RedirectTo({ to }: { to: string | ((params: Params) => string) }) {
  const params = useParams();
  const { search, hash } = useLocation();
  const target = typeof to === "function" ? to(params) : to;
  return <Navigate to={`${target}${search}${hash}`} replace />;
}

/** /settings → the first section the role may see. */
export function SettingsIndexRedirect() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? "/settings/season" : "/settings/appearance"} replace />;
}
