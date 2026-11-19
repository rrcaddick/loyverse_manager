/**
 * EdgeBar — wraps a row or card and draws the 3 px left edge bar that marks
 * urgency. Never a tinted fill (spec §0.4).
 *
 *   <EdgeBar tone="amber">…row…</EdgeBar>
 *   <EdgeBar tone={unanswered > 2 ? "amber" : null} as="li" className="flex …">…</EdgeBar>
 *
 * Also usable without the component: the utilities `edge-amber`, `edge-red`,
 * `edge-green`, `edge-blue`, `edge-accent` draw the same bar on any element.
 */

import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type EdgeTone = "amber" | "red" | "green" | "blue" | "accent";

const EDGE: Record<EdgeTone, string> = {
  amber: "edge-amber",
  red: "edge-red",
  green: "edge-green",
  blue: "edge-blue",
  accent: "edge-accent",
};

type EdgeBarProps<T extends ElementType> = {
  tone?: EdgeTone | null;
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

export function EdgeBar<T extends ElementType = "div">({ tone, as, className, children, ...props }: EdgeBarProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag className={cn("relative", tone ? EDGE[tone] : null, className)} data-edge={tone ?? undefined} {...props}>
      {children}
    </Tag>
  );
}
