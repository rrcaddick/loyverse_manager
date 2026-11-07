/**
 * Cloudflare Turnstile widget. The script is the one external resource the
 * app loads, and only on the public form when a site key is configured.
 */

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

import { useTheme } from "@/lib/theme";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not initialise")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not load the verification widget"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface TurnstileHandle {
  reset: () => void;
}

interface TurnstileProps {
  siteKey: string;
  onToken: (token: string | null) => void;
  onError?: (message: string) => void;
  ref?: Ref<TurnstileHandle>;
}

export function Turnstile({ siteKey, onToken, onError, ref }: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const { resolved } = useTheme();
  const callbacks = useRef({ onToken, onError });
  useEffect(() => {
    callbacks.current = { onToken, onError };
  });

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      callbacks.current.onToken(null);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          theme: resolved,
          size: "flexible",
          callback: (token: string) => callbacks.current.onToken(token),
          "expired-callback": () => callbacks.current.onToken(null),
          "timeout-callback": () => callbacks.current.onToken(null),
          "error-callback": () => {
            callbacks.current.onToken(null);
            callbacks.current.onError?.("The verification widget reported an error. Please refresh the page and try again.");
          },
        });
      })
      .catch((error: Error) => {
        if (!cancelled) callbacks.current.onError?.(error.message);
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          // Already gone.
        }
      }
      widgetId.current = null;
    };
  }, [siteKey, resolved]);

  return <div ref={container} className="min-h-16" aria-label="Verification" />;
}
