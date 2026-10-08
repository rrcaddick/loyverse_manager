/**
 * Renders a synced email body inside a sandboxed iframe.
 *
 * Security model: the HTML is sanitised server-side but still untrusted. The
 * iframe has no `allow-scripts`, so nothing executes; a CSP meta blocks every
 * external load (images are data: only until the reader opts in); forms and
 * top navigation are blocked by the sandbox; links open in a new tab through
 * `allow-popups-to-escape-sandbox` (modern browsers imply noopener).
 * `allow-same-origin` is granted only so the parent can measure the document
 * and size the frame to its content — with scripts off it gives the email
 * nothing.
 */

import { AlignLeft, Code2, ImageIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface MessageBodyProps {
  html: string | null;
  text: string | null;
  /** Hint for the accessible name, e.g. the subject. */
  label: string;
  className?: string;
}

const BASE_CSS = (dark: boolean) => `
  :root { color-scheme: ${dark ? "dark" : "light"}; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: ${dark ? "#ebe7df" : "#1f1d19"};
    font: 14px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    word-wrap: break-word; overflow-wrap: anywhere;
    padding: 2px 2px 8px;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: ${dark ? "#8fc3a0" : "#2f6b45"}; }
  blockquote { margin: 0.5em 0; padding-left: 12px; border-left: 2px solid ${dark ? "#4a4740" : "#d8d3c8"}; color: ${dark ? "#a9a49a" : "#6b665c"}; }
  pre { white-space: pre-wrap; }
  * { max-width: 100%; }
`;

function buildSrcDoc(html: string, dark: boolean, allowImages: boolean): string {
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src ${allowImages ? "https: http: data: cid:" : "data:"}`,
    "font-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${BASE_CSS(dark)}</style></head><body>${html}</body></html>`;
}

/** True when the HTML references an http(s) image that the CSP would block. */
function hasRemoteImages(html: string): boolean {
  return /<img[^>]+src\s*=\s*["']?\s*https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
}

export function MessageBody({ html, text, label, className }: MessageBodyProps) {
  const { resolved } = useTheme();
  const [mode, setMode] = useState<"html" | "text">(html ? "html" : "text");
  const [allowImages, setAllowImages] = useState(false);
  const remoteImages = useMemo(() => (html ? hasRemoteImages(html) : false), [html]);

  const srcDoc = useMemo(() => (html ? buildSrcDoc(html, resolved === "dark", allowImages) : ""), [html, resolved, allowImages]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {html ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-lg bg-muted p-0.5" role="group" aria-label="Body format">
            <Button
              type="button"
              size="xs"
              variant={mode === "html" ? "outline" : "ghost"}
              className={cn(mode === "html" && "bg-background shadow-xs")}
              aria-pressed={mode === "html"}
              onClick={() => setMode("html")}
            >
              <Code2 data-icon="inline-start" /> Formatted
            </Button>
            <Button
              type="button"
              size="xs"
              variant={mode === "text" ? "outline" : "ghost"}
              className={cn(mode === "text" && "bg-background shadow-xs")}
              aria-pressed={mode === "text"}
              onClick={() => setMode("text")}
              disabled={!text}
            >
              <AlignLeft data-icon="inline-start" /> Plain text
            </Button>
          </div>
          {mode === "html" && remoteImages ? (
            <Button type="button" size="xs" variant="ghost" aria-pressed={allowImages} onClick={() => setAllowImages((v) => !v)}>
              <ImageIcon data-icon="inline-start" />
              {allowImages ? "Hide remote images" : "Load remote images"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {mode === "html" && html ? (
        <SandboxedFrame srcDoc={srcDoc} title={`Email body: ${label}`} />
      ) : text ? (
        <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">{text}</pre>
      ) : (
        <p className="text-sm text-muted-foreground italic">This message has no body.</p>
      )}
    </div>
  );
}

function SandboxedFrame({ srcDoc, title }: { srcDoc: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    const next = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
    if (next > 0) setHeight(Math.min(next + 4, 20_000));
  }, []);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (body && "ResizeObserver" in window) {
        observer?.disconnect();
        observer = new ResizeObserver(() => measure());
        observer.observe(body);
      }
      // Late layout (images decoded from data: URIs) settles within a second.
      window.setTimeout(measure, 300);
      window.setTimeout(measure, 1000);
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [measure, srcDoc]);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={{ height }}
      className="block w-full border-0 bg-transparent"
    />
  );
}
