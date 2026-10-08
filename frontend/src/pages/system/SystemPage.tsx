import { differenceInMinutes } from "date-fns";
import { Activity, AlertCircle, CheckCircle2, Clock, Play, RefreshCw, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { KeyValue, type KeyValueItem } from "@/components/key-value";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/section";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { OPS_JOBS, useOpsLogs, useOpsStatus, useRunJob, type OpsJob } from "@/features/ops/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { errorMessage, isApiError } from "@/lib/api";
import { formatDate, formatDateTime, formatDuration, formatNumber, formatRelativeDay, formatTime, humanise, parseDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookingStatus, OpsRunResult, OpsStatus } from "@/types/api";

export default function SystemPage() {
  useDocumentTitle("System");
  const status = useOpsStatus();
  const notAvailable = status.isError && isApiError(status.error) && status.error.status === 404;

  return (
    <>
      <PageHeader
        title="System"
        description="Is everything running? Mail sync, the bank poll, the scheduler and the Loyverse morning sync, with their last runs and the log. Nothing here changes a booking directly."
        actions={
          <Button variant="outline" onClick={() => status.refetch()} disabled={status.isFetching}>
            <RefreshCw data-icon="inline-start" className={cn(status.isFetching && "animate-spin")} />
            Refresh status
          </Button>
        }
      />

      {notAvailable ? (
        <Alert>
          <AlertCircle />
          <AlertTitle>System endpoints are not available yet</AlertTitle>
          <AlertDescription>
            The API behind this page (/ops/status, /ops/run, /ops/logs) has not been deployed. The page will light up once it is.
          </AlertDescription>
        </Alert>
      ) : status.isError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load status</AlertTitle>
          <AlertDescription>{errorMessage(status.error)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {status.isPending ? (
          Array.from({ length: 6 }).map((_, i) => <StatusCardSkeleton key={i} />)
        ) : status.data ? (
          <>
            <MailCard data={status.data} />
            <BankCard data={status.data} />
            <RemindersCard data={status.data} />
            <BookingsCard data={status.data} />
            <SchedulerCard data={status.data} />
            <ImportsCard data={status.data} />
          </>
        ) : null}
      </div>
      {status.data ? (
        <p className="-mt-2 text-xs text-muted-foreground tabular">
          Server time {formatDateTime(status.data.server_time)} · business day {formatDate(status.data.today)}
        </p>
      ) : null}

      <JobsSection disabled={notAvailable} available={status.data?.jobs} />
      <LogsSection disabled={notAvailable} />
    </>
  );
}

// ------------------------------------------------------------ status cards

const STALE_AFTER_MINUTES = 15;

function minutesSince(value: string | null | undefined): number | null {
  const date = parseDate(value);
  return date ? differenceInMinutes(new Date(), date) : null;
}

function when(value: string | null | undefined): ReactNode {
  if (!value) return "Never";
  const rel = formatRelativeDay(value);
  const label = rel === "Today" || rel === "Yesterday" ? `${rel}, ${formatTime(value)}` : formatDateTime(value);
  return <span title={formatDateTime(value)}>{label}</span>;
}

function StatusCard({ title, description, badge, children }: { title: string; description: string; badge: { tone: StatusTone; label: string }; children: ReactNode }) {
  return (
    <Section title={title} description={description} actions={<StatusBadge status={badge.label} tone={badge.tone} label={badge.label} />}>
      {children}
    </Section>
  );
}

function StatusCardSkeleton() {
  return (
    <Section title={<Skeleton className="h-4 w-24" />} description={<Skeleton className="h-3 w-40" />} actions={<Skeleton className="h-5 w-16" />}>
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </Section>
  );
}

function ErrorLine({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <p className="rounded-md bg-destructive/5 px-2.5 py-1.5 font-mono text-xs break-words text-destructive">{text}</p>;
}

function MailCard({ data }: { data: OpsStatus }) {
  const { folders, pending_review } = data.mail;
  const errors = folders.filter((f) => f.last_error);
  const ages = folders.map((f) => minutesSince(f.last_synced_at)).filter((m): m is number => m !== null);
  const badge =
    errors.length > 0
      ? { tone: "red" as const, label: "Error" }
      : folders.length === 0
        ? { tone: "neutral" as const, label: "Never synced" }
        : ages.some((m) => m > STALE_AFTER_MINUTES)
          ? { tone: "amber" as const, label: "Stale" }
          : { tone: "green" as const, label: "Synced" };
  const items: KeyValueItem[] = folders.map((f) => ({
    label: f.folder.replace("[Gmail]/", ""),
    value: when(f.last_synced_at),
  }));
  items.push({ label: "Awaiting review", value: <span className={cn(pending_review > 0 && "font-medium")}>{formatNumber(pending_review)} messages</span> });
  return (
    <StatusCard title="Mail sync" description="IMAP pull from the bookings mailbox, every minute" badge={badge}>
      <div className="space-y-3">
        <KeyValue layout="table" items={items} />
        {errors.map((f) => (
          <ErrorLine key={f.folder} text={`${f.folder}: ${f.last_error}`} />
        ))}
      </div>
    </StatusCard>
  );
}

function BankCard({ data }: { data: OpsStatus }) {
  const { last_poll, suggested } = data.bank;
  const age = minutesSince(last_poll?.finished_at ?? last_poll?.started_at);
  const badge = !last_poll
    ? { tone: "neutral" as const, label: "Never polled" }
    : last_poll.error || last_poll.status === "error" || last_poll.status === "failed"
      ? { tone: "red" as const, label: "Failed" }
      : age !== null && age > STALE_AFTER_MINUTES
        ? { tone: "amber" as const, label: "Stale" }
        : { tone: "green" as const, label: humanise(last_poll.status ?? "ok") };
  return (
    <StatusCard title="Bank poll" description="FNB transaction history, every 5 minutes" badge={badge}>
      <div className="space-y-3">
        <KeyValue
          layout="table"
          items={[
            { label: "Last poll", value: when(last_poll?.finished_at ?? last_poll?.started_at) },
            ...(last_poll
              ? [
                  { label: "Window", value: <span className="tabular">{formatDate(last_poll.window_from)} – {formatDate(last_poll.window_to)}</span> },
                  { label: "Entries", value: `${formatNumber(last_poll.entries)} seen, ${formatNumber(last_poll.new_entries)} new` },
                ]
              : []),
            { label: "Suggested matches", value: <span className={cn(suggested > 0 && "font-medium")}>{formatNumber(suggested)}</span> },
          ]}
        />
        <ErrorLine text={last_poll?.error} />
      </div>
    </StatusCard>
  );
}

function RemindersCard({ data }: { data: OpsStatus }) {
  const r = data.reminders;
  const badge = r.due_count > 0 ? { tone: "amber" as const, label: `${formatNumber(r.due_count)} due` } : { tone: "green" as const, label: "Nothing due" };
  return (
    <StatusCard title="Reminders" description="Recomputed daily from bookings and settings" badge={badge}>
      <KeyValue
        layout="table"
        items={[
          { label: "Due today", value: formatNumber(r.due_count), numeric: true },
          { label: "Scheduled", value: formatNumber(r.due_total), numeric: true },
          { label: "Sent", value: formatNumber(r.sent), numeric: true },
          { label: "Dismissed", value: formatNumber(r.dismissed), numeric: true },
        ]}
      />
    </StatusCard>
  );
}

const COUNT_ORDER: BookingStatus[] = ["enquiry", "proforma_sent", "confirmed", "completed", "cancelled", "lapsed", "no_show"];

function BookingsCard({ data }: { data: OpsStatus }) {
  const { counts, total } = data.bookings;
  return (
    <StatusCard title="Bookings" description="Everything in the system, by status" badge={{ tone: "neutral", label: `${formatNumber(total)} total` }}>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {COUNT_ORDER.map((s) => (
          <li key={s} className="flex items-center justify-between gap-2">
            <StatusBadge status={s} />
            <span className="tabular">{formatNumber(counts[s] ?? 0)}</span>
          </li>
        ))}
      </ul>
    </StatusCard>
  );
}

/** "1 6 * * *" → "06:01 daily" for the common fixed-time case. */
function describeCron(expr: string): string {
  const [minute, hour, dom, month, dow] = expr.trim().split(/\s+/);
  if (dom === "*" && month === "*" && dow === "*" && /^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? "")) {
    return `${hour!.padStart(2, "0")}:${minute!.padStart(2, "0")} daily`;
  }
  return expr;
}

function SchedulerCard({ data }: { data: OpsStatus }) {
  const s = data.scheduler;
  const badge = s.profile_enabled ? { tone: "green" as const, label: "Schedule on" } : { tone: "amber" as const, label: "Schedule off" };
  return (
    <StatusCard title="Scheduler" description="supercronic in the scheduler container" badge={badge}>
      <div className="space-y-3">
        <KeyValue
          layout="table"
          items={[
            { label: "Morning sync", value: <span className="tabular" title={s.add_inventory_cron}>{describeCron(s.add_inventory_cron)}</span> },
            { label: "Clear inventory", value: <span className="tabular" title={s.clear_inventory_cron}>{describeCron(s.clear_inventory_cron)}</span> },
            { label: "Time zone", value: s.timezone },
          ]}
        />
        {!s.profile_enabled ? (
          <p className="text-xs text-muted-foreground">
            Nothing fires on a timer until <code className="rounded bg-muted px-1">COMPOSE_PROFILES=scheduled</code> is set in .env.
          </p>
        ) : null}
      </div>
    </StatusCard>
  );
}

/** One level of nesting rendered inline: {review: 55, unmatched: 172} → "review 55 · unmatched 172". */
function summaryValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === "") return "\u2014";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") : "none";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return "\u2014";
    return (
      <span className="flex flex-wrap gap-x-3 gap-y-0.5">
        {entries.map(([k, v]) => (
          <span key={k} className="whitespace-nowrap">
            <span className="text-muted-foreground">{humanise(k).toLowerCase()}</span>{" "}
            <span className="tabular">{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</span>
          </span>
        ))}
      </span>
    );
  }
  return String(value);
}

function ImportsCard({ data }: { data: OpsStatus }) {
  const run = data.imports.last_run;
  const badge = !run
    ? { tone: "neutral" as const, label: "No imports" }
    : run.status === "error" || run.status === "failed"
      ? { tone: "red" as const, label: "Failed" }
      : { tone: "green" as const, label: humanise(run.status ?? "done") };
  return (
    <StatusCard title="Imports" description="One-off loads from the legacy sheet and mailbox" badge={badge}>
      {run ? (
        <div className="space-y-3">
          <KeyValue
            layout="table"
            items={[
              { label: "Kind", value: run.kind ? humanise(run.kind) : "—" },
              { label: "Finished", value: when(run.finished_at ?? run.started_at) },
            ]}
          />
          {run.summary ? (
            typeof run.summary === "string" ? (
              <p className="text-sm text-muted-foreground">{run.summary}</p>
            ) : (
              <KeyValue layout="table" items={Object.entries(run.summary).map(([k, v]) => ({ label: humanise(k), value: summaryValue(v), numeric: typeof v === "number" }))} />
            )
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No import has run yet.</p>
      )}
    </StatusCard>
  );
}

// -------------------------------------------------------------------- jobs

function JobsSection({ disabled, available }: { disabled: boolean; available?: string[] }) {
  const run = useRunJob();
  const pending = useSubjectDialog<OpsJob>();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, OpsRunResult>>({});

  async function execute(job: OpsJob) {
    setRunning(job.name);
    try {
      const result = await run.mutateAsync(job.name);
      setResults((r) => ({ ...r, [job.name]: result }));
      if (result.ok) toast.success(`${job.title} finished in ${formatDuration(result.duration_ms)}`);
      else toast.error(`${job.title} failed`, { description: result.error ?? undefined });
    } catch (error) {
      setResults((r) => ({ ...r, [job.name]: { ok: false, name: job.name, duration_ms: 0, error: errorMessage(error) } }));
    } finally {
      setRunning(null);
    }
  }

  return (
    <Section
      title="Run a job now"
      description="Each job also runs on its schedule. Running one here does the same work immediately; the request stays open until it finishes."
      flush
    >
      <ul className="divide-y divide-border">
        {OPS_JOBS.map((job) => {
          const result = results[job.name];
          const isRunning = running === job.name;
          const unavailable = available !== undefined && !available.includes(job.name);
          return (
            <li key={job.name} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{job.title}</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{job.name}</code>
                  {job.slow ? <StatusBadge status="slow" label="Takes minutes" tone="amber" dot={false} /> : null}
                  {unavailable ? <StatusBadge status="unavailable" label="Not on this build" tone="neutral" dot={false} /> : null}
                </div>
                <p className="text-sm text-muted-foreground">{job.description}</p>
                {result ? <RunResult result={result} /> : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={disabled || unavailable || running !== null}
                onClick={() => pending.show(job)}
                aria-label={`Run ${job.title}`}
              >
                {isRunning ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                {isRunning ? "Running…" : "Run"}
              </Button>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={pending.open}
        onOpenChange={pending.onOpenChange}
        title={`Run ${pending.subject?.title ?? ""} now?`}
        description={pending.subject?.slow ? `${pending.subject.description} This takes a few minutes; keep this tab open.` : pending.subject?.description}
        confirmLabel="Run now"
        onConfirm={() => {
          const job = pending.subject;
          if (!job) return;
          pending.close();
          void execute(job);
        }}
      />
    </Section>
  );
}

function RunResult({ result }: { result: OpsRunResult }) {
  const summary = result.summary;
  return (
    <div className={cn("mt-1 flex items-start gap-2 rounded-md px-2.5 py-2 text-xs", result.ok ? "bg-success/8" : "bg-destructive/8")}>
      {result.ok ? <CheckCircle2 aria-hidden="true" className="mt-px size-3.5 shrink-0 text-success" /> : <AlertCircle aria-hidden="true" className="mt-px size-3.5 shrink-0 text-destructive" />}
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{result.ok ? "Finished" : "Failed"}</span>
          {result.duration_ms ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground tabular">
              <Clock aria-hidden="true" className="size-3" />
              {formatDuration(result.duration_ms)}
            </span>
          ) : null}
        </div>
        {summary !== undefined && summary !== null ? (
          typeof summary === "object" ? (
            <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">{JSON.stringify(summary, null, 2)}</pre>
          ) : (
            <p className="break-words">{String(summary)}</p>
          )
        ) : null}
        {!result.ok && result.error ? <p className="font-mono break-words text-destructive">{result.error}</p> : null}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- logs

const LINE_OPTIONS = [100, 200, 500, 1000];

function LogsSection({ disabled }: { disabled: boolean }) {
  const [lines, setLines] = useState(200);
  const [follow, setFollow] = useState(false);
  const logs = useOpsLogs(lines, !disabled);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!follow) return;
    const timer = window.setInterval(() => logs.refetch(), 5000);
    return () => window.clearInterval(timer);
  }, [follow, logs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && logs.data) el.scrollTop = el.scrollHeight;
  }, [logs.data]);

  const text = logs.data?.lines.join("\n") ?? "";

  return (
    <Section
      title="Application log"
      description={logs.data?.path ? `The tail of ${logs.data.path}` : "The tail of logs/inventory_updates.log: every service writes CSV rows here."}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="follow-log" checked={follow} onCheckedChange={setFollow} disabled={disabled} size="sm" />
            <Label htmlFor="follow-log" className="text-sm font-normal">
              Follow
            </Label>
          </div>
          <Select value={String(lines)} onValueChange={(v) => setLines(Number(v))} disabled={disabled}>
            <SelectTrigger size="sm" className="w-28" aria-label="Lines to show">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} lines
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CopyButton value={text} label="Copy" disabled={!text} />
          <Button variant="outline" size="sm" onClick={() => logs.refetch()} disabled={disabled || logs.isFetching}>
            <RefreshCw data-icon="inline-start" className={cn(logs.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      }
      flush
    >
      <div
        ref={scrollRef}
        role="log"
        aria-live={follow ? "polite" : "off"}
        aria-label="Application log"
        tabIndex={0}
        className="max-h-[32rem] min-h-48 overflow-auto bg-ink-950 p-4 font-mono text-xs leading-relaxed text-ink-200 scrollbar-thin outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset dark:bg-black/40 dark:text-ink-300"
      >
        {disabled ? (
          <Placeholder icon={TerminalSquare}>Logs become available with the ops API.</Placeholder>
        ) : logs.isPending ? (
          <Placeholder icon={Activity}>Loading…</Placeholder>
        ) : logs.isError ? (
          <Placeholder icon={AlertCircle}>{errorMessage(logs.error)}</Placeholder>
        ) : text ? (
          <pre className="whitespace-pre-wrap break-all">{text}</pre>
        ) : (
          <Placeholder icon={TerminalSquare}>The log is empty.</Placeholder>
        )}
      </div>
    </Section>
  );
}

function Placeholder({ icon: Icon, children }: { icon: typeof Activity; children: ReactNode }) {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-sm text-ink-400">
      <Icon aria-hidden="true" className="size-4" />
      {children}
    </div>
  );
}
