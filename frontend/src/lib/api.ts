/**
 * Typed fetch wrapper for the JSON API under /api/v1.
 *
 *   const users = await api.get<{ items: User[] }>("/users");
 *   await api.post("/users", { email, full_name, role });
 *
 * - Same-origin cookies, JSON in and out, 204 → undefined.
 * - X-CSRF-Token is attached to every non-GET request from the auth store.
 *   A 403 with code "csrf" refreshes the session once and retries.
 * - Errors are thrown as ApiError { status, code, message, fields }.
 * - 401 and 403/password_change_required are also broadcast to the
 *   AuthProvider, which updates the session cache; the route guards then
 *   redirect to /login?next= or /change-password.
 */

import type { ApiErrorBody, Session } from "@/types/api";

import { emitAuthEvent, getCsrfToken, setCsrfToken } from "./auth-store";

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
  }

  /** True when the server rejected the request body (422/400 validation). */
  get isValidation(): boolean {
    return this.code === "validation_error";
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  params?: QueryParams;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Internal: prevents infinite CSRF retry loops. */
  _retried?: boolean;
}

export function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const error = body?.error;
  return new ApiError(
    response.status,
    error?.code ?? (response.status === 404 ? "not_found" : "http_error"),
    error?.message ?? defaultMessage(response.status),
    error?.fields,
  );
}

function defaultMessage(status: number): string {
  switch (status) {
    case 401:
      return "Sign in required";
    case 403:
      return "You do not have access to this";
    case 404:
      return "Not found";
    case 429:
      return "Too many attempts. Try again in a few minutes.";
    case 500:
      return "Something went wrong on the server";
    default:
      return `Request failed (${status})`;
  }
}

async function refreshCsrf(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/auth/session`, { credentials: "same-origin" });
    if (!response.ok) return false;
    const session = (await response.json()) as Session;
    setCsrfToken(session.csrf_token);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    headers,
    signal: options.signal,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (method !== "GET" && method !== "HEAD") {
    const token = getCsrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path}${buildQuery(options.params)}`;
  const response = await fetch(url, init);

  if (response.ok) {
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  const error = await parseError(response);

  if (error.status === 401) {
    setCsrfToken(null);
    emitAuthEvent("unauthenticated");
  } else if (error.status === 403 && error.code === "password_change_required") {
    emitAuthEvent("password_change_required");
  } else if (error.status === 403 && error.code === "csrf" && !options._retried) {
    if (await refreshCsrf()) {
      return request<T>(method, path, body, { ...options, _retried: true });
    }
  }
  throw error;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, body ?? {}, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PUT", path, body ?? {}, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, body ?? {}, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options),
};

/** Narrow an unknown caught value to ApiError. */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Human message for any thrown value, for toasts and inline alerts. */
export function errorMessage(value: unknown, fallback = "Something went wrong"): string {
  if (isApiError(value)) return value.message || fallback;
  if (value instanceof Error) return value.message || fallback;
  return fallback;
}

/** Absolute URL for a file served by the API (PDFs, attachments). */
export function apiUrl(path: string, params?: QueryParams): string {
  return `${API_BASE}${path}${buildQuery(params)}`;
}
