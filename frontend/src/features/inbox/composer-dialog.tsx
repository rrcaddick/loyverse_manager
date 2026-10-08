/**
 * Reply / compose. A reply on a linked message goes through the booking
 * (POST /bookings/:id/emails/reply: threads onto it, can attach documents);
 * anything else goes through POST /inbox/compose.
 */

import { Paperclip, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { FormError, TextField, TextareaField, applyApiErrors, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useBookingDetail } from "@/features/queue/bookings";
import { formatDate } from "@/lib/format";

import { paragraphsToHtml, replySubject, useCompose, useReplyOnBooking } from "./api";
import type { FullMessage, MessageBookingRef } from "./types";

export interface ComposerTarget {
  mode: "reply" | "compose";
  /** The message being answered (reply mode). */
  message?: FullMessage | null;
  /** The booking the message is linked to, if any. */
  booking?: MessageBookingRef | null;
}

interface ComposerDialogProps {
  target: ComposerTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function splitAddresses(value: string): string[] {
  return value.split(/[,;\s]+/).filter(Boolean);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const schema = z.object({
  to: z
    .string()
    .trim()
    .min(1, "Enter at least one address")
    .refine((value) => splitAddresses(value).every((a) => EMAIL.test(a)), "Check the email addresses"),
  subject: z.string().trim().min(1, "Enter a subject"),
  body: z.string().trim().min(1, "Write a message"),
});

export function ComposerDialog({ target, open, onOpenChange }: ComposerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {target ? <ComposerForm key={`${target.mode}-${target.message?.id ?? 0}-${target.booking?.id ?? 0}`} target={target} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ComposerForm({ target, onDone }: { target: ComposerTarget; onDone: () => void }) {
  const { mode, message, booking } = target;
  const viaBooking = mode === "reply" && !!booking;
  const detail = useBookingDetail(viaBooking ? booking.id : null);
  const compose = useCompose();
  const reply = useReplyOnBooking();
  const [error, setError] = useState<string | null>(null);
  const [documentIds, setDocumentIds] = useState<number[]>([]);

  const defaultTo = useMemo(() => {
    if (mode !== "reply" || !message) return "";
    return message.direction === "inbound" ? message.from_email ?? "" : message.to_emails.join(", ");
  }, [mode, message]);

  const form = useZodForm({
    schema,
    defaultValues: { to: defaultTo, subject: mode === "reply" ? replySubject(message?.subject) : "", body: "" },
  });

  const bookingEmail = detail.data?.contact_email ?? null;
  const bookingHasEmail = viaBooking ? !!bookingEmail : true;
  const documents = detail.data?.documents ?? [];

  async function onSubmit(values: z.output<typeof schema>) {
    setError(null);
    const body_html = paragraphsToHtml(values.body);
    try {
      if (viaBooking && booking && bookingEmail) {
        await reply.mutateAsync({ booking_id: booking.id, subject: values.subject, body_html, attach_document_ids: documentIds });
        toast.success(`Reply sent to ${bookingEmail}`);
      } else {
        const to = splitAddresses(values.to);
        await compose.mutateAsync({ to, subject: values.subject, body_html, booking_id: booking?.id ?? null });
        toast.success(`Email sent to ${to.join(", ")}`);
      }
      onDone();
    } catch (err) {
      setError(applyApiErrors(form, err));
    }
  }

  const submitting = form.formState.isSubmitting;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "reply" ? "Reply" : "New email"}</DialogTitle>
        <DialogDescription>
          {viaBooking && booking
            ? `Sent on behalf of ${booking.reference} ${booking.group_name}; it threads onto the booking's conversation.`
            : mode === "reply"
              ? "Sent from the bookings mailbox. Attach the message to a booking first to thread it there and include documents."
              : "Sent from the bookings mailbox."}
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <FormError message={error} />
          {viaBooking ? (
            <div className="flex flex-col gap-1.5">
              <Label>To</Label>
              {detail.isPending ? (
                <span className="text-sm text-muted-foreground">Loading the booking…</span>
              ) : bookingEmail ? (
                <span className="text-sm">
                  {bookingEmail} <span className="text-muted-foreground">(booking contact)</span>
                </span>
              ) : (
                <span className="text-sm text-destructive" role="alert">
                  The booking has no email address. Add one on the booking, or detach the message and reply directly.
                </span>
              )}
            </div>
          ) : (
            <TextField control={form.control} name="to" label="To" type="text" placeholder="name@example.com, other@example.com" autoComplete="off" />
          )}
          <TextField control={form.control} name="subject" label="Subject" autoComplete="off" />
          <TextareaField control={form.control} name="body" label="Message" rows={10} placeholder="Blank lines separate paragraphs." description="Plain text; paragraphs and line breaks are kept." />
          {viaBooking && documents.length > 0 ? (
            <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Attach documents</legend>
              {documents.map((doc) => {
                const checked = documentIds.includes(doc.id);
                return (
                  <label key={doc.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <Checkbox checked={checked} onCheckedChange={(v) => setDocumentIds((ids) => (v ? [...ids, doc.id] : ids.filter((i) => i !== doc.id)))} />
                    <Paperclip aria-hidden="true" className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 truncate">{doc.label || doc.filename}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular">{formatDate(doc.issued_at)}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !bookingHasEmail}>
              {submitting ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
              Send
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}
