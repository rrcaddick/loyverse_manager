/**
 * Settings › Personal › Appearance: the Material palette picker.
 *
 * Choose two colours, as on materialpalette.com: a primary (its 500 shade for
 * the app bar, buttons and active states; 700 dark and 100 light variants)
 * and an accent from a different swatch (A200, for badges and dots). The
 * preview and the palette summary update as you pick; the choice applies
 * at once and is saved per user. Then Mode and Text size.
 */

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { pairName, styleVarsFor, useAppearance, type Mode, type TextSize } from "@/lib/appearance";
import { cn } from "@/lib/utils";
import { DEFAULT_PAIR, canBeAccent, onColor, paletteSummary, type Swatch } from "@/styles/m2.mjs";

const MODE_ICON: Record<Mode, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

export default function AppearancePage() {
  const { appearance, pair, resolvedMode, setAppearance, setPair, swatches, modes, textSizes } = useAppearance();
  const summary = paletteSummary(pair);

  return (
    <>
      <Section
        title="Colours"
        description={`Pick a primary colour and an accent, as in the Material palette. Now: ${pairName(pair)}.`}
        actions={
          pair.primary !== DEFAULT_PAIR.primary || pair.accent !== DEFAULT_PAIR.accent ? (
            <Button variant="ghost" size="sm" onClick={() => setPair(DEFAULT_PAIR)}>
              Reset to Indigo + Pink
            </Button>
          ) : null
        }
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-6">
            <SwatchGrid label="1. Primary colour" swatches={swatches} value={pair.primary} shade="500" onPick={(id) => setPair({ primary: id })} disabled={(s) => s.id === pair.accent} />
            <SwatchGrid label="2. Accent colour" swatches={swatches.filter((s) => canBeAccent(s.id))} value={pair.accent} shade="A200" onPick={(id) => setPair({ accent: id })} disabled={(s) => s.id === pair.primary} />
          </div>

          <div className="grid content-start gap-4">
            <PalettePreview pair={pair} dark={resolvedMode === "dark"} />
            <dl className="grid grid-cols-2 overflow-hidden rounded shadow-xs">
              {summary.map((cell) => (
                <div key={cell.label} className="flex h-16 flex-col justify-between p-2" style={{ background: cell.hex, color: cell.on }}>
                  <dd className="font-mono text-xs uppercase">{cell.hex}</dd>
                  <dt className="text-[10px] font-medium uppercase tracking-wide opacity-90">{cell.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      <Section title="Mode" description="Light, dark, or follow the computer's day and night setting.">
        <div role="radiogroup" aria-label="Mode" className="grid gap-3">
          {modes.map((mode) => {
            const Icon = MODE_ICON[mode.value];
            const selected = appearance.mode === mode.value;
            return (
              <ChoiceCard key={mode.value} selected={selected} onSelect={() => setAppearance({ mode: mode.value })} label={mode.label} description={mode.description}>
                <Icon aria-hidden="true" className={cn("size-5", selected ? "text-primary-text" : "text-muted-foreground")} />
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

function SwatchGrid({ label, swatches, value, shade, onPick, disabled }: { label: string; swatches: Swatch[]; value: string; shade: string; onPick: (id: string) => void; disabled: (s: Swatch) => boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
        {swatches.map((s) => {
          const hex = s.s[shade] ?? s.s["500"] ?? "#000000";
          const selected = s.id === value;
          const off = disabled(s);
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${s.name}${off ? " (already used)" : ""}`}
              disabled={off}
              onClick={() => onPick(s.id)}
              className={cn(
                "relative flex h-20 flex-col justify-between rounded p-2 text-left text-xs font-medium uppercase tracking-wide outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                selected ? "shadow-md ring-2 ring-foreground/70" : "shadow-xs hover:shadow-sm",
                off && "cursor-not-allowed opacity-40",
              )}
              style={{ background: hex, color: onColor(hex) }}
            >
              <span>{s.name}</span>
              {selected ? <Check aria-hidden="true" className="absolute right-2 bottom-2 size-5" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** materialpalette.com's preview card, drawn with the real tokens of the pair. */
function PalettePreview({ pair, dark }: { pair: { primary: string; accent: string }; dark: boolean }) {
  const vars = styleVarsFor(pair, dark ? "dark" : "light");
  return (
    <div style={vars as React.CSSProperties} className="overflow-hidden rounded bg-background shadow-md">
      <div className="h-2 bg-primary-dark" />
      <div className="relative bg-app-bar px-5 pt-10 pb-6 text-app-bar-foreground shadow-md">
        <div className="text-2xl font-normal">Palette preview</div>
        <div className="text-sm opacity-80">{pairName(pair)}</div>
        <span className="absolute -bottom-6 right-5 flex size-12 items-center justify-center rounded-full bg-highlight text-highlight-foreground shadow-lg" aria-hidden="true">
          ★
        </span>
      </div>
      <div className="bg-card px-5 pt-8 pb-5 text-foreground">
        <div className="text-sm">Group bookings for the park</div>
        <div className="mt-1 text-sm text-primary-text underline underline-offset-2">Open the booking</div>
        <div className="mt-4 flex items-center gap-2">
          <span className="inline-flex h-6 items-center rounded-full bg-status-green-bg px-2.5 text-xs font-medium text-status-green-fg">Confirmed</span>
          <span className="inline-flex h-6 items-center rounded-full bg-status-amber-bg px-2.5 text-xs font-medium text-status-amber-fg">Customer reply</span>
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-xs font-semibold text-highlight-foreground">43</span>
        </div>
        <div className="mt-4 flex justify-end">
          <span className="inline-flex h-9 items-center rounded bg-primary px-4 text-sm font-medium tracking-wide text-primary-foreground uppercase shadow-sm">New booking</span>
        </div>
      </div>
    </div>
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
        "flex min-h-row-queue items-center gap-3 rounded bg-card px-4 py-3 text-left shadow-xs outline-none transition-colors hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring",
        selected && "ring-2 ring-primary",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded bg-nested">{children}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-foreground">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
      {selected ? <Check aria-hidden="true" className="size-5 shrink-0 text-primary-text" /> : null}
    </button>
  );
}
