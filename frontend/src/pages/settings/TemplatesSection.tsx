/**
 * Settings › Documents & mail › Templates — PLACEHOLDER for the Public form
 * + Settings agent. Lists GET /inbox/templates when the endpoint exists
 * (Mail v2); until then explains what will live here. Replace this file;
 * keep the default export.
 */

import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isApiError } from "@/lib/api";

interface Template {
  id: number | string;
  name: string;
  subject?: string | null;
  body?: string | null;
}

export default function TemplatesSection() {
  const templates = useQuery({
    queryKey: ["mail", "templates"],
    queryFn: () => api.get<{ items: Template[] } | Template[]>("/inbox/templates"),
    retry: false,
  });
  const notAvailable = templates.isError && isApiError(templates.error) && templates.error.status === 404;
  const items = Array.isArray(templates.data) ? templates.data : (templates.data?.items ?? []);

  return (
    <Section title="Templates" description="Canned snippets for the Mail composer: a greeting, the directions, the gazebo note. Pick one while replying and edit before sending.">
      {templates.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-64" />
        </div>
      ) : notAvailable ? (
        <EmptyState
          icon={FileText}
          title="Templates arrive with Mail v2"
          description="When the conversation composer lands, the snippets you can insert into a reply are managed here."
        />
      ) : templates.isError ? (
        <EmptyState icon={FileText} title="Could not load templates" description="Try again in a moment." />
      ) : items.length === 0 ? (
        <EmptyState icon={FileText} title="No templates yet" description="Templates you add appear in the composer's Template menu." />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((t) => (
            <li key={t.id} className="flex min-h-row flex-col justify-center py-2">
              <span className="text-body font-medium text-foreground">{t.name}</span>
              {t.subject ? <span className="text-sm text-muted-foreground">{t.subject}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
