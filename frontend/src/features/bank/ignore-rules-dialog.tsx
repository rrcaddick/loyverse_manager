/**
 * Settings-like list of description rules (GET/DELETE /payments/ignore-rules),
 * reached from the summary line. Deleting a rule keeps what it already
 * ignored (restore those from their drawers).
 */

import { Trash2 } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";

import { useDeleteIgnoreRule, useIgnoreRules } from "./api";
import { IGNORE_REASON_LABELS, type IgnoreReason } from "./types";

export function IgnoreRulesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const rules = useIgnoreRules(open);
  const remove = useDeleteIgnoreRule();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ignore rules</DialogTitle>
          <DialogDescription>
            Credits whose description starts with a pattern are ignored at every poll. Add one from a row's Ignore menu ("This and similar in future"). Removing a rule does not restore entries it already ignored.
          </DialogDescription>
        </DialogHeader>
        {rules.isPending ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rules.isError ? (
          <p role="alert" className="text-sm text-red-text">
            {errorMessage(rules.error)}
          </p>
        ) : rules.data && rules.data.items.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg ring-1 ring-border">
            {rules.data.items.map((rule) => (
              <li key={rule.id} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm text-foreground">{rule.pattern}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {IGNORE_REASON_LABELS[rule.reason as IgnoreReason]?.replace("…", "") ?? rule.reason}
                    {rule.note ? ` · ${rule.note}` : ""}
                    {rule.created_by_name ? ` · ${rule.created_by_name}` : ""} · {formatDate(rule.created_at)}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove rule ${rule.pattern}`} disabled={remove.isPending} onClick={() => remove.mutate(rule.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState variant="card" title="No rules yet" hint="Choose “This and similar in future” under Ignore on a row to add one." />
        )}
      </DialogContent>
    </Dialog>
  );
}
