/**
 * Keeps the appearance store and the server's copy of the user's preference
 * in step.
 *
 * - When the session loads (or changes user) and carries `preferences`, the
 *   server copy is applied locally ("server wins on load").
 * - When the person changes appearance in the app, the full preference is
 *   PUT to /users/me/preferences after a short debounce. A 404 means the
 *   endpoint is not deployed yet: we stop trying and keep working from
 *   localStorage. Any other failure is silent; the local copy still applies.
 *
 * Mounted once in App.tsx inside AuthProvider; renders nothing.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { api, isApiError } from "@/lib/api";
import { normaliseAppearance, setAppearance, subscribeAppearance } from "@/lib/appearance";
import { useAuth } from "@/lib/auth";
import { queryKeys } from "@/lib/query";
import type { Session, User } from "@/types/api";

const DEBOUNCE_MS = 400;

export function AppearanceSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const unavailable = useRef(false);
  const lastServer = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  const userId = user?.id ?? null;
  const prefsKey = user?.preferences ? JSON.stringify(normaliseAppearance(user.preferences)) : null;

  // Server → local.
  useEffect(() => {
    if (!prefsKey || prefsKey === lastServer.current) return;
    lastServer.current = prefsKey;
    setAppearance(JSON.parse(prefsKey), "server");
  }, [prefsKey]);

  // Local (user) → server.
  useEffect(() => {
    if (userId === null) return;
    const unsubscribe = subscribeAppearance((snapshot, source) => {
      if (source !== "user" || unavailable.current) return;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        timer.current = null;
        try {
          const result = await api.put<{ user: User }>("/users/me/preferences", snapshot.appearance);
          const saved = result.user.preferences;
          if (saved) lastServer.current = JSON.stringify(normaliseAppearance(saved));
          queryClient.setQueryData<Session | null>(queryKeys.session, (current) =>
            current && saved ? { ...current, user: { ...current.user, preferences: saved } } : current,
          );
        } catch (error) {
          if (isApiError(error) && error.status === 404) unavailable.current = true;
        }
      }, DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [userId, queryClient]);

  return null;
}
