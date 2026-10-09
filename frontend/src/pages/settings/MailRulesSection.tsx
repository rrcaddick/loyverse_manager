/**
 * Settings › Documents & mail › Mail rules: the learned ignored-sender list
 * (v3, docs/handoff/waiting-v3-contract.md). "Not a booking" in Mail adds a
 * row here by default; mail from a listed address, or from anyone at a
 * listed domain, is dropped at ingest unless it matches a booking. Add a
 * pattern by hand (`name@host` or `@host`), remove one with a confirm.
 *
 *   GET    /inbox/ignored-senders           → {items: [{id, pattern, kind, reason, created_at}]}
 *   POST   /inbox/ignored-senders {pattern, reason?}
 *   DELETE /inbox/ignored-senders/:id
 */

import { AlertCircle, MailX, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { TextField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useAddIgnoredSender, useDeleteIgnoredSender, useIgnoredSenders } from "@/features/mail/api";
import type { IgnoredSender } from "@/features/mail/types";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { errorMessage, isApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";

const PATTERN = /^(?:[^\s@]+)?@[^\s@]+\.[^\s@]+$/;

const schema = z.object({
  pattern: z
    .string()
    .trim()
    .min(1, "Enter an address or a domain")
    .regex(PATTERN, "An address (name@example.com) or a domain (@example.com)")
    .transform((v) => v.toLowerCase()),
  reason: z.string().trim().max(200, "Keep the reason under 200 characters"),
});

type FormOutput = z.output<typeof schema>;

function kindOf(rule: IgnoredSender): { label: string; tone: "neutral" | "blue" } {
  const domain = rule.kind === "domain" || rule.pattern.startsWith("@");
  return domain ? { label: "Domain", tone: "blue" } : { label: "Address", tone: "neutral" };
}

export default function MailRulesSection() {
  const rules = useIgnoredSenders();
  const add = useAddIgnoredSender();
  const remove = useDeleteIgnoredSender();
  const confirm = useSubjectDialog<IgnoredSender>();
  const [addError, setAddError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: { pattern: "", reason: "" } });

  async function onSubmit(values: FormOutput) {
    setAddError(null);
    try {
      const rule = await add.mutateAsync({ pattern: values.pattern, reason: values.reason || undefined });
      toast.success(`Ignoring mail from ${rule?.pattern ?? values.pattern}`);
      form.reset({ pattern: "", reason: "" });
    } catch (err) {
      if (isApiError(err) && err.fields.pattern) form.setError("pattern", { message: err.fields.pattern });
      else setAddError(errorMessage(err, "Could not add the rule"));
    }
  }

  const unavailable = rules.isError && isApiError(rules.error) && rules.error.status === 404;

  return (
    <>
      <Section
        title="Ignored senders"
        description="Mail from these senders never reaches a queue. “Not a booking” in Mail adds the sender here unless you untick it; mail that quotes a booking reference still comes through."
        flush
      >
        {rules.isPending ? (
          <div className="space-y-2 p-card" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : unavailable ? (
          <EmptyState icon={MailX} title="Ignored senders are not available yet" hint="The API does not serve /inbox/ignored-senders on this build; the list appears here once it is deployed." />
        ) : rules.isError ? (
          <Alert variant="destructive" className="m-card">
            <AlertCircle />
            <AlertTitle>Could not load the ignored senders</AlertTitle>
            <AlertDescription>{errorMessage(rules.error)}</AlertDescription>
          </Alert>
        ) : rules.data && rules.data.length > 0 ? (
          <table className="w-full table-fixed text-body" data-testid="ignored-senders">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[14%]" />
              <col className="hidden md:table-column md:w-[26%]" />
              <col className="w-[16%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead>
              <tr className="h-thead border-b border-border text-left text-label text-muted-foreground">
                <th scope="col" className="px-card font-medium">
                  Pattern
                </th>
                <th scope="col" className="px-3 font-medium">
                  Kind
                </th>
                <th scope="col" className="hidden px-3 font-medium md:table-cell">
                  Reason
                </th>
                <th scope="col" className="px-3 font-medium">
                  Added
                </th>
                <th scope="col" className="px-3">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rules.data.map((rule) => {
                const kind = kindOf(rule);
                return (
                  <tr key={rule.id} className="h-row">
                    <td className="truncate px-card font-mono text-sm text-foreground" title={rule.pattern}>
                      {rule.pattern}
                    </td>
                    <td className="px-3">
                      <StatusPill tone={kind.tone} label={kind.label} size="sm" />
                    </td>
                    <td className="hidden truncate px-3 text-sm text-muted-foreground md:table-cell" title={rule.reason ?? undefined}>
                      {rule.reason || "—"}
                    </td>
                    <td className="px-3 text-sm text-muted-foreground tabular whitespace-nowrap">{formatDate(rule.created_at)}</td>
                    <td className="px-3 text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${rule.pattern}`} disabled={remove.isPending} onClick={() => confirm.show(rule)}>
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={MailX} title="No ignored senders yet" hint="Choose “Not a booking” on a conversation in Mail, or add an address or domain below." />
        )}
      </Section>

      <Section title="Add a sender" description="One address, or a whole domain with a leading @. Anything they send from now on is dropped unless it quotes a booking reference, email or mobile number.">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate aria-label="Add an ignored sender">
            <TextField control={form.control} name="pattern" label="Address or domain" placeholder="name@example.com or @example.com" autoComplete="off" required />
            <TextField control={form.control} name="reason" label="Reason" placeholder="Newsletter, supplier invoices…" autoComplete="off" description="Shown in the list so the next person knows why." />
            {addError ? (
              <p role="alert" className="text-sm text-red-text">
                {addError}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={add.isPending || unavailable}>
                {add.isPending ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                Ignore sender
              </Button>
            </div>
          </form>
        </Form>
      </Section>

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.onOpenChange}
        title={`Stop ignoring ${confirm.subject?.pattern ?? "this sender"}?`}
        description="Their future mail reaches the queues again. Conversations already marked not a booking stay as they are."
        confirmLabel="Remove rule"
        destructive
        onConfirm={async () => {
          if (!confirm.subject) return;
          await remove.mutateAsync(confirm.subject.id);
          toast.success(`No longer ignoring ${confirm.subject.pattern}`);
        }}
      />
    </>
  );
}
