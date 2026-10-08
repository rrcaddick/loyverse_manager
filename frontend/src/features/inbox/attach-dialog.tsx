/**
 * Attach a message (or its whole thread) to a booking: the matcher's
 * suggestions with scores and reasons first, then a free search.
 */

import { Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { BookingPicker } from "@/features/queue/booking-picker";
import { visitDateLabel, type BookingListItem } from "@/features/queue/bookings";
import { errorMessage } from "@/lib/api";
import { formatNumber, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useAttachMessage, useSuggestions } from "./api";
import type { BookingSuggestion, FullMessage } from "./types";

interface AttachDialogProps {
  message: FullMessage | null;
  threadCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Choice = { kind: "suggestion"; suggestion: BookingSuggestion } | { kind: "search"; booking: BookingListItem };

export function AttachDialog({ message, threadCount, open, onOpenChange }: AttachDialogProps) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [wholeThread, setWholeThread] = useState(true);
  const suggestions = useSuggestions(message?.id ?? null, open);
  const attach = useAttachMessage();

  function handleOpenChange(next: boolean) {
    if (!next) setChoice(null);
    onOpenChange(next);
  }

  const chosenId = choice?.kind === "suggestion" ? choice.suggestion.booking_id : choice?.kind === "search" ? choice.booking.id : null;
  const chosenRef = choice?.kind === "suggestion" ? choice.suggestion.reference : choice?.kind === "search" ? choice.booking.reference : null;

  async function confirm() {
    if (!message || chosenId === null) return;
    const result = await attach.mutateAsync({ id: message.id, booking_id: chosenId, whole_thread: wholeThread && threadCount > 1 });
    toast.success(`${pluralise(result.linked_ids.length, "message")} attached to ${chosenRef}`);
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach to a booking</DialogTitle>
          <DialogDescription>Link this email to the booking it belongs to. It leaves the review list and shows on the booking.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section aria-labelledby="attach-suggestions" className="flex flex-col gap-2">
            <h3 id="attach-suggestions" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Suggested
            </h3>
            {suggestions.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
            ) : suggestions.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage(suggestions.error)}
              </p>
            ) : suggestions.data && suggestions.data.length > 0 ? (
              <div role="radiogroup" aria-label="Suggested bookings" className="flex flex-col gap-1.5">
                {suggestions.data.map((s) => {
                  const selected = choice?.kind === "suggestion" && choice.suggestion.booking_id === s.booking_id;
                  return (
                    <div
                      key={s.booking_id}
                      role="radio"
                      aria-checked={selected}
                      tabIndex={0}
                      onClick={() => setChoice({ kind: "suggestion", suggestion: s })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setChoice({ kind: "suggestion", suggestion: s });
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                        selected ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/60",
                      )}
                    >
                      <span aria-hidden="true" className={cn("mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary" : "border-input")}>
                        {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium tabular">{s.reference}</span>
                          <span className="min-w-0 truncate font-medium">{s.group_name}</span>
                          <StatusBadge status={s.status} />
                          <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground tabular" title="Match confidence">
                            {formatNumber(Math.round(s.score * 100))}%
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground tabular">
                          {visitDateLabel(s.visit_date)}
                          {s.contact_name ? ` · ${s.contact_name}` : ""}
                        </div>
                        {s.reasons.length > 0 ? <div className="mt-0.5 text-xs text-muted-foreground">{s.reasons.join(" · ")}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No likely match from the sender, references or phone numbers in this email.</p>
            )}
          </section>

          <section aria-labelledby="attach-search" className="flex flex-col gap-2">
            <h3 id="attach-search" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Or find the booking
            </h3>
            <BookingPicker
              value={choice?.kind === "search" ? choice.booking : null}
              onChange={(b) => setChoice(b ? { kind: "search", booking: b } : null)}
              autoFocus={false}
              renderMeta={(b) => (b.contact_email || b.contact_mobile ? [b.contact_email, b.contact_mobile].filter(Boolean).join(" · ") : null)}
            />
          </section>

          {threadCount > 1 ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div>
                <Label htmlFor="attach-whole-thread" className="text-sm">
                  Attach the whole thread
                </Label>
                <p className="text-xs text-muted-foreground">{pluralise(threadCount, "message")} in this conversation.</p>
              </div>
              <Switch id="attach-whole-thread" checked={wholeThread} onCheckedChange={setWholeThread} />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={chosenId === null || attach.isPending} onClick={() => void confirm()}>
            {attach.isPending ? <Spinner data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}
            Attach{chosenRef ? ` to ${chosenRef}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
