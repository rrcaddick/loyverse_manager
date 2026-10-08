/**
 * Settings › Documents & mail › Templates: the canned snippets the Mail
 * composer offers (price list, availability, deposit terms, the form link).
 * Each has a stable `key`, a title and a body; the operator can add, edit,
 * remove and reorder them. Saved as a whole list with
 * PUT /settings/templates {items} (docs/handoff/backend-v2-misc.md §7).
 *
 * The templates section is not yet in types/api.ts; TemplateItem below is
 * the local view until the shared type catches up.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowDown, ArrowUp, FileText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray } from "react-hook-form";
import { z } from "zod";

import { EmptyState } from "@/components/empty-state";
import { TextField, TextareaField, useZodForm } from "@/components/form";
import { PageSkeleton } from "@/components/page-skeleton";
import { Section } from "@/components/section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/features/settings/api";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import type { Settings, SettingsResponse } from "@/types/api";

import { SettingsForm, requiredText, runSave } from "./shared";

export interface TemplateItem {
  /** Stable identifier the composer refers to; derived from the title once, never changed. */
  key: string;
  title: string;
  body: string;
}

const schema = z
  .object({
    items: z.array(
      z.object({
        key: z.string(),
        title: requiredText("Enter a title").max(80, "Keep the title under 80 characters"),
        body: requiredText("Enter the text of the snippet").max(2000, "Keep the snippet under 2 000 characters"),
      }),
    ),
  })
  .superRefine((value, ctx) => {
    const seen = new Map<string, number>();
    value.items.forEach((item, index) => {
      const key = item.key || slug(item.title);
      const first = seen.get(key);
      if (first !== undefined) ctx.addIssue({ code: "custom", path: ["items", index, "title"], message: `Too close to the title of row ${first + 1}; make it distinct` });
      else seen.set(key, index);
    });
  });

type FormValues = z.input<typeof schema>;

/** "Price list" → "price_list" */
function slug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "snippet";
}

/** New rows get a key from their title; existing keys are kept as they are. */
function withKeys(items: TemplateItem[]): TemplateItem[] {
  const taken = new Set(items.map((i) => i.key).filter(Boolean));
  return items.map((item) => {
    if (item.key) return item;
    let key = slug(item.title);
    let n = 2;
    while (taken.has(key)) key = `${slug(item.title)}_${n++}`;
    taken.add(key);
    return { ...item, key };
  });
}

function useSaveTemplates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: TemplateItem[]) => api.put<{ settings: Settings & { templates?: { items: TemplateItem[] } } }>("/settings/templates", { items }),
    meta: { silent: true },
    onSuccess: ({ settings }) => {
      queryClient.setQueryData<SettingsResponse>(queryKeys.settings, (current) => (current ? { ...current, settings } : current));
    },
  });
}

export default function TemplatesSection() {
  const settings = useSettings();
  if (settings.isPending) return <PageSkeleton />;
  if (settings.isError || !settings.data) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Could not load templates</AlertTitle>
        <AlertDescription>{errorMessage(settings.error)}</AlertDescription>
      </Alert>
    );
  }
  const items = ((settings.data.settings as Settings & { templates?: { items?: TemplateItem[] } }).templates?.items ?? []).map((i) => ({
    key: String(i.key ?? ""),
    title: String(i.title ?? ""),
    body: String(i.body ?? ""),
  }));
  return <TemplatesForm items={items} />;
}

function TemplatesForm({ items }: { items: TemplateItem[] }) {
  const save = useSaveTemplates();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm({ schema, defaultValues: { items } });
  const rows = useFieldArray({ control: form.control, name: "items" });

  async function onSubmit(values: z.output<typeof schema>) {
    const next = withKeys(values.items);
    setError(
      await runSave(async () => {
        const { settings } = await save.mutateAsync(next);
        const saved = settings.templates?.items ?? next;
        form.reset({ items: saved } as FormValues);
      }, "Templates saved"),
    );
  }

  return (
    <SettingsForm form={form} onSubmit={onSubmit} saving={save.isPending} error={error}>
      <Section
        title="Templates"
        description="Canned snippets for the Mail composer: pick one while replying and edit it before sending. The order here is the order in the composer's menu."
        flush
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              rows.append({ key: "", title: "", body: "" });
              window.setTimeout(() => form.setFocus(`items.${rows.fields.length}.title`), 0);
            }}
          >
            <Plus data-icon="inline-start" />
            Add template
          </Button>
        }
      >
        {rows.fields.length === 0 ? (
          <EmptyState icon={FileText} title="No templates yet" description="Add the sentences you type most often: the price list, directions, the deposit terms." hint="They appear in the composer's Template menu as soon as you save." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.fields.map((field, index) => {
              const title = form.watch(`items.${index}.title`);
              const key = form.watch(`items.${index}.key`) || (title ? slug(title) : "");
              const name = title || `template ${index + 1}`;
              return (
                <li key={field.id} className="flex flex-col gap-3 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex gap-0.5 pt-1">
                      <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => rows.move(index, index - 1)} aria-label={`Move ${name} up`}>
                        <ArrowUp />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" disabled={index === rows.fields.length - 1} onClick={() => rows.move(index, index + 1)} aria-label={`Move ${name} down`}>
                        <ArrowDown />
                      </Button>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <TextField control={form.control} name={`items.${index}.title`} label={`Title of ${name}`} hideLabel placeholder="Title, for example Price list" maxLength={80} />
                      <p className="text-xs text-muted-foreground">
                        Key <span className="font-mono text-foreground">{key || "—"}</span>
                        {field.key ? "" : " (set from the title when you save)"}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => rows.remove(index)} aria-label={`Remove ${name}`}>
                      <Trash2 />
                    </Button>
                  </div>
                  <TextareaField control={form.control} name={`items.${index}.body`} label={`Text of ${name}`} hideLabel rows={3} maxLength={2000} placeholder="The text that is inserted into the reply" className="sm:pl-[3.25rem]" />
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </SettingsForm>
  );
}
