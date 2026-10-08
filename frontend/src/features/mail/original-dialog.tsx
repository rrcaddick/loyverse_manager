/**
 * "View original": the full sanitised HTML of one message (quote, signature
 * and all) from GET /inbox/messages/:id/original, in the same sandbox.
 */

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";

import { useOriginalMessage } from "./api";
import { MessageHtml, MessageText } from "./message-body";

export function OriginalDialog({ messageId, onClose }: { messageId: number | null; onClose: () => void }) {
  const original = useOriginalMessage(messageId);
  return (
    <Dialog open={messageId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{original.data?.subject || "Original message"}</DialogTitle>
          <DialogDescription>The message as it arrived, including quoted history and signature. Scripts and remote content stay blocked.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-card p-3 ring-1 ring-border scrollbar-thin">
          {original.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : original.isError ? (
            <p role="alert" className="text-sm text-red-text">
              {errorMessage(original.error)}
            </p>
          ) : original.data?.body_html ? (
            <MessageHtml html={original.data.body_html} label={original.data.subject ?? "original"} />
          ) : original.data?.body_text ? (
            <MessageText text={original.data.body_text} />
          ) : (
            <p className="text-sm text-muted-foreground">This message has no body.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
