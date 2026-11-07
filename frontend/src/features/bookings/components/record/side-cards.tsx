/**
 * The Overview's right column (6 Nov 2026): the last message in one line
 * with who is waiting on whom, and Notes, collapsed to an "Add note" link
 * while there is nothing. Standing notes about the booking live here; notes
 * about a message live on the conversation.
 */

import { Mail, Pencil, StickyNote } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { formatDateTimeRelative } from "@/lib/format";

import { useUpdateBooking } from "../../api";
import type { BookingDetail } from "../../types";

export function LastMessageCard({ booking, unanswered, onConversation }: { booking: BookingDetail; unanswered: number; onConversation: () => void }) {
  const last = [...booking.emails].filter((m) => m.send_status !== "failed").sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1))[0];
  const waitingOnUs = unanswered > 0;
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Mail aria-hidden="true" className="size-4 text-muted-foreground" />
          Last message
        </span>
      }
      actions={
        <Button variant={waitingOnUs ? "default" : "ghost"} size="sm" onClick={onConversation}>
          {waitingOnUs ? "Reply" : "Open"}
        </Button>
      }
    >
      {last ? (
        <div className="flex flex-col gap-2 text-body">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-foreground">{last.direction === "inbound" ? last.from_name || last.from_email || "Customer" : "You"}</span>
            <span className="text-sm text-muted-foreground">{formatDateTimeRelative(last.sent_at)}</span>
            <StatusPill tone={waitingOnUs ? "amber" : last.direction === "outbound" ? "neutral" : "green-muted"} label={waitingOnUs ? (unanswered === 1 ? "Waiting on you" : `${unanswered} waiting on you`) : last.direction === "outbound" ? "Waiting on them" : "Answered"} size="sm" dot={false} />
          </div>
          {last.subject ? <p className="truncate text-sm text-muted-foreground">{last.subject}</p> : null}
          {last.snippet ? <p className="line-clamp-2 text-foreground">{last.snippet}</p> : null}
        </div>
      ) : (
        <p className="text-body text-muted-foreground">No messages yet.</p>
      )}
    </Section>
  );
}

export function NotesCard({ booking }: { booking: BookingDetail }) {
  const update = useUpdateBooking(booking.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(booking.internal_notes ?? "");

  async function save() {
    const value = draft.trim() || null;
    if (value === (booking.internal_notes ?? null)) {
      setEditing(false);
      return;
    }
    try {
      await update.mutateAsync({ internal_notes: value });
      toast.success("Note saved");
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const start = () => {
    setDraft(booking.internal_notes ?? "");
    setEditing(true);
  };

  if (!editing && !booking.internal_notes) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-2.5 ring-1 ring-border">
        <span className="inline-flex items-center gap-2 text-body font-semibold text-foreground">
          <StickyNote aria-hidden="true" className="size-4 text-muted-foreground" />
          Notes
        </span>
        <Button variant="ghost" size="sm" onClick={start}>
          Add note
        </Button>
      </div>
    );
  }

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <StickyNote aria-hidden="true" className="size-4 text-muted-foreground" />
          Notes
        </span>
      }
      actions={
        !editing ? (
          <Button variant="ghost" size="icon-sm" aria-label="Edit the notes" onClick={start}>
            <Pencil />
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder="Standing information about this booking, for the office and the gate." />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {update.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-body text-foreground">{booking.internal_notes}</p>
      )}
    </Section>
  );
}
