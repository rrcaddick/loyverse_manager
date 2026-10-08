import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

interface KeyboardHintProps {
  /** Keys in order: ["G", "T"] renders "G then T"; ["Ctrl", "Enter"] a chord. */
  keys: string[];
  /** "sequence" shows a "then" between keys; "chord" a "+". Default guesses. */
  kind?: "sequence" | "chord";
  className?: string;
  /** Screen-reader label; defaults to the keys joined. */
  label?: string;
}

const CHORD_MODIFIERS = new Set(["ctrl", "cmd", "⌘", "shift", "alt", "mod"]);

/**
 * Inline keycaps for buttons, tooltips and the cheat sheet.
 *
 *   <Button>Reply <KeyboardHint keys={["1"]} /></Button>
 *   <KeyboardHint keys={["G", "T"]} />   →  G then T
 */
export function KeyboardHint({ keys, kind, className, label }: KeyboardHintProps) {
  const resolved = kind ?? (keys.length > 1 && CHORD_MODIFIERS.has((keys[0] ?? "").toLowerCase()) ? "chord" : "sequence");
  return (
    <KbdGroup className={cn("text-muted-foreground", className)} aria-label={label ?? keys.join(resolved === "chord" ? "+" : " then ")}>
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 ? (
            <span aria-hidden="true" className="text-[0.6875rem] text-faint-foreground">
              {resolved === "chord" ? "+" : "then"}
            </span>
          ) : null}
          <Kbd aria-hidden="true" className="h-5 min-w-5 px-1.5 text-[0.75rem]">
            {key}
          </Kbd>
        </span>
      ))}
    </KbdGroup>
  );
}
