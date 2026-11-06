/**
 * Settings › Sending rules (6 Nov 2026). Every send in the app is a button;
 * a row here makes one automatic. The master switch keeps the whole thing
 * off until it is flipped, the pass sends only on prod, and each row shows
 * what the next pass would send so a rule is switched with eyes open.
 */

import { useState } from "react";
import { z } from "zod";

import { SelectField, SwitchField, NumberField, useZodForm } from "@/components/form";
import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSendingPreview, useUpdateSection } from "@/features/settings/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { SettingsTabProps } from "./SettingsPage";
import { SettingsForm, runSave } from "./shared";

const RULE_KEYS = ["expiry", "reminder_still_interested", "reminder_deposit_reminder", "reminder_final_details", "payment_confirmation", "ticket", "final_invoice"] as const;
type RuleKey = (typeof RULE_KEYS)[number];

const rule = z.object({ mode: z.enum(["manual", "automatic"]), days_before: z.number().int().min(0).max(60).optional() });
const schema = z.object({
  enabled: z.boolean(),
  rules: z.object(Object.fromEntries(RULE_KEYS.map((k) => [k, rule])) as Record<RuleKey, typeof rule>),
});
type FormValues = z.input<typeof schema>;

const MODE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic" },
];

export default function SendingTab({ data }: SettingsTabProps) {
  const save = useUpdateSection("sending");
  const preview = useSendingPreview();
  const [error, setError] = useState<string | null>(null);
  const stored = data.settings.sending;
  const defaults: FormValues = {
    enabled: !!stored?.enabled,
    rules: Object.fromEntries(RULE_KEYS.map((k) => [k, { mode: stored?.rules?.[k]?.mode ?? "manual", days_before: stored?.rules?.[k]?.days_before }])) as FormValues["rules"],
  };
  const form = useZodForm({ schema, defaultValues: defaults });
  const enabled = form.watch("enabled");
  const th = "h-thead text-label text-table-head-foreground uppercase";

  async function onSubmit(parsed: z.output<typeof schema>) {
    setError(
      await runSave(async () => {
        await save.mutateAsync({ enabled: parsed.enabled, rules: parsed.rules });
        form.reset(parsed as FormValues);
      }),
    );
  }

  const rows = preview.data?.rules ?? [];

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section
        title="Automatic sending"
        description="Every send is a button on the booking. A rule set to Automatic is performed by the daily pass instead, through the same action, so the record reads the same. Nothing goes out while the switch below is off, and the pass only sends on the live server."
      >
        <div className="flex flex-col gap-4">
          <SwitchField control={form.control} name="enabled" label="Automatic sending on" description={enabled ? "Rules set to Automatic go out on the next pass." : "Everything stays a button until this is on."} />
          {preview.data ? (
            <p className="text-sm text-muted-foreground">
              The next pass, on {formatDate(preview.data.today)}, would mark {preview.data.would_expire.length === 0 ? "nothing" : preview.data.would_expire.map((b) => `${b.reference} ${b.group_name}`).join(", ")} as expired. Expiry itself is always automatic; only the notice is a rule.
            </p>
          ) : null}
        </div>
      </Section>

      <Section title="Rules" description="One row per send. The trigger is fixed; the mode is yours." flush>
        <Table>
          <TableHeader className="bg-table-head text-table-head-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(th, "pl-5")}>Send</TableHead>
              <TableHead className={th}>When</TableHead>
              <TableHead className={cn(th, "w-44")}>Mode</TableHead>
              <TableHead className={cn(th, "pr-5")}>Would send on the next pass</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {RULE_KEYS.map((key) => {
              const meta = rows.find((r) => r.key === key);
              const mode = form.watch(`rules.${key}.mode`);
              return (
                <TableRow key={key} className="hover:bg-transparent">
                  <TableCell className="pl-5 align-top text-body font-medium text-foreground">{meta?.label ?? key}</TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {meta?.trigger ?? "…"}
                    {key === "ticket" ? (
                      <div className="mt-2 max-w-[11rem]">
                        <NumberField control={form.control} name="rules.ticket.days_before" label="Days before" hideLabel integer min={0} max={60} suffix="days" />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">
                    <SelectField control={form.control} name={`rules.${key}.mode`} label="Mode" hideLabel options={MODE_OPTIONS} />
                    {mode === "automatic" && !enabled ? <p className="mt-1 text-xs text-amber-text">Waits for the switch above.</p> : null}
                  </TableCell>
                  <TableCell className="pr-5 align-top text-sm">
                    {preview.isPending ? (
                      <span className="text-muted-foreground">Looking…</span>
                    ) : meta && meta.would_send.length > 0 ? (
                      <ul className="flex flex-col gap-0.5">
                        {meta.would_send.map((c) => (
                          <li key={`${key}-${c.booking_id}`} className="flex flex-wrap items-center gap-x-2">
                            <span className="font-mono text-xs text-muted-foreground">{c.reference}</span>
                            <span className="text-foreground">{c.group_name}</span>
                            <span className="text-muted-foreground">· {c.reason}</span>
                            {!c.email ? <StatusPill tone="amber" label="No email" size="sm" dot={false} /> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">Nothing</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>
    </SettingsForm>
  );
}
