/**
 * Email bodies in a sandboxed iframe.
 *
 * Security: the HTML is sanitised at ingest (scripts, styles, frames, forms
 * and handlers gone; remote images moved to `data-src`) but is still
 * untrusted. The frame never gets `allow-scripts`; a CSP meta blocks every
 * external load unless the reader presses "Show images", which copies
 * `data-src` back to `src` and widens `img-src` only. `allow-same-origin`
 * is granted so the parent can measure the document and size the frame to
 * its content (auto height) — with scripts off that gives the email nothing
 * it can use. Links open in a new tab through `allow-popups-to-escape-sandbox`.
 *
 *   <MessageHtml html={item.body_new_html} label={item.subject} />
 *   <MessageText text={item.body_new_text} />
 */

import { ImageIcon, ImageOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAppearance } from "@/lib/appearance";
import { cn } from "@/lib/utils";

interface ThemeVars {
  dark: boolean;
  fg: string;
  muted: string;
  link: string;
  border: string;
}

function readThemeVars(dark: boolean, _theme: string): ThemeVars {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    dark,
    fg: read("--foreground", dark ? "#eeeeee" : "#1b1812"),
    muted: read("--muted-foreground", dark ? "#a4a4a4" : "#5e5a53"),
    link: read("--primary", dark ? "#e7e4df" : "#26201c"),
    border: read("--border", dark ? "#444" : "#d3d1cd"),
  };
}

const BASE_CSS = (v: ThemeVars) => `
  :root { color-scheme: ${v.dark ? "dark" : "light"}; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: ${v.fg};
    font: 15px/1.5 "Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    word-wrap: break-word; overflow-wrap: anywhere;
    padding: 1px 1px 6px;
  }
  body > :first-child { margin-top: 0; }
  body > :last-child { margin-bottom: 0; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: ${v.link}; }
  blockquote { margin: 0.5em 0; padding-left: 12px; border-left: 2px solid ${v.border}; color: ${v.muted}; }
  pre { white-space: pre-wrap; }
  * { max-width: 100%; }
  font[size], [style*="font-size"] { font-size: inherit !important; }
`;

function buildSrcDoc(html: string, vars: ThemeVars, allowImages: boolean): string {
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src ${allowImages ? "https: http: data: cid:" : "'self' data:"}`,
    "font-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${BASE_CSS(vars)}</style></head><body>${html}</body></html>`;
}

/** True when the HTML carries remote images (parked in data-src at ingest, or a live http src). */
function hasRemoteImages(html: string): boolean {
  return /\sdata-src\s*=/i.test(html) || /<img[^>]+src\s*=\s*["']?\s*https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
}

function unparkImages(html: string): string {
  return html.replace(/<img([^>]*?)\sdata-src=/gi, "<img$1 src=");
}

interface MessageHtmlProps {
  html: string;
  /** Accessible name, e.g. the subject. */
  label: string;
  className?: string;
  /** Hide the "Show images" control (e.g. in the compact original view). */
  controls?: boolean;
}

export function MessageHtml({ html, label, className, controls = true }: MessageHtmlProps) {
  const { appearance, resolvedMode } = useAppearance();
  const [showImages, setShowImages] = useState(false);
  const remote = useMemo(() => hasRemoteImages(html), [html]);
  // Re-read the tokens whenever the theme or mode changes so the frame follows the app.
  const vars = useMemo(() => readThemeVars(resolvedMode === "dark", appearance.theme), [resolvedMode, appearance.theme]);
  const srcDoc = useMemo(() => buildSrcDoc(showImages ? unparkImages(html) : html, vars, showImages), [html, vars, showImages]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {controls && remote ? (
        <div>
          <Button type="button" size="xs" variant="ghost" className="-ml-2 text-muted-foreground" aria-pressed={showImages} onClick={() => setShowImages((v) => !v)}>
            {showImages ? <ImageOff data-icon="inline-start" /> : <ImageIcon data-icon="inline-start" />}
            {showImages ? "Hide images" : "Show images"}
          </Button>
        </div>
      ) : null}
      <SandboxedFrame srcDoc={srcDoc} title={`Email: ${label}`} />
    </div>
  );
}

function SandboxedFrame({ srcDoc, title }: { srcDoc: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    const next = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
    if (next > 0) setHeight(Math.min(next + 2, 20_000));
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
      window.setTimeout(measure, 250);
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

/** Plain-text body (text-only mail, signatures). */
export function MessageText({ text, className, muted = false }: { text: string; className?: string; muted?: boolean }) {
  return <pre className={cn("font-sans text-body leading-relaxed break-words whitespace-pre-wrap", muted ? "text-muted-foreground" : "text-foreground", className)}>{text}</pre>;
}
