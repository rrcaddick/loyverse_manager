/**
 * Settings › Personal › Appearance (docs/research/07 §c).
 *
 * Six 160×100 theme tiles, each rendered in its own theme (the tile carries
 * data-theme, so tokens.css recomputes every token inside it), Mode and
 * Text size. Applied immediately — the change is its own preview — and
 * persisted per user (see src/lib/appearance-sync.tsx).
 */

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { Section } from "@/components/section";
import { useAppearance, type Mode, type TextSize, type ThemeMeta } from "@/lib/appearance";
import { cn } from "@/lib/utils";

const MODE_ICON: Record<Mode, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

export default function AppearancePage() {
  const { appearance, resolvedMode, setAppearance, themes, modes, textSizes } = useAppearance();

  return (
    <>
      <Section title="Theme" description="Colour means the same thing in every theme: green is done, amber is waiting, red is wrong. A theme only changes the accent and the paper.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-5">
          {themes.map((theme) => (
            <ThemeTile key={theme.id} theme={theme} dark={resolvedMode === "dark"} selected={appearance.theme === theme.id} onSelect={() => setAppearance({ theme: theme.id })} />
          ))}
        </div>
      </Section>

      <Section title="Mode" description="Light, dark, or follow the computer's day and night setting.">
        <div role="radiogroup" aria-label="Mode" className="grid gap-3">
          {modes.map((mode) => {
            const Icon = MODE_ICON[mode.value];
            const selected = appearance.mode === mode.value;
            return (
              <ChoiceCard key={mode.value} selected={selected} onSelect={() => setAppearance({ mode: mode.value })} label={mode.label} description={mode.description}>
                <Icon aria-hidden="true" className={cn("size-5", selected ? "text-primary" : "text-muted-foreground")} />
              </ChoiceCard>
            );
          })}
        </div>
      </Section>

      <Section title="Text size" description="Scales everything in the app. Large is the default; it is meant for reading at arm's length.">
        <div role="radiogroup" aria-label="Text size" className="grid gap-3">
          {textSizes.map((size) => {
            const selected = appearance.text_size === size.value;
            return (
              <ChoiceCard key={size.value} selected={selected} onSelect={() => setAppearance({ text_size: size.value as TextSize })} label={size.label} description={size.description}>
                <span aria-hidden="true" className="font-semibold leading-none" style={{ fontSize: `${size.px * 1.25}px` }}>
                  Aa
                </span>
              </ChoiceCard>
            );
          })}
        </div>
      </Section>
    </>
  );
}

function ChoiceCard({ selected, onSelect, label, description, children }: { selected: boolean; onSelect: () => void; label: string; description: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-row-queue items-center gap-3 rounded-lg bg-card px-4 py-3 text-left ring-1 outline-none transition-colors hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring",
        selected ? "ring-2 ring-primary" : "ring-border",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-nested">{children}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-foreground">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
      {selected ? <Check aria-hidden="true" className="size-5 shrink-0 text-primary" /> : null}
    </button>
  );
}

/** A 160×100 preview rendered in the theme it represents. */
function ThemeTile({ theme, dark, selected, onSelect }: { theme: ThemeMeta; dark: boolean; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${theme.name}: ${theme.description}`}
      onClick={onSelect}
      className="group flex w-full flex-col items-start gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    >
      <span
        data-theme={theme.id}
        className={cn(
          "relative block h-[100px] w-[160px] overflow-hidden rounded-lg bg-background text-foreground ring-1 ring-border",
          dark && "dark",
          selected && "ring-2 ring-primary",
        )}
      >
        {/* sidebar strip */}
        <span className="absolute inset-y-0 left-0 w-11 border-r border-sidebar-border bg-sidebar">
          <span className="absolute top-2.5 left-2 h-1.5 w-5 rounded-sm bg-sidebar-foreground/60" />
          <span className="absolute top-6 left-1 right-1 h-4 rounded-sm bg-sidebar-accent">
            <span className="absolute top-1 bottom-1 left-0 w-[2px] rounded-r bg-primary" />
            <span className="absolute top-[5px] left-2.5 h-1.5 w-5 rounded-sm bg-foreground/70" />
          </span>
          <span className="absolute top-12 left-2 h-1.5 w-6 rounded-sm bg-sidebar-foreground/40" />
          <span className="absolute top-[62px] left-2 h-1.5 w-4 rounded-sm bg-sidebar-foreground/40" />
        </span>
        {/* card */}
        <span className="absolute top-3 right-3 bottom-3 left-[54px] rounded-md bg-card p-2 ring-1 ring-border">
          <span className="block h-2 w-14 rounded-sm bg-foreground/80" />
          <span className="mt-1.5 block h-1.5 w-20 rounded-sm bg-muted-foreground/50" />
          <span className="mt-2.5 flex gap-1">
            <span className="inline-flex h-[11px] items-center rounded-[3px] bg-status-green-bg px-1 text-[6px] leading-none font-semibold text-status-green-fg ring-1 ring-pill-ring ring-inset">Paid</span>
            <span className="inline-flex h-[11px] items-center rounded-[3px] bg-status-amber-bg px-1 text-[6px] leading-none font-semibold text-status-amber-fg ring-1 ring-pill-ring ring-inset">Waiting</span>
          </span>
          <span className="absolute right-2 bottom-2 inline-flex h-5 items-center rounded-[4px] bg-primary px-2 text-[7px] leading-none font-semibold text-primary-foreground">Send</span>
        </span>
        {selected ? (
          <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check aria-hidden="true" className="size-3" />
          </span>
        ) : null}
      </span>
      <span className={cn("text-body font-medium", selected ? "text-foreground" : "text-foreground")}>{theme.name}</span>
      <span className="-mt-1.5 text-sm text-muted-foreground">{theme.description}</span>
    </button>
  );
}
