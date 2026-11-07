import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface SaveBarProps {
  /** Show the bar (usually `form.formState.isDirty`). */
  dirty: boolean;
  saving?: boolean;
  /** Disable Save (e.g. validation errors). */
  disabled?: boolean;
  onReset?: () => void;
  /** Defaults to submitting the enclosing <form>. */
  onSave?: () => void;
  saveLabel?: string;
  discardLabel?: string;
  message?: ReactNode;
  className?: string;
}

/**
 * The contextual save bar: "Unsaved changes · Discard · Save". Sticky at the
 * bottom of the viewport while a form is dirty; rendered inside the <form>
 * so Save submits it.
 */
export function SaveBar({
  dirty,
  saving = false,
  disabled = false,
  onReset,
  onSave,
  saveLabel = "Save",
  discardLabel = "Discard",
  message = "Unsaved changes",
  className,
}: SaveBarProps) {
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      aria-hidden={!dirty}
      className={cn(
        "sticky inset-x-0 bottom-0 z-20 transition-opacity duration-200 motion-reduce:transition-none",
        // Hidden, it takes no room, so a page that fits never scrolls for an empty bar.
        dirty ? "mt-6 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)] opacity-100" : "pointer-events-none mt-0 h-0 overflow-hidden pb-0 opacity-0",
        className,
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-popover/95 py-2.5 pr-2.5 pl-4 text-body shadow-md backdrop-blur supports-backdrop-filter:bg-popover/80">
        <div className="flex items-center gap-2.5 font-medium text-foreground">
          <span aria-hidden="true" className="size-2 rounded-full bg-amber-solid" />
          {message}
        </div>
        <div className="flex items-center gap-2">
          {onReset ? (
            <Button type="button" variant="ghost" onClick={onReset} disabled={saving}>
              {discardLabel}
            </Button>
          ) : null}
          <Button type={onSave ? "button" : "submit"} onClick={onSave} disabled={disabled || saving}>
            {saving ? <Spinner data-icon="inline-start" /> : null}
            {saving ? "Saving…" : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
