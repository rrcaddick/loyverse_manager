/**
 * /work — one list of everything that needs a person (spec §4). A rail of
 * kinds on the left with counts (hidden at zero), 56 px WorkRows with one
 * filled verb each, the detail beside the list. `?view=` and `?page=` live
 * in the URL. Keys: J/K move, Enter selects, 1 / 2 fire the focused row's
 * verbs, Esc closes the panel.
 */

import { Archive, Bell, DoorOpen, Hourglass, Inbox, Landmark, Mail, Sparkles, Ticket, AlertCircle, RefreshCw, type LucideIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { KindRail, type KindRailItem } from "@/components/kind-rail";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/section-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WORK_PAGE_SIZE, useDismissReminders, useWorkCounts, useWorkList } from "@/features/work/api";
import { WorkDetailPanel } from "@/features/work/components/work-detail-panel";
import { WorkRow } from "@/features/work/components/work-row";
import { isWorkView, type WorkCounts, type WorkRow as WorkRowData, type WorkView } from "@/features/work/types";
import { useWorkActions } from "@/features/work/use-work-actions";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShortcut } from "@/hooks/use-keyboard";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { toast } from "@/lib/toast";

interface ViewMeta {
  label: string;
  icon: LucideIcon;
  tone?: "blue" | "amber";
  muted?: boolean;
  empty: { title: string; hint: string; link: { to: string; label: string } };
}

const VIEWS: Record<WorkView, ViewMeta> = {
  up_next: {
    label: "Up next",
    icon: Sparkles,
    empty: { title: "Nothing needs you right now.", hint: "Replies, new requests, bank credits, tickets and reminders land here as they come in.", link: { to: "/calendar", label: "Open the calendar" } },
  },
  reply: {
    label: "Reply",
    icon: Mail,
    tone: "blue",
    empty: { title: "Nothing to reply to.", hint: "Mail is checked every minute; customer replies land here.", link: { to: "/mail", label: "Open Mail" } },
  },
  new_requests: {
    label: "New requests",
    icon: Inbox,
    empty: { title: "No new requests.", hint: "Requests from the public form and new email enquiries land here until a proforma goes out.", link: { to: "/bookings", label: "Open Bookings" } },
  },
  confirm_money: {
    label: "Confirm money",
    icon: Landmark,
    empty: { title: "No credits to confirm.", hint: "The bank is polled every five minutes; new credits land here.", link: { to: "/bank", label: "Open Bank" } },
  },
  send_tickets: {
    label: "Send tickets",
    icon: Ticket,
    empty: { title: "Every ticket has been sent.", hint: "Confirmed bookings without a vehicle ticket appear here.", link: { to: "/bookings?bucket=confirmed", label: "Confirmed bookings" } },
  },
  reminders: {
    label: "Reminders",
    icon: Bell,
    empty: { title: "No reminders due.", hint: "Reminders are recalculated every morning from the booking dates.", link: { to: "/settings/reminders", label: "Reminder settings" } },
  },
  holds: {
    label: "Holds lapsing",
    icon: Hourglass,
    tone: "amber",
    empty: { title: "No holds lapsing.", hint: "Tentative bookings whose hold ends within three days appear here.", link: { to: "/bookings?bucket=pending", label: "Pending bookings" } },
  },
  arrivals: {
    label: "Record arrivals",
    icon: DoorOpen,
    empty: { title: "No arrivals to record.", hint: "Confirmed visits without a count appear here after the visit day.", link: { to: "/today", label: "Open Today" } },
  },
  stale: {
    label: "Stale",
    icon: Archive,
    muted: true,
    empty: { title: "No stale reminders.", hint: "Reminders more than 30 days overdue move here so the live counts stay honest.", link: { to: "/work", label: "Back to Up next" } },
  },
};

const RAIL_ORDER: WorkView[] = ["up_next", "reply", "new_requests", "confirm_money", "send_tickets", "reminders", "holds", "arrivals", "stale"];

type ListEntry = { type: "header"; group: string | null; count: number } | { type: "row"; row: WorkRowData };

/** Rows arrive contiguous by `group`; the reminder views get a heading where it changes. */
function sectioned(items: WorkRowData[], grouped: boolean): ListEntry[] {
  if (!grouped) return items.map((row) => ({ type: "row", row }));
  const counts = new Map<string | null, number>();
  for (const item of items) counts.set(item.group, (counts.get(item.group) ?? 0) + 1);
  const out: ListEntry[] = [];
  let last: string | null | undefined;
  for (const row of items) {
    if (row.group !== last) {
      last = row.group;
      out.push({ type: "header", group: row.group, count: counts.get(row.group) ?? 0 });
    }
    out.push({ type: "row", row });
  }
  return out;
}

