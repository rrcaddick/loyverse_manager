/**
 * Tiny module-level store shared by the API client and the AuthProvider.
 *
 * The CSRF token lives here (in memory only) so `api.ts` can attach it to
 * every non-GET request without importing React. Auth events let the client
 * tell the provider about 401/403 responses without a circular import.
 */

type AuthEvent = "unauthenticated" | "password_change_required" | "forbidden";
type Listener = (event: AuthEvent) => void;

let csrfToken: string | null = null;
const listeners = new Set<Listener>();

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function onAuthEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAuthEvent(event: AuthEvent): void {
  for (const listener of listeners) listener(event);
}
