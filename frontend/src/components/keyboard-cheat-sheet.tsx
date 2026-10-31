import { KeyboardHint } from "@/components/keyboard-hint";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KEYBOARD_MAP, type KeyboardMapGroup } from "@/hooks/use-keyboard";

interface KeyboardCheatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra groups a page wants to add (rendered after the global ones). */
  extra?: KeyboardMapGroup[];
}

/** The `?` dialog: every shortcut in the app, grouped. */
export function KeyboardCheatSheet({ open, onOpenChange, extra = [] }: KeyboardCheatSheetProps) {
  const groups = [...KEYBOARD_MAP, ...extra];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-section">Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? anywhere to open this list. Shortcuts pause while you are typing in a field.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} aria-labelledby={`keys-${group.title}`} className="min-w-0">
              <h3 id={`keys-${group.title}`} className="text-label mb-2 text-muted-foreground uppercase">
                {group.title}
              </h3>
              <dl className="divide-y divide-border">
                {group.items.map((item) => (
                  <div key={item.label} className="flex min-h-9 items-center justify-between gap-4 py-1.5 text-body">
                    <dt className="text-foreground">{item.label}</dt>
                    <dd>
                      <KeyboardHint keys={item.keys} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
