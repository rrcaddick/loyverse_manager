import { useEffect } from "react";
import { useBlocker } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * Blocks in-app navigation (react-router data mode) and tab close while a
 * form is dirty. Returns the dialog to render.
 *
 *   const guard = useUnsavedChanges(form.formState.isDirty);
 *   return <>{...}{guard}</>;
 */
export function useUnsavedChanges(when: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [when]);

  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => !open && blocker.state === "blocked" && blocker.reset()}
      title="Discard unsaved changes?"
      description="You have changes on this page that have not been saved. Leaving now will lose them."
      confirmLabel="Discard and leave"
      cancelLabel="Stay"
      destructive
      onConfirm={() => {
        if (blocker.state === "blocked") blocker.proceed();
      }}
    />
  );
}
