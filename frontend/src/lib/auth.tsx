/**
 * Session state for the whole app.
 *
 *   const { user, isAdmin, login, logout } = useAuth();
 *
 * The session is a TanStack query (["auth", "session"]) so any component can
 * read it, and the API client's 401 / password_change_required events update
 * the same cache. Guards in src/app/guards.tsx turn that state into redirects.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { api, isApiError } from "@/lib/api";
import { onAuthEvent, setCsrfToken } from "@/lib/auth-store";
import { queryKeys } from "@/lib/query";
import type { Role, Session, User } from "@/types/api";

export interface LoginInput {
  email: string;
  password: string;
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

interface AuthContextValue {
  /** undefined while the first session check is in flight. */
  user: User | null | undefined;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isManager: boolean;
  hasRole: (...roles: Role[]) => boolean;
  login: (input: LoginInput) => Promise<Session>;
  logout: () => Promise<void>;
  changePassword: (input: ChangePasswordInput) => Promise<Session>;
  refresh: () => Promise<Session | null>;
  isLoggingIn: boolean;
  isLoggingOut: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchSession(): Promise<Session | null> {
  try {
    const session = await api.get<Session>("/auth/session");
    setCsrfToken(session.csrf_token);
    return session;
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // The API client reports auth failures here; we mirror them into the cache.
  useEffect(
    () =>
      onAuthEvent((event) => {
        if (event === "unauthenticated") {
          setCsrfToken(null);
          queryClient.setQueryData<Session | null>(queryKeys.session, null);
          queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
        } else if (event === "password_change_required") {
          queryClient.setQueryData<Session | null>(queryKeys.session, (current) =>
            current ? { ...current, user: { ...current.user, must_change_password: true } } : current,
          );
        }
      }),
    [queryClient],
  );

  const loginMutation = useMutation({
    mutationFn: (input: LoginInput) => api.post<Session>("/auth/login", input),
    meta: { silent: true },
    onSuccess: (session) => {
      setCsrfToken(session.csrf_token);
      queryClient.setQueryData(queryKeys.session, session);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSettled: () => {
      setCsrfToken(null);
      queryClient.setQueryData<Session | null>(queryKeys.session, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (input: ChangePasswordInput) => api.post<Session>("/auth/change-password", input),
    meta: { silent: true },
    onSuccess: (session) => {
      setCsrfToken(session.csrf_token);
      queryClient.setQueryData(queryKeys.session, session);
    },
  });

  const user = sessionQuery.data === undefined ? undefined : sessionQuery.data?.user ?? null;

  const value = useMemo<AuthContextValue>(() => {
    const role = user?.role;
    return {
      user,
      isLoading: sessionQuery.isPending,
      isAuthenticated: !!user,
      isAdmin: role === "admin",
      isManager: role === "manager",
      hasRole: (...roles) => !!role && roles.includes(role),
      login: (input) => loginMutation.mutateAsync(input),
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
      changePassword: (input) => changePasswordMutation.mutateAsync(input),
      refresh: async () => {
        const result = await sessionQuery.refetch();
        return result.data ?? null;
      },
      isLoggingIn: loginMutation.isPending,
      isLoggingOut: logoutMutation.isPending,
    };
  }, [user, sessionQuery, loginMutation, logoutMutation, changePasswordMutation]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Display label for a role. */
export function roleLabel(role: Role): string {
  return role === "admin" ? "Administrator" : "Manager";
}