export default function WorkPage() {
  useDocumentTitle("Work");
  const [params, setParams] = useSearchParams();
  const viewParam = params.get("view");
  const view: WorkView = isWorkView(viewParam) ? viewParam : "up_next";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const counts = useWorkCounts();
  const list = useWorkList(view, page);
  const work = useWorkActions();
  const dismissAll = useDismissReminders();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissAllOpen, setDismissAllOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const c: WorkCounts | undefined = list.data?.counts ?? counts.data?.counts;
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const grouped = view === "reminders" || view === "stale";

  function setView(next: WorkView) {
    setParams(next === "up_next" ? {} : { view: next });
    setSelectedId(null);
  }

  function setPage(next: number) {
    const query: Record<string, string> = {};
    if (view !== "up_next") query.view = view;
    if (next > 1) query.page = String(next);
    setParams(query);
    setSelectedId(null);
  }

  function moveFocus(delta: 1 | -1) {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-work-row]") ?? []);
    if (rows.length === 0) return;
    const active = document.activeElement;
    let index = rows.findIndex((row) => row === active || row.contains(active));
    if (index === -1 && selected) index = rows.findIndex((row) => row.dataset.workRow === selected.id);
    const next = index === -1 ? (delta === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + delta));
    const target = rows[next];
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }

  useShortcut("j", () => moveFocus(1));
  useShortcut("k", () => moveFocus(-1));
  useShortcut("escape", () => setSelectedId(null), { enabled: selected !== null });

  const railItems: KindRailItem<WorkView>[] = RAIL_ORDER.map((key) => ({
    value: key,
    label: VIEWS[key].label,
    icon: VIEWS[key].icon,
    count: c ? c[key] : null,
    tone: VIEWS[key].tone,
    muted: VIEWS[key].muted,
    always: key === "up_next",
  }));

  const meta = VIEWS[view];
  const from = total === 0 ? 0 : (page - 1) * WORK_PAGE_SIZE + 1;
  const to = Math.min(total, page * WORK_PAGE_SIZE);

  let rowsOut: ReactNode;
  if (list.isPending) {
    rowsOut = (
      <div className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex min-h-row-queue items-center gap-3 px-4">
            <Skeleton className="size-2 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
            <Skeleton className="h-9 w-24" />
          </div>
        ))}
      </div>
    );
  } else if (items.length === 0) {
    rowsOut = <EmptyState variant="card" icon={meta.icon} title={meta.empty.title} hint={meta.empty.hint} link={meta.empty.link} />;
  } else {
    rowsOut = (
      <ul ref={listRef} className="divide-y divide-border" aria-label={`${meta.label} list`}>
        {sectioned(items, grouped).map((entry) =>
          entry.type === "header" ? (
            <li key={`group-${entry.group ?? "other"}`} className="bg-nested/60 px-4 pt-2 pb-1">
              <SectionHeader as="h3" title={entry.group ?? "Other"} count={entry.count} rule={false} className="[&_h3]:text-body [&_h3]:font-medium" />
            </li>
          ) : (
            <WorkRow
              key={entry.row.id}
              row={entry.row}
              selected={entry.row.id === selectedId}
              busy={work.busyRow === entry.row.id}
              quiet={view === "stale"}
              onSelect={(r) => setSelectedId((current) => (current === r.id ? null : r.id))}
              onAction={work.run}
            />
          ),
        )}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        title="Work"
        actions={
          view === "stale" && (c?.stale ?? 0) > 0 ? (
            <Button variant="outline" onClick={() => setDismissAllOpen(true)}>
              <Archive data-icon="inline-start" />
              Dismiss all stale
            </Button>
          ) : undefined
        }
      />

      <div className="grid items-start gap-card-gap lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,1fr)_auto]">
        <KindRail aria-label="Work views" value={view} onChange={setView} items={railItems} className="lg:sticky lg:top-20" />

        <div className="flex min-w-0 flex-col gap-3">
          {list.isError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Could not load this view</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{errorMessage(list.error)}</span>
                <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                  <RefreshCw data-icon="inline-start" />
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">{rowsOut}</div>
          {total > WORK_PAGE_SIZE ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground tabular">
              <span>
                Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={to >= total} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {selected ? <WorkDetailPanel row={selected} onClose={() => setSelectedId(null)} onAction={work.run} className="min-w-0 xl:sticky xl:top-20 xl:w-[24rem]" /> : null}
      </div>

      {work.dialogs}
      <ConfirmDialog
        open={dismissAllOpen}
        onOpenChange={setDismissAllOpen}
        title="Dismiss every stale reminder?"
        description={`${formatNumber(c?.stale ?? 0)} reminders more than 30 days overdue will be dismissed. Each dismissal is recorded on its booking; a payment or a moved date brings a reminder back.`}
        confirmLabel="Dismiss all"
        destructive
        onConfirm={async () => {
          const result = await dismissAll.mutateAsync({ all_stale: true });
          toast.success(`${formatNumber(result.dismissed)} reminders dismissed`);
          setSelectedId(null);
        }}
      />
    </>
  );
}
