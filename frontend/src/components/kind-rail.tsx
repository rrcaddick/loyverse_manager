/**
 * KindRail — the vertical rail of views with counts (Work kinds, Mail
 * queues). Counts hide at zero and, unless `always`, so does the item.
 *
 *   <KindRail
 *     aria-label="Work views"
 *     value={view}
 *     onChange={setView}
 *     items={[
 *       { value: "up_next", label: "Up next", count: 10, always: true },
 *       { value: "reply", label: "Reply", count: 4, tone: "blue" },
 *       { value: "stale", label: "Stale", count: 38, tone: "neutral", muted: true },
 *     ]}
 *   />
 *
 * Keyboard: ↑ ↓ move, Home / End jump, Enter / Space select. Items with `to`
 * render as links instead (the rail then reflects the URL). Below `md` the
 * rail becomes a horizontal strip.
 */

import type { LucideIcon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { NavLink } from "react-router";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type RailTone = "neutral" | "amber" | "red" | "blue" | "green";

export interface KindRailItem<V extends string = string> {
  value: V;
  label: string;
  count?: number | null;
  icon?: LucideIcon;
  /** Colour of the count pill when the number deserves attention. */
  tone?: RailTone;
  /** Keep the item visible at zero. */
  always?: boolean;
  /** Secondary styling (Stale, Done). */
  muted?: boolean;
  /** Render as a link to this path instead of a button. */
  to?: string;
}

interface KindRailProps<V extends string> {
  items: KindRailItem<V>[];
  value?: V;
  onChange?: (value: V) => void;
  "aria-label": string;
  className?: string;
  /** Hide items whose count is 0 or null unless `always`. Default true. */
  hideAtZero?: boolean;
}

const COUNT_TONE: Record<RailTone, string> = {
  neutral: "bg-grey-soft text-grey-text",
  amber: "bg-amber-soft text-amber-text",
  red: "bg-red-solid text-on-solid",
  blue: "bg-blue-soft text-blue-text",
  green: "bg-green-soft text-green-text",
};

export function KindRail<V extends string>({ items, value, onChange, className, hideAtZero = true, ...aria }: KindRailProps<V>) {
  const refs = useRef<Map<V, HTMLElement>>(new Map());
  const visible = items.filter((item) => item.always || !hideAtZero || (typeof item.count === "number" && item.count > 0));

  function onKeyDown(event: KeyboardEvent, index: number) {
    const keys: Record<string, number> = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: visible.length - 1 };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = visible[(next + visible.length) % visible.length];
    if (!target) return;
    refs.current.get(target.value)?.focus();
    if (!target.to) onChange?.(target.value);
  }

  return (
    <nav
      role={onChange ? "tablist" : undefined}
      aria-orientation={onChange ? "vertical" : undefined}
      aria-label={aria["aria-label"]}
      className={cn("flex gap-1 overflow-x-auto no-scrollbar md:flex-col md:overflow-visible", className)}
    >
      {visible.map((item, index) => {
        const active = item.value === value;
        const count = typeof item.count === "number" && item.count > 0 ? item.count : null;
        const classes = cn(
          "relative flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-body outline-none transition-colors",
          "hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring",
          active
            ? "bg-selection-row font-medium text-foreground before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary"
            : item.muted
              ? "text-muted-foreground"
              : "text-foreground",
        );
        const inner = (
          <>
            {item.icon ? <item.icon aria-hidden="true" className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} /> : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {count !== null ? (
              <span
                className={cn(
                  "ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular",
                  COUNT_TONE[item.tone ?? "neutral"],
                  item.muted && !item.tone && "bg-transparent text-muted-foreground ring-1 ring-border",
                )}
                aria-label={`${formatNumber(count)} items`}
              >
                {formatNumber(count)}
              </span>
            ) : null}
          </>
        );
        if (item.to) {
          return (
            <NavLink
              key={item.value}
              to={item.to}
              ref={(el) => {
                if (el) refs.current.set(item.value, el);
              }}
              aria-current={active ? "page" : undefined}
              className={classes}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {inner}
            </NavLink>
          );
        }
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active || (value === undefined && index === 0) ? 0 : -1}
            ref={(el) => {
              if (el) refs.current.set(item.value, el);
            }}
            className={classes}
            onClick={() => onChange?.(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
