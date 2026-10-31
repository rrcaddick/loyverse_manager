import { useCallback, useState } from "react";

/**
 * Dialog state for "act on this record" dialogs. Keeps the subject after the
 * dialog closes so the content does not flash empty during the exit animation.
 *
 *   const reset = useSubjectDialog<User>();
 *   <DropdownMenuItem onSelect={() => reset.show(user)}>Reset password</DropdownMenuItem>
 *   <ConfirmDialog open={reset.open} onOpenChange={reset.onOpenChange} title={`Reset ${reset.subject?.full_name}?`} … />
 */
export function useSubjectDialog<T>() {
  const [subject, setSubject] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback((next: T) => {
    setSubject(next);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const onOpenChange = useCallback((next: boolean) => {
    if (!next) setOpen(false);
  }, []);
  return { subject, open, show, close, onOpenChange };
}
